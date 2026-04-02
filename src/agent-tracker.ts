import type { ParsedEvent } from "./jsonl-parser.ts";
import type {
	AgentState,
	AgentStatus,
	ToolHistoryEntry,
} from "./schemas/agent.ts";

export type { AgentState, AgentStatus, ToolHistoryEntry };

export interface AgentTrackerOptions {
	stalenessThresholdMs?: number;
	stalenessCheckIntervalMs?: number;
}

const MAX_TOOL_HISTORY = 10;
const MAX_IN_FLIGHT_TOOLS = 100;
const DEFAULT_STALENESS_THRESHOLD_MS = 30_000;
const DEFAULT_STALENESS_CHECK_INTERVAL_MS = 5_000;

interface ToolFields {
	toolName: string;
	inputSummary: string;
	toolUseId: string | undefined;
}

/**
 * Extract normalised tool identity fields from a hook or JSONL event data object.
 * Handles both camelCase (hook-handler-enriched) and snake_case (raw hook) keys.
 */
function extractToolFields(data: Record<string, unknown>): ToolFields {
	const rawName = data["toolName"] ?? data["tool_name"];
	const toolName = typeof rawName === "string" ? rawName : "unknown";

	const rawId = data["toolUseId"] ?? data["tool_use_id"];
	const toolUseId = typeof rawId === "string" ? rawId : undefined;

	const rawInput = data["inputSummary"];
	const inputSummary = typeof rawInput === "string" ? rawInput : "";

	return { toolName, inputSummary, toolUseId };
}

/**
 * Event types that do NOT affect agent state — skip the onAgentStateChange
 * callback when these are the only events processed.
 */
const SKIP_STATE_CHANGE_TYPES = new Set([
	"content_block_delta",
	"prompt_suggestion",
	"usage.rate_limit",
	"usage.context",
]);

export class AgentTracker {
	private readonly agents = new Map<string, AgentState>();
	private readonly inFlightTools = new Map<
		string,
		{ toolName: string; inputSummary: string; startedAt: number }
	>();
	private readonly stalenessThresholdMs: number;
	private readonly stalenessCheckIntervalMs: number;
	private stalenessTimer: ReturnType<typeof setInterval> | null = null;
	private dirty = false;

	onStalenessChange?: (agentId: string, isStale: boolean) => void;
	onAgentStateChange?: (sessionId: string, agents: AgentState[]) => void;

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

	/**
	 * Handle an event, update agent state, and fire onAgentStateChange if state
	 * actually changed. Events in SKIP_STATE_CHANGE_TYPES are skipped entirely
	 * since they never affect agent state.
	 */
	handleEvent(event: ParsedEvent): void {
		if (SKIP_STATE_CHANGE_TYPES.has(event.type)) return;

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
					this.addInFlightTool(toolUseId, {
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
				const { toolName, inputSummary, toolUseId } = extractToolFields(
					event.data,
				);
				agent.currentTool = toolName;
				agent.currentToolInput = inputSummary;
				if (toolUseId) {
					this.addInFlightTool(toolUseId, {
						toolName,
						inputSummary,
						startedAt: Date.now(),
					});
				}
				break;
			}

			case "hook.post_tool_use":
			case "hook.post_tool_use_failure": {
				if (!agent) break;
				this.markActive(agent);
				agent.status = "working";
				const success = event.type === "hook.post_tool_use";
				const { toolUseId } = extractToolFields(event.data);
				const tracked = toolUseId
					? this.inFlightTools.get(toolUseId)
					: undefined;
				if (toolUseId) {
					this.inFlightTools.delete(toolUseId);
				}
				const resolvedToolName =
					tracked?.toolName ?? extractToolFields(event.data).toolName;
				const resolvedInputSummary = tracked?.inputSummary ?? "";
				const startedAtVal = tracked?.startedAt;
				this.addToolHistory(agent, {
					toolName: resolvedToolName,
					inputSummary: resolvedInputSummary,
					durationMs:
						typeof startedAtVal === "number" ? Date.now() - startedAtVal : 0,
					success,
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

		this.dirty = true;
	}

	/**
	 * If state has changed since the last call, fire onAgentStateChange for the
	 * given sessionId and reset the dirty flag. Call this after handleEvent().
	 */
	notifyIfDirty(sessionId: string): void {
		if (!this.dirty) return;
		this.dirty = false;
		if (!this.onAgentStateChange) return;
		const agents = Array.from(this.agents.values()).filter(
			(a) => a.sessionId === sessionId,
		);
		this.onAgentStateChange(sessionId, agents);
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

	private addInFlightTool(
		toolUseId: string,
		value: { toolName: string; inputSummary: string; startedAt: number },
	): void {
		if (this.inFlightTools.size >= MAX_IN_FLIGHT_TOOLS) {
			// Delete the oldest entry (first key in insertion order)
			const oldestKey = this.inFlightTools.keys().next().value;
			if (oldestKey !== undefined) {
				this.inFlightTools.delete(oldestKey);
			}
		}
		this.inFlightTools.set(toolUseId, value);
	}
}
