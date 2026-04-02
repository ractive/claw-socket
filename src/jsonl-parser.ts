export type ParsedEvent = {
	type: string;
	sessionId: string;
	agentId?: string;
	data: Record<string, unknown>;
};

export type ParsedEventHandler = (event: ParsedEvent) => void;

interface InFlightTool {
	toolName: string;
	startedAt: number;
}

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen);
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (typeof block === "object" && block !== null && "type" in block) {
			const b = block as Record<string, unknown>;
			if (b["type"] === "text" && typeof b["text"] === "string") {
				parts.push(b["text"]);
			}
		}
	}
	return parts.join("\n");
}

export class JsonlParser {
	private readonly sessionId: string;
	private readonly handler: ParsedEventHandler;
	private readonly inFlight = new Map<string, InFlightTool>();

	constructor(sessionId: string, handler: ParsedEventHandler) {
		this.sessionId = sessionId;
		this.handler = handler;
	}

	private emit(
		type: string,
		data: Record<string, unknown>,
		agentId?: string,
	): void {
		this.handler({
			type,
			sessionId: this.sessionId,
			data,
			...(agentId ? { agentId } : {}),
		});
	}

	processLine(line: Record<string, unknown>): void {
		const type = line["type"];
		if (typeof type !== "string") return;

		switch (type) {
			case "user":
				this.processUser(line);
				break;
			case "assistant":
				this.processAssistant(line);
				break;
			case "result":
				this.processResult(line);
				break;
			case "system":
				this.processSystem(line);
				break;
		}
	}

	private processUser(line: Record<string, unknown>): void {
		const message = line["message"] as Record<string, unknown> | undefined;
		if (!message) return;
		const content = message["content"];
		const uuid =
			typeof message["uuid"] === "string" ? message["uuid"] : undefined;

		// Check for tool_result blocks
		if (Array.isArray(content)) {
			let hasToolResults = false;
			for (const block of content) {
				if (typeof block === "object" && block !== null && "type" in block) {
					const b = block as Record<string, unknown>;
					if (b["type"] === "tool_result") {
						hasToolResults = true;
						this.handleToolResult(b);
					}
				}
			}
			if (hasToolResults) return;
		}

		// Regular user message
		const text = extractText(content);
		const isSynthetic = line["isSynthetic"] === true;
		this.emit("message.user", {
			text,
			...(uuid ? { uuid } : {}),
			isSynthetic,
		});
	}

	private handleToolResult(block: Record<string, unknown>): void {
		const toolUseId =
			typeof block["tool_use_id"] === "string"
				? block["tool_use_id"]
				: undefined;
		if (!toolUseId) return;

		const tracked = this.inFlight.get(toolUseId);
		const toolName = tracked?.toolName ?? "unknown";
		const durationMs = tracked ? Date.now() - tracked.startedAt : 0;
		this.inFlight.delete(toolUseId);

		const isError = Boolean(block["is_error"]);
		const isInterrupt = Boolean(block["is_interrupt"]);

		if (isError) {
			const error =
				typeof block["content"] === "string"
					? block["content"]
					: "unknown error";
			this.emit("tool.failed", {
				toolName,
				toolUseId,
				error,
				isInterrupt,
			});
		} else {
			const rawContent = block["content"];
			const outputSummary =
				typeof rawContent === "string" ? truncate(rawContent, 500) : "";
			this.emit("tool.completed", {
				toolName,
				toolUseId,
				durationMs,
				outputSummary,
			});
		}
	}

	private processAssistant(line: Record<string, unknown>): void {
		const message = line["message"] as Record<string, unknown> | undefined;
		if (!message) return;
		const content = message["content"];
		const uuid =
			typeof message["uuid"] === "string" ? message["uuid"] : undefined;
		const model =
			typeof message["model"] === "string" ? message["model"] : undefined;

		const contentBlocks = Array.isArray(content) ? content : [];

		this.emit("message.assistant", {
			contentBlocks,
			...(uuid ? { uuid } : {}),
			...(model ? { model } : {}),
		});

		// Track tool_use blocks
		for (const block of contentBlocks) {
			if (typeof block === "object" && block !== null && "type" in block) {
				const b = block as Record<string, unknown>;
				if (b["type"] === "tool_use") {
					const id = typeof b["id"] === "string" ? b["id"] : undefined;
					const name = typeof b["name"] === "string" ? b["name"] : "unknown";
					if (id) {
						if (this.inFlight.size >= 100) {
							const oldestKey = this.inFlight.keys().next().value;
							if (oldestKey) this.inFlight.delete(oldestKey);
						}
						this.inFlight.set(id, {
							toolName: name,
							startedAt: Date.now(),
						});
						let inputSummary = "";
						try {
							inputSummary = truncate(JSON.stringify(b["input"]), 500);
						} catch {
							inputSummary = "";
						}
						this.emit("tool.started", {
							toolName: name,
							toolUseId: id,
							inputSummary,
						});
					}
				}
			}
		}
	}

	private processResult(line: Record<string, unknown>): void {
		const subtype =
			typeof line["subtype"] === "string" ? line["subtype"] : undefined;
		const durationMs =
			typeof line["duration_ms"] === "number" ? line["duration_ms"] : undefined;
		const durationApiMs =
			typeof line["duration_api_ms"] === "number"
				? line["duration_api_ms"]
				: undefined;
		const numTurns =
			typeof line["num_turns"] === "number" ? line["num_turns"] : undefined;
		const totalCostUsd =
			typeof line["total_cost_usd"] === "number"
				? line["total_cost_usd"]
				: undefined;
		const usage = line["usage"];

		this.emit("message.result", {
			...(subtype ? { subtype } : {}),
			...(durationMs !== undefined ? { durationMs } : {}),
			...(durationApiMs !== undefined ? { durationApiMs } : {}),
			...(numTurns !== undefined ? { numTurns } : {}),
			...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
			...(usage !== undefined ? { usage } : {}),
		});
	}

	private processSystem(line: Record<string, unknown>): void {
		const subtype =
			typeof line["subtype"] === "string" ? line["subtype"] : undefined;

		if (subtype === "init") {
			this.emit("session.started", {
				...(typeof line["tools"] !== "undefined"
					? { tools: line["tools"] }
					: {}),
				...(typeof line["model"] === "string" ? { model: line["model"] } : {}),
				...(typeof line["version"] === "string"
					? { version: line["version"] }
					: {}),
				...(typeof line["cwd"] === "string" ? { cwd: line["cwd"] } : {}),
				...(typeof line["permission_mode"] === "string"
					? { permissionMode: line["permission_mode"] }
					: {}),
			});
		} else if (subtype === "session_state_changed") {
			this.emit("session.state_changed", {
				...(line["state"] !== undefined ? { state: line["state"] } : {}),
			});
		}
	}
}
