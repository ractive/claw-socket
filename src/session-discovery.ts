import { type FSWatcher, watch } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SessionFileSchema, type SessionInfo } from "./schemas/index.ts";

export type SessionEvent =
	| { type: "session.discovered"; session: SessionInfo }
	| {
			type: "session.removed";
			sessionId: string;
			reason: "process_exited" | "file_removed";
	  };

export type SessionEventHandler = (event: SessionEvent) => void;

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const LIVENESS_INTERVAL_MS = 10_000;

export class SessionDiscovery {
	private sessions = new Map<string, SessionInfo>();
	private watcher: FSWatcher | null = null;
	private livenessTimer: ReturnType<typeof setInterval> | null = null;
	private handler: SessionEventHandler;

	constructor(handler: SessionEventHandler) {
		this.handler = handler;
	}

	/** Get all currently tracked sessions */
	getSessions(): SessionInfo[] {
		return Array.from(this.sessions.values());
	}

	/** Start watching for sessions */
	async start(): Promise<void> {
		// Initial scan
		await this.scanSessions();

		// Try to set up file watcher
		this.tryStartWatcher();

		// Periodic liveness check + watcher retry + rescan
		this.livenessTimer = setInterval(() => {
			this.checkLiveness();
			// Retry watcher if sessions dir appeared after startup
			if (!this.watcher) {
				this.tryStartWatcher();
				// Also rescan since we may have missed file events
				this.scanSessions().catch(() => {});
			}
		}, LIVENESS_INTERVAL_MS);
	}

	/** Stop watching */
	stop(): void {
		this.watcher?.close();
		this.watcher = null;
		if (this.livenessTimer) {
			clearInterval(this.livenessTimer);
			this.livenessTimer = null;
		}
	}

	private tryStartWatcher(): void {
		if (this.watcher) return;
		try {
			this.watcher = watch(SESSIONS_DIR, (_eventType, filename) => {
				if (!filename?.endsWith(".json")) return;
				// Handle async errors to avoid unhandled rejections
				this.handleFileChange(filename).catch(() => {});
			});
		} catch {
			// Sessions dir may not exist yet — will retry on next liveness tick
		}
	}

	private async scanSessions(): Promise<void> {
		let files: string[];
		try {
			files = await readdir(SESSIONS_DIR);
		} catch {
			return; // Dir doesn't exist yet
		}

		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			await this.tryAddSession(file);
		}
	}

	private async handleFileChange(filename: string): Promise<void> {
		const added = await this.tryAddSession(filename);
		if (!added) {
			// File was removed — check if we were tracking a session from this file
			const pid = parseInt(filename.replace(".json", ""), 10);
			if (Number.isNaN(pid)) return;
			for (const [id, session] of this.sessions) {
				if (session.pid === pid) {
					this.sessions.delete(id);
					this.handler({
						type: "session.removed",
						sessionId: id,
						reason: "file_removed",
					});
					break;
				}
			}
		}
	}

	private async tryAddSession(filename: string): Promise<boolean> {
		const filePath = join(SESSIONS_DIR, filename);
		try {
			const content = await readFile(filePath, "utf-8");
			const parsed = SessionFileSchema.safeParse(JSON.parse(content));
			if (!parsed.success) return false;

			const { pid, sessionId, cwd, startedAt } = parsed.data;

			// Already tracking?
			if (this.sessions.has(sessionId)) return true;

			// Validate PID is alive
			if (!isProcessAlive(pid)) return false;

			const session: SessionInfo = {
				pid,
				sessionId,
				cwd,
				startedAt,
				discoveredAt: Date.now(),
			};
			this.sessions.set(sessionId, session);
			this.handler({ type: "session.discovered", session });
			return true;
		} catch {
			return false;
		}
	}

	private checkLiveness(): void {
		for (const [id, session] of this.sessions) {
			if (!isProcessAlive(session.pid)) {
				this.sessions.delete(id);
				this.handler({
					type: "session.removed",
					sessionId: id,
					reason: "process_exited",
				});
			}
		}
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: unknown) {
		// EPERM means process exists but we lack permission to signal it
		if (err instanceof Error && "code" in err && err.code === "EPERM") {
			return true;
		}
		return false;
	}
}
