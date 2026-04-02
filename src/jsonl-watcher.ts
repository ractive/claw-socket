export type JsonlLineHandler = (
	line: Record<string, unknown>,
	byteOffset: number,
) => void;

export interface JsonlWatcherOptions {
	pollIntervalMs?: number;
}

export class JsonlWatcher {
	private readonly filePath: string;
	private readonly handler: JsonlLineHandler;
	private readonly pollIntervalMs: number;
	private currentByteOffset = 0;
	private lineBuffer = "";
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private polling = false;

	constructor(
		filePath: string,
		handler: JsonlLineHandler,
		options?: JsonlWatcherOptions,
	) {
		this.filePath = filePath;
		this.handler = handler;
		this.pollIntervalMs = options?.pollIntervalMs ?? 500;
	}

	get byteOffset(): number {
		return this.currentByteOffset;
	}

	start(): void {
		if (this.intervalId !== null) {
			return;
		}
		// Do an initial read immediately, then poll
		void this.poll();
		this.intervalId = setInterval(() => {
			void this.poll();
		}, this.pollIntervalMs);
	}

	stop(): void {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private async poll(): Promise<void> {
		if (this.polling) return;
		this.polling = true;
		try {
			const file = Bun.file(this.filePath);
			const size = file.size;

			if (size <= this.currentByteOffset) {
				return;
			}

			const slice = file.slice(this.currentByteOffset, size);
			const chunk = await slice.text();
			this.currentByteOffset = size;

			this.lineBuffer += chunk;

			const lines = this.lineBuffer.split("\n");
			// If the chunk didn't end with \n, the last element is a partial line — keep it buffered
			this.lineBuffer = lines.pop() ?? "";

			for (const raw of lines) {
				const trimmed = raw.trim();
				if (trimmed === "") {
					continue;
				}
				try {
					const parsed: unknown = JSON.parse(trimmed);
					if (
						typeof parsed === "object" &&
						parsed !== null &&
						!Array.isArray(parsed)
					) {
						this.handler(
							parsed as Record<string, unknown>,
							this.currentByteOffset,
						);
					}
				} catch {
					// Skip malformed JSON lines
				}
			}
		} catch {
			// File missing or unreadable — skip this poll cycle
		} finally {
			this.polling = false;
		}
	}
}
