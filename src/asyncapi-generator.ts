import { zodToJsonSchema } from "zod-to-json-schema";
import {
	AgentStartedEventSchema,
	AgentStateSchema,
	AgentStoppedEventSchema,
	ClientMessageSchema,
	EventEnvelopeSchema,
	GetSessionHistoryMessageSchema,
	GetSessionListMessageSchema,
	GetSnapshotMessageSchema,
	GetUsageMessageSchema,
	MessageAssistantEventSchema,
	MessageResultEventSchema,
	MessageUserEventSchema,
	SessionDiscoveredSchema,
	SessionInfoSchema,
	SessionRemovedSchema,
	SessionStartedEventSchema,
	SessionStateChangedEventSchema,
	SnapshotSchema,
	SubscribeAgentLogMessageSchema,
	SubscribeMessageSchema,
	ToolCompletedEventSchema,
	ToolFailedEventSchema,
	ToolStartedEventSchema,
	UnsubscribeMessageSchema,
} from "./schemas/index.ts";

// ── Envelope wrapper helpers ─────────────────────────────────────────────────

function envelopedSchema(dataSchema: object): object {
	return {
		type: "object",
		required: ["type", "timestamp", "sessionId", "data"],
		properties: {
			type: { type: "string" },
			timestamp: { type: "number", description: "Unix epoch milliseconds" },
			sessionId: { type: "string" },
			agentId: { type: "string" },
			data: dataSchema,
		},
	};
}

// ── Example payload builders ─────────────────────────────────────────────────

const EXAMPLE_SESSION_ID = "abc123def456";
const EXAMPLE_AGENT_ID = "agent-001";
const EXAMPLE_TIMESTAMP = 1_700_000_000_000;

function envelopeExample(
	type: string,
	data: Record<string, unknown>,
	agentId?: string,
): object {
	return {
		type,
		timestamp: EXAMPLE_TIMESTAMP,
		sessionId: EXAMPLE_SESSION_ID,
		...(agentId ? { agentId } : {}),
		data,
	};
}

// ── Component schemas ────────────────────────────────────────────────────────

function buildComponentSchemas(): Record<string, object> {
	const toSchema = (schema: Parameters<typeof zodToJsonSchema>[0]) =>
		zodToJsonSchema(schema, { target: "jsonSchema7" });

	return {
		EventEnvelope: toSchema(EventEnvelopeSchema),
		SessionInfo: toSchema(SessionInfoSchema),
		AgentState: toSchema(AgentStateSchema),
		Snapshot: toSchema(SnapshotSchema),
		SessionDiscovered: toSchema(SessionDiscoveredSchema),
		SessionRemoved: toSchema(SessionRemovedSchema),
		SessionStartedEvent: toSchema(SessionStartedEventSchema),
		SessionStateChangedEvent: toSchema(SessionStateChangedEventSchema),
		MessageUserEvent: toSchema(MessageUserEventSchema),
		MessageAssistantEvent: toSchema(MessageAssistantEventSchema),
		MessageResultEvent: toSchema(MessageResultEventSchema),
		ToolStartedEvent: toSchema(ToolStartedEventSchema),
		ToolCompletedEvent: toSchema(ToolCompletedEventSchema),
		ToolFailedEvent: toSchema(ToolFailedEventSchema),
		AgentStartedEvent: toSchema(AgentStartedEventSchema),
		AgentStoppedEvent: toSchema(AgentStoppedEventSchema),
		ClientMessage: toSchema(ClientMessageSchema),
		SubscribeMessage: toSchema(SubscribeMessageSchema),
		UnsubscribeMessage: toSchema(UnsubscribeMessageSchema),
		GetSnapshotMessage: toSchema(GetSnapshotMessageSchema),
		GetSessionListMessage: toSchema(GetSessionListMessageSchema),
		GetSessionHistoryMessage: toSchema(GetSessionHistoryMessageSchema),
		SubscribeAgentLogMessage: toSchema(SubscribeAgentLogMessageSchema),
		GetUsageMessage: toSchema(GetUsageMessageSchema),
	};
}

// ── Channel / message definitions ────────────────────────────────────────────

interface AsyncApiMessage {
	name: string;
	title: string;
	summary: string;
	payload: object;
	examples?: Array<{ name: string; payload: object }>;
}

interface ChannelDef {
	address: string;
	title: string;
	description: string;
	messages: Record<string, AsyncApiMessage>;
}

function buildChannels(): Record<string, ChannelDef> {
	return {
		// ── Session events ──────────────────────────────────────────────────
		"session/events": {
			address: "session/*",
			title: "Session Events",
			description:
				"Events tracking Claude Code session lifecycle. Published server → client when sessions are discovered, started, changed state, or removed.",
			messages: {
				sessionDiscovered: {
					name: "session.discovered",
					title: "Session Discovered",
					summary: "A new Claude Code session file was found on disk.",
					payload: envelopedSchema({
						type: "object",
						required: ["pid", "sessionId", "cwd", "startedAt"],
						properties: {
							pid: { type: "number" },
							sessionId: { type: "string" },
							cwd: { type: "string" },
							startedAt: { type: "number" },
						},
					}),
					examples: [
						{
							name: "New session found",
							payload: envelopeExample("session.discovered", {
								pid: 12_345,
								sessionId: EXAMPLE_SESSION_ID,
								cwd: "/Users/alice/projects/myapp",
								startedAt: EXAMPLE_TIMESTAMP - 5000,
							}),
						},
					],
				},
				sessionRemoved: {
					name: "session.removed",
					title: "Session Removed",
					summary: "A Claude Code session ended or its file was removed.",
					payload: envelopedSchema({
						type: "object",
						required: ["sessionId", "reason"],
						properties: {
							sessionId: { type: "string" },
							reason: {
								type: "string",
								enum: ["process_exited", "file_removed", "manual"],
							},
						},
					}),
					examples: [
						{
							name: "Session ended",
							payload: envelopeExample("session.removed", {
								sessionId: EXAMPLE_SESSION_ID,
								reason: "process_exited",
							}),
						},
					],
				},
				sessionStarted: {
					name: "session.started",
					title: "Session Started",
					summary:
						"The Claude Code session initialized with model and tool configuration.",
					payload: envelopedSchema({
						type: "object",
						properties: {
							version: { type: "string" },
							model: { type: "string" },
							permissionMode: { type: "string" },
							tools: { type: "array", items: { type: "string" } },
							agents: { type: "array", items: { type: "string" } },
							mcpServers: { type: "array", items: { type: "string" } },
							cwd: { type: "string" },
						},
					}),
					examples: [
						{
							name: "Session initialized",
							payload: envelopeExample("session.started", {
								version: "1.0.0",
								model: "claude-opus-4-5",
								permissionMode: "default",
								tools: ["Bash", "Read", "Write", "Edit"],
								cwd: "/Users/alice/projects/myapp",
							}),
						},
					],
				},
				sessionStateChanged: {
					name: "session.state_changed",
					title: "Session State Changed",
					summary: "The session transitioned to a new state.",
					payload: envelopedSchema({
						type: "object",
						required: ["state"],
						properties: {
							state: {
								type: "string",
								enum: ["idle", "running", "requires_action"],
							},
						},
					}),
					examples: [
						{
							name: "Session now running",
							payload: envelopeExample("session.state_changed", {
								state: "running",
							}),
						},
					],
				},
			},
		},

		// ── Message events ──────────────────────────────────────────────────
		"message/events": {
			address: "message/*",
			title: "Message Events",
			description:
				"Events for conversation messages between user and Claude. Includes user prompts, assistant responses, and turn results.",
			messages: {
				messageUser: {
					name: "message.user",
					title: "User Message",
					summary: "A user prompt was submitted to Claude.",
					payload: envelopedSchema({
						type: "object",
						required: ["text"],
						properties: {
							text: { type: "string" },
							uuid: { type: "string" },
							isSynthetic: { type: "boolean" },
						},
					}),
					examples: [
						{
							name: "User prompt",
							payload: envelopeExample(
								"message.user",
								{
									text: "Can you help me refactor this TypeScript file?",
									uuid: "msg-001",
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
				messageAssistant: {
					name: "message.assistant",
					title: "Assistant Message",
					summary: "Claude produced a response with content blocks.",
					payload: envelopedSchema({
						type: "object",
						required: ["contentBlocks"],
						properties: {
							contentBlocks: {
								type: "array",
								items: {
									oneOf: [
										{
											type: "object",
											required: ["type", "text"],
											properties: {
												type: { const: "text" },
												text: { type: "string" },
											},
										},
										{
											type: "object",
											required: ["type", "id", "name", "input"],
											properties: {
												type: { const: "tool_use" },
												id: { type: "string" },
												name: { type: "string" },
												input: { type: "object" },
											},
										},
										{
											type: "object",
											required: ["type", "thinking"],
											properties: {
												type: { const: "thinking" },
												thinking: { type: "string" },
											},
										},
									],
								},
							},
							uuid: { type: "string" },
							model: { type: "string" },
						},
					}),
					examples: [
						{
							name: "Text response",
							payload: envelopeExample(
								"message.assistant",
								{
									contentBlocks: [
										{
											type: "text",
											text: "Sure! I can help with that. Let me read the file first.",
										},
										{
											type: "tool_use",
											id: "toolu_01",
											name: "Read",
											input: { file_path: "/src/foo.ts" },
										},
									],
									model: "claude-opus-4-5",
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
				messageResult: {
					name: "message.result",
					title: "Message Result",
					summary: "A conversation turn completed with timing and cost data.",
					payload: envelopedSchema({
						type: "object",
						properties: {
							subtype: {
								type: "string",
								enum: [
									"success",
									"error_during_execution",
									"error_max_turns",
									"error_max_budget_usd",
								],
							},
							durationMs: { type: "number" },
							durationApiMs: { type: "number" },
							numTurns: { type: "number" },
							totalCostUsd: { type: "number" },
							usage: {
								type: "object",
								properties: {
									input_tokens: { type: "number" },
									output_tokens: { type: "number" },
									cache_read_tokens: { type: "number" },
									cache_creation_tokens: { type: "number" },
								},
							},
						},
					}),
					examples: [
						{
							name: "Successful turn",
							payload: envelopeExample(
								"message.result",
								{
									subtype: "success",
									durationMs: 3241,
									durationApiMs: 2800,
									numTurns: 2,
									totalCostUsd: 0.0142,
									usage: {
										input_tokens: 1200,
										output_tokens: 450,
										cache_read_tokens: 800,
									},
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
			},
		},

		// ── Tool events ─────────────────────────────────────────────────────
		"tool/events": {
			address: "tool/*",
			title: "Tool Events",
			description:
				"Events for tool invocations made by Claude. Covers the full lifecycle: started, completed, and failed.",
			messages: {
				toolStarted: {
					name: "tool.started",
					title: "Tool Started",
					summary: "Claude began executing a tool.",
					payload: envelopedSchema({
						type: "object",
						required: ["toolName", "toolUseId", "inputSummary"],
						properties: {
							toolName: { type: "string" },
							toolUseId: { type: "string" },
							inputSummary: { type: "string" },
						},
					}),
					examples: [
						{
							name: "Bash tool started",
							payload: envelopeExample(
								"tool.started",
								{
									toolName: "Bash",
									toolUseId: "toolu_01",
									inputSummary: "ls -la /src",
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
				toolCompleted: {
					name: "tool.completed",
					title: "Tool Completed",
					summary: "A tool finished successfully.",
					payload: envelopedSchema({
						type: "object",
						required: ["toolName", "toolUseId", "durationMs", "outputSummary"],
						properties: {
							toolName: { type: "string" },
							toolUseId: { type: "string" },
							durationMs: { type: "number" },
							outputSummary: { type: "string" },
						},
					}),
					examples: [
						{
							name: "Tool success",
							payload: envelopeExample(
								"tool.completed",
								{
									toolName: "Bash",
									toolUseId: "toolu_01",
									durationMs: 312,
									outputSummary: "src/\nindex.ts\nserver.ts\n",
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
				toolFailed: {
					name: "tool.failed",
					title: "Tool Failed",
					summary: "A tool execution failed or was interrupted.",
					payload: envelopedSchema({
						type: "object",
						required: ["toolName", "toolUseId", "error"],
						properties: {
							toolName: { type: "string" },
							toolUseId: { type: "string" },
							error: { type: "string" },
							isInterrupt: { type: "boolean" },
						},
					}),
					examples: [
						{
							name: "Command failed",
							payload: envelopeExample(
								"tool.failed",
								{
									toolName: "Bash",
									toolUseId: "toolu_02",
									error: "Command exited with code 127: command not found",
									isInterrupt: false,
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
			},
		},

		// ── Hook events ─────────────────────────────────────────────────────
		"hook/events": {
			address: "hook/*",
			title: "Hook Events",
			description:
				"Events emitted from Claude Code hooks (PreToolUse, PostToolUse, etc.). These arrive via the HTTP POST /hook endpoint and are forwarded to WebSocket subscribers.",
			messages: {
				hookPreToolUse: {
					name: "hook.pre_tool_use",
					title: "Hook: Pre Tool Use",
					summary:
						"Claude Code fired a PreToolUse hook before invoking a tool.",
					payload: envelopedSchema({
						type: "object",
						properties: {
							tool_name: { type: "string" },
							tool_input: { type: "object" },
						},
					}),
					examples: [
						{
							name: "Pre-tool hook",
							payload: envelopeExample(
								"hook.pre_tool_use",
								{
									tool_name: "Bash",
									tool_input: { command: "npm test" },
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
				hookPostToolUse: {
					name: "hook.post_tool_use",
					title: "Hook: Post Tool Use",
					summary:
						"Claude Code fired a PostToolUse hook after a tool completed successfully.",
					payload: envelopedSchema({
						type: "object",
						properties: {
							tool_name: { type: "string" },
							tool_input: { type: "object" },
							tool_response: { type: "object" },
						},
					}),
					examples: [
						{
							name: "Post-tool hook",
							payload: envelopeExample(
								"hook.post_tool_use",
								{
									tool_name: "Bash",
									tool_input: { command: "npm test" },
									tool_response: { output: "All tests passed." },
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
				hookPostToolUseFailure: {
					name: "hook.post_tool_use_failure",
					title: "Hook: Post Tool Use Failure",
					summary: "Claude Code fired a PostToolUseFailure hook.",
					payload: envelopedSchema({
						type: "object",
						properties: {
							tool_name: { type: "string" },
							tool_input: { type: "object" },
							error: { type: "string" },
						},
					}),
					examples: [
						{
							name: "Tool failure hook",
							payload: envelopeExample(
								"hook.post_tool_use_failure",
								{
									tool_name: "Bash",
									tool_input: { command: "rm -rf /" },
									error: "Permission denied",
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
			},
		},

		// ── Agent events ────────────────────────────────────────────────────
		"agent/events": {
			address: "agent/*",
			title: "Agent Events",
			description:
				"Events for Claude Code agent lifecycle and status changes. Subagents are tracked independently with their own agentId.",
			messages: {
				agentStarted: {
					name: "agent.started",
					title: "Agent Started",
					summary: "An agent (or subagent) began a session.",
					payload: envelopedSchema({
						type: "object",
						required: ["agentId", "agentType"],
						properties: {
							agentId: { type: "string" },
							agentType: { type: "string" },
							cwd: { type: "string" },
							parentToolUseId: { type: "string" },
						},
					}),
					examples: [
						{
							name: "Subagent started",
							payload: envelopeExample(
								"agent.started",
								{
									agentId: EXAMPLE_AGENT_ID,
									agentType: "subagent",
									cwd: "/Users/alice/projects/myapp",
									parentToolUseId: "toolu_03",
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
				agentStopped: {
					name: "agent.stopped",
					title: "Agent Stopped",
					summary: "An agent completed or was terminated.",
					payload: envelopedSchema({
						type: "object",
						required: ["agentId"],
						properties: {
							agentId: { type: "string" },
							reason: { type: "string" },
						},
					}),
					examples: [
						{
							name: "Agent completed",
							payload: envelopeExample(
								"agent.stopped",
								{
									agentId: EXAMPLE_AGENT_ID,
									reason: "completed",
								},
								EXAMPLE_AGENT_ID,
							),
						},
					],
				},
				agentStateChanged: {
					name: "agent.state_changed",
					title: "Agent State Changed",
					summary:
						"One or more agents in a session changed status (working, tool_running, idle, offline).",
					payload: envelopedSchema({
						type: "object",
						required: ["agents"],
						properties: {
							agents: {
								type: "array",
								items: {
									type: "object",
									required: [
										"agentId",
										"agentType",
										"sessionId",
										"status",
										"startedAt",
										"lastActivityAt",
										"toolCount",
										"tokenCount",
										"cwd",
										"toolHistory",
									],
									properties: {
										agentId: { type: "string" },
										agentType: { type: "string" },
										sessionId: { type: "string" },
										status: {
											type: "string",
											enum: ["working", "tool_running", "idle", "offline"],
										},
										currentTool: { type: "string" },
										currentToolInput: { type: "string" },
										startedAt: { type: "number" },
										lastActivityAt: { type: "number" },
										toolCount: { type: "number" },
										tokenCount: { type: "number" },
										cwd: { type: "string" },
										name: { type: "string" },
										toolHistory: { type: "array", items: { type: "object" } },
									},
								},
							},
						},
					}),
					examples: [
						{
							name: "Agent now working",
							payload: envelopeExample("agent.state_changed", {
								agents: [
									{
										agentId: EXAMPLE_AGENT_ID,
										agentType: "primary",
										sessionId: EXAMPLE_SESSION_ID,
										status: "working",
										startedAt: EXAMPLE_TIMESTAMP - 10_000,
										lastActivityAt: EXAMPLE_TIMESTAMP,
										toolCount: 5,
										tokenCount: 3200,
										cwd: "/Users/alice/projects/myapp",
										toolHistory: [],
									},
								],
							}),
						},
					],
				},
			},
		},

		// ── Usage events ────────────────────────────────────────────────────
		"usage/events": {
			address: "usage/*",
			title: "Usage Events",
			description:
				"Token usage and cost tracking events, emitted per session and globally.",
			messages: {
				usageUpdate: {
					name: "usage.update",
					title: "Usage Update",
					summary:
						"Cumulative token and cost totals for a session were updated.",
					payload: envelopedSchema({
						type: "object",
						properties: {
							inputTokens: { type: "number" },
							outputTokens: { type: "number" },
							cacheCreationInputTokens: { type: "number" },
							cacheReadInputTokens: { type: "number" },
							totalCostUsd: { type: "number" },
							durationMs: { type: "number" },
							numTurns: { type: "number" },
						},
					}),
					examples: [
						{
							name: "Usage totals",
							payload: envelopeExample("usage.update", {
								inputTokens: 5200,
								outputTokens: 1800,
								cacheCreationInputTokens: 1200,
								cacheReadInputTokens: 2000,
								totalCostUsd: 0.0842,
								durationMs: 45_000,
								numTurns: 8,
							}),
						},
					],
				},
				usageRateLimit: {
					name: "usage.rate_limit",
					title: "Usage Rate Limit",
					summary: "A rate limit was encountered during the session.",
					payload: envelopedSchema({
						type: "object",
						properties: {
							retryAfterMs: { type: "number" },
							limitType: { type: "string" },
						},
					}),
					examples: [
						{
							name: "Rate limit hit",
							payload: envelopeExample("usage.rate_limit", {
								retryAfterMs: 60_000,
								limitType: "requests_per_minute",
							}),
						},
					],
				},
				usageContext: {
					name: "usage.context",
					title: "Usage Context",
					summary: "Context window usage reported for a session.",
					payload: envelopedSchema({
						type: "object",
						properties: {
							contextWindowTokens: { type: "number" },
							maxContextWindowTokens: { type: "number" },
						},
					}),
					examples: [
						{
							name: "Context usage",
							payload: envelopeExample("usage.context", {
								contextWindowTokens: 45_000,
								maxContextWindowTokens: 200_000,
							}),
						},
					],
				},
			},
		},

		// ── Client → server messages ─────────────────────────────────────────
		"client/commands": {
			address: "/",
			title: "Client Commands",
			description:
				"Messages the client sends to the server over the WebSocket connection to subscribe, query, and control the session.",
			messages: {
				subscribe: {
					name: "subscribe",
					title: "Subscribe",
					summary:
						"Subscribe to one or more event topics. Supports exact names and glob patterns (e.g. `session.*`, `tool.*`).",
					payload: {
						type: "object",
						required: ["type", "topics"],
						properties: {
							type: { const: "subscribe" },
							topics: {
								type: "array",
								items: { type: "string" },
								minItems: 1,
							},
							sessionId: {
								type: "string",
								description:
									"Optional session filter — only receive events for this session.",
							},
						},
					},
					examples: [
						{
							name: "Subscribe to all tool events",
							payload: {
								type: "subscribe",
								topics: ["tool.*"],
								sessionId: EXAMPLE_SESSION_ID,
							},
						},
					],
				},
				unsubscribe: {
					name: "unsubscribe",
					title: "Unsubscribe",
					summary: "Unsubscribe from one or more previously subscribed topics.",
					payload: {
						type: "object",
						required: ["type", "topics"],
						properties: {
							type: { const: "unsubscribe" },
							topics: {
								type: "array",
								items: { type: "string" },
								minItems: 1,
							},
						},
					},
					examples: [
						{
							name: "Unsubscribe from tool events",
							payload: { type: "unsubscribe", topics: ["tool.*"] },
						},
					],
				},
				getSnapshot: {
					name: "get_snapshot",
					title: "Get Snapshot",
					summary:
						"Request the current snapshot of all sessions and agents. Server responds with a `snapshot` message.",
					payload: {
						type: "object",
						required: ["type"],
						properties: { type: { const: "get_snapshot" } },
					},
					examples: [
						{ name: "Request snapshot", payload: { type: "get_snapshot" } },
					],
				},
				getSessionList: {
					name: "get_session_list",
					title: "Get Session List",
					summary:
						"Request the list of all known sessions. Server responds with a `session_list` message.",
					payload: {
						type: "object",
						required: ["type"],
						properties: { type: { const: "get_session_list" } },
					},
					examples: [
						{
							name: "Request session list",
							payload: { type: "get_session_list" },
						},
					],
				},
				getSessionHistory: {
					name: "get_session_history",
					title: "Get Session History",
					summary:
						"Request parsed event history for a session. Server responds with a `session_history` message.",
					payload: {
						type: "object",
						required: ["type", "sessionId"],
						properties: {
							type: { const: "get_session_history" },
							sessionId: { type: "string" },
							limit: {
								type: "integer",
								minimum: 1,
								description: "Maximum events to return (default: 1000)",
							},
						},
					},
					examples: [
						{
							name: "Last 100 events",
							payload: {
								type: "get_session_history",
								sessionId: EXAMPLE_SESSION_ID,
								limit: 100,
							},
						},
					],
				},
				subscribeAgentLog: {
					name: "subscribe_agent_log",
					title: "Subscribe Agent Log",
					summary:
						"Subscribe to raw JSONL log lines for a session. The server will forward each line as an `agent_log` message.",
					payload: {
						type: "object",
						required: ["type", "sessionId"],
						properties: {
							type: { const: "subscribe_agent_log" },
							sessionId: { type: "string" },
						},
					},
					examples: [
						{
							name: "Stream raw log",
							payload: {
								type: "subscribe_agent_log",
								sessionId: EXAMPLE_SESSION_ID,
							},
						},
					],
				},
				getUsage: {
					name: "get_usage",
					title: "Get Usage",
					summary:
						"Request usage totals. Omit sessionId for global totals. Server responds with a `usage` message.",
					payload: {
						type: "object",
						required: ["type"],
						properties: {
							type: { const: "get_usage" },
							sessionId: {
								type: "string",
								description:
									"If omitted, returns global totals across all sessions.",
							},
						},
					},
					examples: [
						{
							name: "Global usage",
							payload: { type: "get_usage" },
						},
						{
							name: "Session usage",
							payload: { type: "get_usage", sessionId: EXAMPLE_SESSION_ID },
						},
					],
				},
			},
		},
	};
}

// ── Top-level spec builder ────────────────────────────────────────────────────

export function generateAsyncApiSpec(): object {
	const channels = buildChannels();
	const componentSchemas = buildComponentSchemas();

	// Build AsyncAPI 3.0 channels object
	const asyncApiChannels: Record<string, object> = {};
	const asyncApiOperations: Record<string, object> = {};
	const asyncApiMessages: Record<string, object> = {};

	for (const [channelKey, channelDef] of Object.entries(channels)) {
		// Register messages in components
		const channelMessageRefs: Record<string, object> = {};

		for (const [msgKey, msg] of Object.entries(channelDef.messages)) {
			const componentMsgKey = `${channelKey.replace("/", "_")}_${msgKey}`;
			asyncApiMessages[componentMsgKey] = {
				name: msg.name,
				title: msg.title,
				summary: msg.summary,
				payload: msg.payload,
				...(msg.examples ? { examples: msg.examples } : {}),
			};
			channelMessageRefs[msgKey] = {
				$ref: `#/components/messages/${componentMsgKey}`,
			};
		}

		asyncApiChannels[channelKey] = {
			address: channelDef.address,
			title: channelDef.title,
			description: channelDef.description,
			messages: channelMessageRefs,
		};

		// Operations: client → server channels use "receive" action; all others use "send"
		const isClientChannel = channelKey === "client/commands";
		const operationKey = isClientChannel
			? "clientCommands"
			: `receive_${channelKey.replace("/", "_")}`;

		asyncApiOperations[operationKey] = {
			action: isClientChannel ? "receive" : "send",
			channel: { $ref: `#/channels/${channelKey}` },
			summary: channelDef.description,
			messages: Object.keys(channelDef.messages).map((k) => ({
				$ref: `#/channels/${channelKey}/messages/${k}`,
			})),
		};
	}

	const description = [
		"# claw-socket WebSocket API",
		"",
		"Real-time event streaming for Claude Code sessions via WebSocket.",
		"",
		"## Connecting",
		"",
		"Connect to `ws://localhost:3838` (or your configured host/port). On connect,",
		"the server immediately sends a `snapshot` message containing all current",
		"sessions and agent states — no subscription required.",
		"",
		"## Subscribing to Topics",
		"",
		"Send a `subscribe` message with an array of topic patterns. Topics use dot",
		"notation matching event `type` fields (e.g. `session.discovered`,",
		"`tool.started`). Glob patterns are supported:",
		"",
		"- `session.*` — all session events",
		"- `tool.*` — all tool events",
		"- `message.*` — all message events",
		"- `agent.*` — all agent events",
		"- `usage.*` — all usage events",
		"- `hook.*` — all hook events",
		"",
		"Include an optional `sessionId` to filter events to a single Claude session.",
		"",
		"## Request / Response Commands",
		"",
		"| Client sends          | Server responds with  |",
		"|-----------------------|-----------------------|",
		"| `get_snapshot`        | `snapshot`            |",
		"| `get_session_list`    | `session_list`        |",
		"| `get_session_history` | `session_history`     |",
		"| `get_usage`           | `usage`               |",
		"| `subscribe_agent_log` | `subscribed_agent_log`, then `agent_log` lines |",
		"",
		"## Hook Integration",
		"",
		"Claude Code hooks can POST to `POST /hook` to emit events directly. Clients",
		"subscribed to `hook.*` will receive these in real-time.",
	].join("\n");

	return {
		asyncapi: "3.0.0",
		info: {
			title: "claw-socket",
			version: "0.1.0",
			description,
			contact: {
				name: "claw-socket",
				url: "https://github.com/ractive/claw-socket",
			},
			license: { name: "MIT" },
		},
		servers: {
			localhost: {
				host: "localhost:3838",
				protocol: "ws",
				description:
					"Default local server. Configure port via SERVER_PORT environment variable.",
				security: [],
			},
		},
		channels: asyncApiChannels,
		operations: asyncApiOperations,
		components: {
			messages: asyncApiMessages,
			schemas: componentSchemas,
		},
	};
}
