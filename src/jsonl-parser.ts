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
			case "content_block_delta":
				this.processContentBlockDelta(line);
				break;
			case "prompt_suggestion":
				this.processPromptSuggestion(line);
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
		const usage = message["usage"];

		const contentBlocks = Array.isArray(content) ? content : [];

		this.emit("message.assistant", {
			contentBlocks,
			...(uuid ? { uuid } : {}),
			...(model ? { model } : {}),
			...(usage !== undefined ? { usage } : {}),
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
		} else if (subtype === "rate_limit" || this.isRateLimitLine(line)) {
			this.emitRateLimitEvent(line);
		} else if (subtype === "context_window" || this.isContextWindowLine(line)) {
			this.emitContextWindowEvent(line);
		}
	}

	private isRateLimitLine(line: Record<string, unknown>): boolean {
		return (
			"retry_after" in line ||
			"rate_limit_type" in line ||
			(typeof line["message"] === "string" &&
				(line["message"] as string).toLowerCase().includes("rate limit"))
		);
	}

	private isContextWindowLine(line: Record<string, unknown>): boolean {
		return (
			"context_window" in line ||
			("tokens_used" in line && "tokens_max" in line)
		);
	}

	private emitRateLimitEvent(line: Record<string, unknown>): void {
		const allowed =
			typeof line["allowed"] === "boolean" ? line["allowed"] : false;
		const rateLimitType =
			typeof line["rate_limit_type"] === "string"
				? line["rate_limit_type"]
				: typeof line["subtype"] === "string"
					? line["subtype"]
					: "unknown";
		const message =
			typeof line["message"] === "string" ? line["message"] : "Rate limited";
		const retryAfter =
			typeof line["retry_after"] === "number" ? line["retry_after"] : undefined;

		this.emit("usage.rate_limit", {
			allowed,
			type: rateLimitType,
			message,
			...(retryAfter !== undefined ? { retryAfter } : {}),
		});
	}

	processContentBlockDelta(line: Record<string, unknown>): void {
		const index = typeof line["index"] === "number" ? line["index"] : 0;
		const delta = line["delta"];
		if (typeof delta !== "object" || delta === null) return;
		const d = delta as Record<string, unknown>;
		const deltaType = d["type"];

		if (deltaType === "text_delta" && typeof d["text"] === "string") {
			this.emit("stream.delta", { index, text: d["text"] });
		} else if (
			deltaType === "thinking_delta" &&
			typeof d["thinking"] === "string"
		) {
			this.emit("stream.thinking_delta", { index, thinking: d["thinking"] });
		} else if (
			deltaType === "input_json_delta" &&
			typeof d["partial_json"] === "string"
		) {
			this.emit("stream.tool_use_delta", {
				index,
				partialJson: d["partial_json"],
			});
		}
	}

	private processPromptSuggestion(line: Record<string, unknown>): void {
		const suggestions = line["suggestions"];
		if (!Array.isArray(suggestions)) return;
		this.emit("prompt.suggestion", { suggestions });
	}

	private emitContextWindowEvent(line: Record<string, unknown>): void {
		const contextWindow = line["context_window"];
		let percentUsed = 0;
		let tokensUsed = 0;
		let tokensMax = 0;
		let categories: Record<string, number> | undefined;

		if (typeof contextWindow === "object" && contextWindow !== null) {
			const cw = contextWindow as Record<string, unknown>;
			tokensUsed =
				typeof cw["tokens_used"] === "number" ? cw["tokens_used"] : 0;
			tokensMax = typeof cw["tokens_max"] === "number" ? cw["tokens_max"] : 0;
			if (tokensMax > 0) percentUsed = (tokensUsed / tokensMax) * 100;
			if (typeof cw["categories"] === "object" && cw["categories"] !== null) {
				categories = {};
				const cats = cw["categories"] as Record<string, unknown>;
				for (const [k, v] of Object.entries(cats)) {
					if (typeof v === "number") categories[k] = v;
				}
			}
		} else {
			// Flat format
			tokensUsed =
				typeof line["tokens_used"] === "number" ? line["tokens_used"] : 0;
			tokensMax =
				typeof line["tokens_max"] === "number" ? line["tokens_max"] : 0;
			if (tokensMax > 0) percentUsed = (tokensUsed / tokensMax) * 100;
			const percentRaw =
				typeof line["percent_used"] === "number"
					? line["percent_used"]
					: undefined;
			if (percentRaw !== undefined) percentUsed = percentRaw;
		}

		this.emit("usage.context", {
			percentUsed,
			tokensUsed,
			tokensMax,
			...(categories ? { categories } : {}),
		});
	}
}
