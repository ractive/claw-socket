import type { ParsedEvent } from "./jsonl-parser.ts";

export type AgentStatus = "working" | "tool_running" | "idle" | "offline";

export interface ToolHistoryEntry {
	toolName: string;
	inputSummary: string;
	durationMs: number;
	success: boolean;
	startedAt: number;
}

export interface AgentState {
	agentId: string;
	agentType: string;
	sessionId: string;
	status: AgentStatus;
	currentTool?: string;
	currentToolInput?: string;
	startedAt: number;
	lastActivityAt: number;
	toolCount: number;
	tokenCount: number;
	cwd: string;
	name?: string;
	toolHistory: ToolHistoryEntry[];
}

export interface AgentTrackerOptions {
	stalenessThresholdMs?: number;
	stalenessCheckIntervalMs?: number;
}

const MAX_TOOL_HISTORY = 10;
const DEFAULT_STALENESS_THRESHOLD_MS = 30_000;
const DEFAULT_STALENESS_CHECK_INTERVAL_MS = 5_000;

export class AgentTracker {
	private readonly agents = new Map<string, AgentState>();
	private readonly inFlightTools = new Map<
		string,
		{ toolName: string; inputSummary: string; startedAt: number }
	>();
	private readonly stalenessThresholdMs: number;
	private readonly stalenessCheckIntervalMs: number;
	private stalenessTimer: ReturnType<typeof setInterval> | null = null;

	onStalenessChange?: (agentId: string, isStale: boolean) => void;

	constructor(options: AgentTrackerOptions = {}) {
		this.stalenessThresholdMs =
			options.stalenessThresholdMs ?? DEFAULT_STALENESS_THRESHOLD_MS;
		this.stalenessCheckIntervalMs =
			options.stalenessCheckIntervalMs ?? DEFAULT_STALENESS_CHECK_INTERVAL_MS;
	}

	getAgents(): AgentState[] {
		return Array.from(this.agents.values());
	}

	getAgent(agentId: string): AgentState | undefined {
		return this.agents.get(agentId);
	}

	registerAgent(
		agentId: string,
		sessionId: string,
		agentType: string,
		cwd: string,
	): void {
		const now = Date.now();
		this.agents.set(agentId, {
			agentId,
			agentType,
			sessionId,
			status: "working",
			startedAt: now,
			lastActivityAt: now,
			toolCount: 0,
			tokenCount: 0,
			cwd,
			toolHistory: [],
		});
	}

	removeAgent(agentId: string): void {
		this.agents.delete(agentId);
	}

	removeAgentsBySession(sessionId: string): void {
		for (const [id, agent] of this.agents) {
			if (agent.sessionId === sessionId) {
				this.agents.delete(id);
			}
		}
	}

	clear(): void {
		this.agents.clear();
	}

	handleEvent(event: ParsedEvent): void {
		const agentId = event.agentId ?? event.sessionId;
		const agent = this.agents.get(agentId);

		switch (event.type) {
			case "agent.started": {
				const d = event.data;
				this.registerAgent(
					agentId,
					event.sessionId,
					typeof d["agentType"] === "string" ? d["agentType"] : "unknown",
					typeof d["cwd"] === "string" ? d["cwd"] : "",
				);
				break;
			}

			case "agent.stopped": {
				if (agent) {
					agent.status = "offline";
					agent.lastActivityAt = Date.now();
				}
				break;
			}

			case "tool.started": {
				if (!agent) break;
				this.markActive(agent);
				agent.status = "tool_running";
				const toolName = event.data["toolName"];
				const toolInput = event.data["inputSummary"];
				const toolUseId = event.data["toolUseId"];
				if (typeof toolName === "string") {
					agent.currentTool = toolName;
				}
				if (typeof toolInput === "string") {
					agent.currentToolInput = toolInput;
				}
				if (typeof toolUseId === "string") {
					this.inFlightTools.set(toolUseId, {
						toolName: typeof toolName === "string" ? toolName : "unknown",
						inputSummary: typeof toolInput === "string" ? toolInput : "",
						startedAt: Date.now(),
					});
				}
				break;
			}

			case "tool.completed":
			case "tool.failed": {
				if (!agent) break;
				this.markActive(agent);
				agent.status = "working";
				const success = event.type === "tool.completed";
				const toolUseIdVal = event.data["toolUseId"];
				const tracked =
					typeof toolUseIdVal === "string"
						? this.inFlightTools.get(toolUseIdVal)
						: undefined;
				if (typeof toolUseIdVal === "string") {
					this.inFlightTools.delete(toolUseIdVal);
				}
				const toolName = tracked?.toolName ?? event.data["toolName"];
				const inputSummary =
					tracked?.inputSummary ?? event.data["inputSummary"];
				const durationMs = event.data["durationMs"];
				const startedAtVal = tracked?.startedAt;
				this.addToolHistory(agent, {
					toolName: typeof toolName === "string" ? toolName : "unknown",
					inputSummary: typeof inputSummary === "string" ? inputSummary : "",
					durationMs: typeof durationMs === "number" ? durationMs : 0,
					success,
					startedAt:
						typeof startedAtVal === "number" ? startedAtVal : Date.now(),
				});
				agent.toolCount += 1;
				delete agent.currentTool;
				delete agent.currentToolInput;
				break;
			}

			case "hook.pre_tool_use": {
				if (!agent) break;
				this.markActive(agent);
				agent.status = "tool_running";
				const toolName = event.data["toolName"] ?? event.data["tool_name"];
				const toolInput = event.data["inputSummary"];
				const toolUseId = event.data["toolUseId"] ?? event.data["tool_use_id"];
				if (typeof toolName === "string") {
					agent.currentTool = toolName;
				}
				if (typeof toolInput === "string") {
					agent.currentToolInput = toolInput;
				}
				if (typeof toolUseId === "string") {
					this.inFlightTools.set(toolUseId, {
						toolName: typeof toolName === "string" ? toolName : "unknown",
						inputSummary: typeof toolInput === "string" ? toolInput : "",
						startedAt: Date.now(),
					});
				}
				break;
			}

			case "hook.post_tool_use": {
				if (!agent) break;
				this.markActive(agent);
				agent.status = "working";
				const toolUseIdVal =
					event.data["toolUseId"] ?? event.data["tool_use_id"];
				const tracked =
					typeof toolUseIdVal === "string"
						? this.inFlightTools.get(toolUseIdVal)
						: undefined;
				if (typeof toolUseIdVal === "string") {
					this.inFlightTools.delete(toolUseIdVal);
				}
				const toolName =
					tracked?.toolName ??
					event.data["toolName"] ??
					event.data["tool_name"];
				const inputSummary = tracked?.inputSummary ?? "";
				const startedAtVal = tracked?.startedAt;
				this.addToolHistory(agent, {
					toolName: typeof toolName === "string" ? toolName : "unknown",
					inputSummary: typeof inputSummary === "string" ? inputSummary : "",
					durationMs:
						typeof startedAtVal === "number" ? Date.now() - startedAtVal : 0,
					success: true,
					startedAt:
						typeof startedAtVal === "number" ? startedAtVal : Date.now(),
				});
				agent.toolCount += 1;
				delete agent.currentTool;
				delete agent.currentToolInput;
				break;
			}

			case "hook.post_tool_use_failure": {
				if (!agent) break;
				this.markActive(agent);
				agent.status = "working";
				const toolUseIdVal =
					event.data["toolUseId"] ?? event.data["tool_use_id"];
				const tracked =
					typeof toolUseIdVal === "string"
						? this.inFlightTools.get(toolUseIdVal)
						: undefined;
				if (typeof toolUseIdVal === "string") {
					this.inFlightTools.delete(toolUseIdVal);
				}
				const toolName =
					tracked?.toolName ??
					event.data["toolName"] ??
					event.data["tool_name"];
				const inputSummary = tracked?.inputSummary ?? "";
				const startedAtVal = tracked?.startedAt;
				this.addToolHistory(agent, {
					toolName: typeof toolName === "string" ? toolName : "unknown",
					inputSummary: typeof inputSummary === "string" ? inputSummary : "",
					durationMs:
						typeof startedAtVal === "number" ? Date.now() - startedAtVal : 0,
					success: false,
					startedAt:
						typeof startedAtVal === "number" ? startedAtVal : Date.now(),
				});
				agent.toolCount += 1;
				delete agent.currentTool;
				delete agent.currentToolInput;
				break;
			}

			case "message.assistant": {
				if (!agent) break;
				this.markActive(agent);
				agent.status = "working";
				// Estimate tokens from content length
				const blocks = event.data["contentBlocks"];
				if (Array.isArray(blocks)) {
					for (const block of blocks) {
						if (
							typeof block === "object" &&
							block !== null &&
							"type" in block
						) {
							const b = block as Record<string, unknown>;
							if (b["type"] === "text" && typeof b["text"] === "string") {
								// Rough estimate: ~4 chars per token
								agent.tokenCount += Math.ceil(b["text"].length / 4);
							}
						}
					}
				}
				break;
			}

			case "message.result": {
				if (!agent) break;
				this.markActive(agent);
				agent.status = "working";
				const usage = event.data["usage"];
				if (
					typeof usage === "object" &&
					usage !== null &&
					"output_tokens" in usage
				) {
					const u = usage as Record<string, unknown>;
					const outputTokens = u["output_tokens"];
					const inputTokens = u["input_tokens"];
					if (
						typeof inputTokens === "number" &&
						typeof outputTokens === "number"
					) {
						agent.tokenCount = inputTokens + outputTokens;
					} else if (typeof outputTokens === "number") {
						agent.tokenCount = outputTokens;
					} else if (typeof inputTokens === "number") {
						agent.tokenCount = inputTokens;
					}
				}
				break;
			}
		}
	}

	startStalenessCheck(): void {
		if (this.stalenessTimer) return;
		this.stalenessTimer = setInterval(() => {
			this.checkStaleness();
		}, this.stalenessCheckIntervalMs);
	}

	stopStalenessCheck(): void {
		if (this.stalenessTimer) {
			clearInterval(this.stalenessTimer);
			this.stalenessTimer = null;
		}
	}

	private checkStaleness(): void {
		const now = Date.now();
		for (const agent of this.agents.values()) {
			if (agent.status === "offline") continue;
			const isStale = now - agent.lastActivityAt > this.stalenessThresholdMs;

			if (isStale && agent.status !== "idle") {
				agent.status = "idle";
				this.onStalenessChange?.(agent.agentId, true);
			}
		}
	}

	private markActive(agent: AgentState): void {
		const wasIdle = agent.status === "idle";
		agent.lastActivityAt = Date.now();
		if (wasIdle) {
			this.onStalenessChange?.(agent.agentId, false);
		}
	}

	private addToolHistory(agent: AgentState, entry: ToolHistoryEntry): void {
		if (agent.toolHistory.length >= MAX_TOOL_HISTORY) {
			agent.toolHistory.shift();
		}
		agent.toolHistory.push(entry);
	}
}
