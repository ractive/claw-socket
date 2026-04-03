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
	ReplayMessageSchema,
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
	UnsubscribeAgentLogMessageSchema,
	UnsubscribeMessageSchema,
} from "./schemas/index.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const EXAMPLE_SESSION_ID = "abc123def456";
const EXAMPLE_AGENT_ID = "agent-001";
const EXAMPLE_TS = 1_700_000_000_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a key for use in a JSON Pointer fragment (RFC 6901). */
const jpEscape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

const toSchema = (schema: Parameters<typeof zodToJsonSchema>[0]) =>
	zodToJsonSchema(schema, { target: "jsonSchema7" });

/** Wrap a data schema in the standard EventEnvelope. */
function enveloped(dataSchema: object): object {
	return {
		type: "object",
		required: ["type", "timestamp", "sessionId", "data"],
		properties: {
			type: { type: "string" },
			timestamp: { type: "number", description: "Unix epoch milliseconds" },
			sessionId: { type: "string" },
			agentId: {
				type: "string",
				description: "Present for agent-scoped events",
			},
			seq: {
				type: "integer",
				minimum: 0,
				description: "Monotonically increasing replay sequence number",
			},
			data: dataSchema,
		},
	};
}

function exEnv(
	type: string,
	data: Record<string, unknown>,
	agentId?: string,
): object {
	return {
		type,
		timestamp: EXAMPLE_TS,
		sessionId: EXAMPLE_SESSION_ID,
		...(agentId ? { agentId } : {}),
		data,
	};
}

function props(obj: Record<string, object>, required?: string[]): object {
	return { type: "object", properties: obj, ...(required ? { required } : {}) };
}

// ── Event registry ───────────────────────────────────────────────────────────
//
// To add a new event:
//   1. Add an entry to the appropriate channel's `messages` array below.
//   2. If it has a Zod schema, add it to COMPONENT_SCHEMAS.
//   3. Run `bun test test/asyncapi-generator.test.ts` to verify.
//
// The generator builds the full AsyncAPI 3.0 spec from this registry.

interface MessageDef {
	/** Event type as it appears on the wire, e.g. "session.discovered" */
	name: string;
	title: string;
	summary: string;
	/** JSON Schema for the `data` field (server events) or the full payload (client messages) */
	dataSchema: object;
	/** Whether this is wrapped in an EventEnvelope (default: true for server events) */
	envelope?: boolean;
	examples: Array<{ name: string; payload: object }>;
}

interface ChannelDef {
	address: string;
	title: string;
	description: string;
	/** "send" = server → client, "receive" = client → server */
	action: "send" | "receive";
	messages: MessageDef[];
	/** For request-reply: channel key of the reply channel */
	replyChannel?: string;
}

// ── Server → client event channels ───────────────────────────────────────────

const SESSION_EVENTS: ChannelDef = {
	address: "session/*",
	title: "Session Events",
	description:
		"Events tracking Claude Code session lifecycle. Published when sessions are discovered, started, change state, or are removed.",
	action: "send",
	messages: [
		{
			name: "session.discovered",
			title: "Session Discovered",
			summary: "A new Claude Code session file was found on disk.",
			dataSchema: props(
				{
					pid: { type: "number" },
					sessionId: { type: "string" },
					cwd: { type: "string" },
					startedAt: { type: "number" },
				},
				["pid", "sessionId", "cwd", "startedAt"],
			),
			examples: [
				{
					name: "New session found",
					payload: exEnv("session.discovered", {
						pid: 12345,
						sessionId: EXAMPLE_SESSION_ID,
						cwd: "/Users/alice/projects/myapp",
						startedAt: EXAMPLE_TS - 5000,
					}),
				},
			],
		},
		{
			name: "session.removed",
			title: "Session Removed",
			summary: "A Claude Code session ended or its file was removed.",
			dataSchema: props(
				{
					sessionId: { type: "string" },
					reason: {
						type: "string",
						enum: ["process_exited", "file_removed", "manual"],
					},
				},
				["sessionId", "reason"],
			),
			examples: [
				{
					name: "Session ended",
					payload: exEnv("session.removed", {
						sessionId: EXAMPLE_SESSION_ID,
						reason: "process_exited",
					}),
				},
			],
		},
		{
			name: "session.started",
			title: "Session Started",
			summary:
				"The Claude Code session initialized with model and tool configuration.",
			dataSchema: props({
				version: { type: "string" },
				model: { type: "string" },
				permissionMode: { type: "string" },
				tools: { type: "array", items: { type: "string" } },
				agents: { type: "array", items: { type: "string" } },
				mcpServers: { type: "array", items: { type: "string" } },
				cwd: { type: "string" },
			}),
			examples: [
				{
					name: "Session initialized",
					payload: exEnv("session.started", {
						version: "1.0.0",
						model: "claude-opus-4-5",
						permissionMode: "default",
						tools: ["Bash", "Read", "Write", "Edit"],
						cwd: "/Users/alice/projects/myapp",
					}),
				},
			],
		},
		{
			name: "session.state_changed",
			title: "Session State Changed",
			summary: "The session transitioned to a new state.",
			dataSchema: props(
				{
					state: {
						type: "string",
						enum: ["idle", "running", "requires_action"],
					},
				},
				["state"],
			),
			examples: [
				{
					name: "Session now running",
					payload: exEnv("session.state_changed", { state: "running" }),
				},
			],
		},
	],
};

const MESSAGE_EVENTS: ChannelDef = {
	address: "message/*",
	title: "Message Events",
	description:
		"Events for conversation messages between user and Claude. Includes user prompts, assistant responses, and turn results.",
	action: "send",
	messages: [
		{
			name: "message.user",
			title: "User Message",
			summary: "A user prompt was submitted to Claude.",
			dataSchema: props(
				{
					text: { type: "string" },
					uuid: { type: "string" },
					isSynthetic: { type: "boolean" },
				},
				["text"],
			),
			examples: [
				{
					name: "User prompt",
					payload: exEnv(
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
		{
			name: "message.assistant",
			title: "Assistant Message",
			summary: "Claude produced a response with content blocks.",
			dataSchema: props(
				{
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
				["contentBlocks"],
			),
			examples: [
				{
					name: "Text response",
					payload: exEnv(
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
		{
			name: "message.result",
			title: "Message Result",
			summary: "A conversation turn completed with timing and cost data.",
			dataSchema: props({
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
				usage: props({
					input_tokens: { type: "number" },
					output_tokens: { type: "number" },
					cache_read_tokens: { type: "number" },
					cache_creation_tokens: { type: "number" },
				}),
			}),
			examples: [
				{
					name: "Successful turn",
					payload: exEnv(
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
	],
};

const TOOL_EVENTS: ChannelDef = {
	address: "tool/*",
	title: "Tool Events",
	description:
		"Events for tool invocations made by Claude. Covers the full lifecycle: started, completed, and failed.",
	action: "send",
	messages: [
		{
			name: "tool.started",
			title: "Tool Started",
			summary: "Claude began executing a tool.",
			dataSchema: props(
				{
					toolName: { type: "string" },
					toolUseId: { type: "string" },
					inputSummary: { type: "string" },
				},
				["toolName", "toolUseId", "inputSummary"],
			),
			examples: [
				{
					name: "Bash tool started",
					payload: exEnv(
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
		{
			name: "tool.completed",
			title: "Tool Completed",
			summary: "A tool finished successfully.",
			dataSchema: props(
				{
					toolName: { type: "string" },
					toolUseId: { type: "string" },
					durationMs: { type: "number" },
					outputSummary: { type: "string" },
				},
				["toolName", "toolUseId", "durationMs", "outputSummary"],
			),
			examples: [
				{
					name: "Tool success",
					payload: exEnv(
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
		{
			name: "tool.failed",
			title: "Tool Failed",
			summary: "A tool execution failed or was interrupted.",
			dataSchema: props(
				{
					toolName: { type: "string" },
					toolUseId: { type: "string" },
					error: { type: "string" },
					isInterrupt: { type: "boolean" },
				},
				["toolName", "toolUseId", "error"],
			),
			examples: [
				{
					name: "Command failed",
					payload: exEnv(
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
	],
};

const STREAM_EVENTS: ChannelDef = {
	address: "stream/*",
	title: "Stream Events",
	description:
		"Real-time streaming deltas for text, thinking, and tool use input as they are generated by Claude.",
	action: "send",
	messages: [
		{
			name: "stream.delta",
			title: "Text Delta",
			summary: "A chunk of streamed text content.",
			dataSchema: props(
				{ index: { type: "integer" }, text: { type: "string" } },
				["text"],
			),
			examples: [
				{
					name: "Text chunk",
					payload: exEnv(
						"stream.delta",
						{ index: 0, text: "Sure, let me " },
						EXAMPLE_AGENT_ID,
					),
				},
			],
		},
		{
			name: "stream.thinking_delta",
			title: "Thinking Delta",
			summary: "A chunk of streamed thinking/reasoning content.",
			dataSchema: props(
				{ index: { type: "integer" }, thinking: { type: "string" } },
				["thinking"],
			),
			examples: [
				{
					name: "Thinking chunk",
					payload: exEnv(
						"stream.thinking_delta",
						{ index: 0, thinking: "I need to read the file first..." },
						EXAMPLE_AGENT_ID,
					),
				},
			],
		},
		{
			name: "stream.tool_use_delta",
			title: "Tool Use Input Delta",
			summary: "A chunk of streamed JSON input for a tool_use block.",
			dataSchema: props(
				{ index: { type: "integer" }, partialJson: { type: "string" } },
				["partialJson"],
			),
			examples: [
				{
					name: "Tool input chunk",
					payload: exEnv(
						"stream.tool_use_delta",
						{ index: 1, partialJson: '{"file_path":"/src' },
						EXAMPLE_AGENT_ID,
					),
				},
			],
		},
	],
};

const HOOK_EVENTS: ChannelDef = {
	address: "hook/*",
	title: "Hook Events",
	description:
		"Events emitted from Claude Code hooks. Every hook POST to `/hook` produces a `hook.<snake_case_type>` event with the raw hook data. " +
		"Tool-related hooks also produce `hook.started` / `hook.completed` summary events.",
	action: "send",
	messages: [
		{
			name: "hook.pre_tool_use",
			title: "Hook: Pre Tool Use",
			summary: "Claude Code fired a PreToolUse hook before invoking a tool.",
			dataSchema: props({
				tool_name: { type: "string" },
				tool_input: { type: "object" },
				toolName: { type: "string" },
				toolUseId: { type: "string" },
				inputSummary: { type: "string" },
			}),
			examples: [
				{
					name: "Pre-tool hook",
					payload: exEnv(
						"hook.pre_tool_use",
						{
							tool_name: "Bash",
							tool_input: { command: "npm test" },
							toolName: "Bash",
							toolUseId: "toolu_01",
							inputSummary: '{"command":"npm test"}',
						},
						EXAMPLE_AGENT_ID,
					),
				},
			],
		},
		{
			name: "hook.post_tool_use",
			title: "Hook: Post Tool Use",
			summary:
				"Claude Code fired a PostToolUse hook after a tool completed successfully.",
			dataSchema: props({
				tool_name: { type: "string" },
				tool_input: { type: "object" },
				tool_response: { type: "object" },
				toolName: { type: "string" },
				toolUseId: { type: "string" },
				outputSummary: { type: "string" },
			}),
			examples: [
				{
					name: "Post-tool hook",
					payload: exEnv(
						"hook.post_tool_use",
						{
							tool_name: "Bash",
							tool_input: { command: "npm test" },
							tool_response: { output: "All tests passed." },
							toolName: "Bash",
						},
						EXAMPLE_AGENT_ID,
					),
				},
			],
		},
		{
			name: "hook.post_tool_use_failure",
			title: "Hook: Post Tool Use Failure",
			summary:
				"Claude Code fired a PostToolUseFailure hook after a tool failed.",
			dataSchema: props({
				tool_name: { type: "string" },
				tool_input: { type: "object" },
				error: { type: "string" },
				toolName: { type: "string" },
				isInterrupt: { type: "boolean" },
			}),
			examples: [
				{
					name: "Tool failure hook",
					payload: exEnv(
						"hook.post_tool_use_failure",
						{
							tool_name: "Bash",
							tool_input: { command: "rm -rf /" },
							error: "Permission denied",
							toolName: "Bash",
							isInterrupt: false,
						},
						EXAMPLE_AGENT_ID,
					),
				},
			],
		},
		{
			name: "hook.started",
			title: "Hook Started",
			summary:
				"Summary event: a hook began execution (emitted alongside PreToolUse).",
			dataSchema: props(
				{
					hookType: { type: "string", enum: ["PreToolUse"] },
					toolName: { type: "string" },
				},
				["hookType", "toolName"],
			),
			examples: [
				{
					name: "Hook started",
					payload: exEnv(
						"hook.started",
						{ hookType: "PreToolUse", toolName: "Bash" },
						EXAMPLE_AGENT_ID,
					),
				},
			],
		},
		{
			name: "hook.completed",
			title: "Hook Completed",
			summary:
				"Summary event: a hook finished (emitted alongside PostToolUse / PostToolUseFailure).",
			dataSchema: props(
				{
					hookType: {
						type: "string",
						enum: ["PostToolUse", "PostToolUseFailure"],
					},
					toolName: { type: "string" },
					success: { type: "boolean" },
				},
				["hookType", "toolName", "success"],
			),
			examples: [
				{
					name: "Hook completed",
					payload: exEnv(
						"hook.completed",
						{ hookType: "PostToolUse", toolName: "Bash", success: true },
						EXAMPLE_AGENT_ID,
					),
				},
			],
		},
		{
			name: "hook.session_start",
			title: "Hook: Session Start",
			summary:
				"Claude Code fired a SessionStart hook with initialization data.",
			dataSchema: props({
				mcp_servers: { type: "array", items: { type: "object" } },
			}),
			examples: [
				{
					name: "Session start hook",
					payload: exEnv("hook.session_start", {
						mcp_servers: [{ name: "my-server", status: "connected" }],
					}),
				},
			],
		},
		{
			name: "hook.session_end",
			title: "Hook: Session End",
			summary:
				"Claude Code fired a SessionEnd hook when the session terminated.",
			dataSchema: props({ reason: { type: "string" } }),
			examples: [
				{
					name: "Session end hook",
					payload: exEnv("hook.session_end", { reason: "user_exit" }),
				},
			],
		},
		{
			name: "hook.subagent_start",
			title: "Hook: Subagent Start",
			summary:
				"Claude Code fired a SubagentStart hook when a subagent was spawned.",
			dataSchema: props({
				agent_id: { type: "string" },
				agent_type: { type: "string" },
				cwd: { type: "string" },
			}),
			examples: [
				{
					name: "Subagent start hook",
					payload: exEnv("hook.subagent_start", {
						agent_id: EXAMPLE_AGENT_ID,
						agent_type: "subagent",
						cwd: "/Users/alice/projects/myapp",
					}),
				},
			],
		},
		{
			name: "hook.subagent_stop",
			title: "Hook: Subagent Stop",
			summary:
				"Claude Code fired a SubagentStop hook when a subagent finished.",
			dataSchema: props({ agent_id: { type: "string" } }),
			examples: [
				{
					name: "Subagent stop hook",
					payload: exEnv("hook.subagent_stop", { agent_id: EXAMPLE_AGENT_ID }),
				},
			],
		},
		{
			name: "hook.stop",
			title: "Hook: Stop",
			summary: "Claude Code fired a Stop hook.",
			dataSchema: props({}),
			examples: [{ name: "Stop hook", payload: exEnv("hook.stop", {}) }],
		},
		{
			name: "hook.permission_request",
			title: "Hook: Permission Request",
			summary:
				"Claude Code fired a PermissionRequest hook when user approval is needed.",
			dataSchema: props({
				tool_name: { type: "string" },
				tool_input: { type: "object" },
			}),
			examples: [
				{
					name: "Permission request",
					payload: exEnv("hook.permission_request", {
						tool_name: "Bash",
						tool_input: { command: "rm -rf /tmp/build" },
					}),
				},
			],
		},
		{
			name: "hook.permission_denied",
			title: "Hook: Permission Denied",
			summary:
				"Claude Code fired a PermissionDenied hook when the user denied a tool.",
			dataSchema: props({ tool_name: { type: "string" } }),
			examples: [
				{
					name: "Permission denied",
					payload: exEnv("hook.permission_denied", { tool_name: "Bash" }),
				},
			],
		},
		{
			name: "hook.notification",
			title: "Hook: Notification",
			summary: "Claude Code fired a Notification hook.",
			dataSchema: props({ message: { type: "string" } }),
			examples: [
				{
					name: "Notification",
					payload: exEnv("hook.notification", { message: "Task completed" }),
				},
			],
		},
		{
			name: "hook.user_prompt_submit",
			title: "Hook: User Prompt Submit",
			summary:
				"Claude Code fired a UserPromptSubmit hook when the user submitted a prompt.",
			dataSchema: props({ prompt: { type: "string" } }),
			examples: [
				{
					name: "Prompt submitted",
					payload: exEnv("hook.user_prompt_submit", {
						prompt: "Fix the build",
					}),
				},
			],
		},
		{
			name: "hook.pre_compact",
			title: "Hook: Pre Compact",
			summary: "Claude Code fired a PreCompact hook before context compaction.",
			dataSchema: props({}),
			examples: [
				{ name: "Pre-compact", payload: exEnv("hook.pre_compact", {}) },
			],
		},
		{
			name: "hook.post_compact",
			title: "Hook: Post Compact",
			summary: "Claude Code fired a PostCompact hook after context compaction.",
			dataSchema: props({}),
			examples: [
				{ name: "Post-compact", payload: exEnv("hook.post_compact", {}) },
			],
		},
		{
			name: "hook.elicitation",
			title: "Hook: Elicitation",
			summary:
				"Claude Code fired an Elicitation hook to request user input via MCP.",
			dataSchema: props({
				question: { type: "string" },
				options: { type: "array", items: { type: "object" } },
				timeout: { type: "number" },
				source: { type: "string" },
			}),
			examples: [
				{
					name: "Elicitation",
					payload: exEnv("hook.elicitation", {
						question: "Which file?",
						source: "my-mcp-server",
					}),
				},
			],
		},
		{
			name: "hook.elicitation_result",
			title: "Hook: Elicitation Result",
			summary:
				"Claude Code fired an ElicitationResult hook with the user's answer.",
			dataSchema: props({
				answer: { type: "string" },
				source: { type: "string" },
			}),
			examples: [
				{
					name: "Elicitation result",
					payload: exEnv("hook.elicitation_result", {
						answer: "src/index.ts",
						source: "my-mcp-server",
					}),
				},
			],
		},
		{
			name: "hook.config_change",
			title: "Hook: Config Change",
			summary:
				"Claude Code fired a ConfigChange hook when configuration was modified.",
			dataSchema: props({}),
			examples: [
				{ name: "Config change", payload: exEnv("hook.config_change", {}) },
			],
		},
		{
			name: "hook.instructions_loaded",
			title: "Hook: Instructions Loaded",
			summary: "Claude Code fired an InstructionsLoaded hook.",
			dataSchema: props({}),
			examples: [
				{
					name: "Instructions loaded",
					payload: exEnv("hook.instructions_loaded", {}),
				},
			],
		},
		{
			name: "hook.cwd_changed",
			title: "Hook: CWD Changed",
			summary:
				"Claude Code fired a CwdChanged hook when the working directory changed.",
			dataSchema: props({
				cwd: { type: "string" },
				new_cwd: { type: "string" },
				old_cwd: { type: "string" },
			}),
			examples: [
				{
					name: "CWD changed hook",
					payload: exEnv("hook.cwd_changed", {
						cwd: "/Users/alice/projects/other",
					}),
				},
			],
		},
		{
			name: "hook.file_changed",
			title: "Hook: File Changed",
			summary: "Claude Code fired a FileChanged hook when a file was modified.",
			dataSchema: props({
				path: { type: "string" },
				change_type: { type: "string" },
			}),
			examples: [
				{
					name: "File changed hook",
					payload: exEnv("hook.file_changed", {
						path: "/src/index.ts",
						change_type: "modified",
					}),
				},
			],
		},
		{
			name: "hook.task_created",
			title: "Hook: Task Created",
			summary: "Claude Code fired a TaskCreated hook.",
			dataSchema: props({}),
			examples: [
				{ name: "Task created", payload: exEnv("hook.task_created", {}) },
			],
		},
		{
			name: "hook.task_completed",
			title: "Hook: Task Completed",
			summary: "Claude Code fired a TaskCompleted hook.",
			dataSchema: props({}),
			examples: [
				{ name: "Task completed", payload: exEnv("hook.task_completed", {}) },
			],
		},
		{
			name: "hook.teammate_idle",
			title: "Hook: Teammate Idle",
			summary: "Claude Code fired a TeammateIdle hook.",
			dataSchema: props({}),
			examples: [
				{ name: "Teammate idle", payload: exEnv("hook.teammate_idle", {}) },
			],
		},
		{
			name: "hook.worktree_create",
			title: "Hook: Worktree Create",
			summary: "Claude Code fired a WorktreeCreate hook.",
			dataSchema: props({}),
			examples: [
				{ name: "Worktree create", payload: exEnv("hook.worktree_create", {}) },
			],
		},
		{
			name: "hook.worktree_remove",
			title: "Hook: Worktree Remove",
			summary: "Claude Code fired a WorktreeRemove hook.",
			dataSchema: props({}),
			examples: [
				{ name: "Worktree remove", payload: exEnv("hook.worktree_remove", {}) },
			],
		},
	],
};

const AGENT_EVENTS: ChannelDef = {
	address: "agent/*",
	title: "Agent Events",
	description:
		"Events for Claude Code agent lifecycle and status changes. Subagents are tracked independently with their own agentId.",
	action: "send",
	messages: [
		{
			name: "agent.started",
			title: "Agent Started",
			summary: "An agent (or subagent) began a session.",
			dataSchema: props(
				{
					agentId: { type: "string" },
					agentType: { type: "string" },
					cwd: { type: "string" },
					parentToolUseId: { type: "string" },
					source: {
						type: "string",
						description: '"hook" when originating from a SubagentStart hook',
					},
				},
				["agentId", "agentType"],
			),
			examples: [
				{
					name: "Subagent started",
					payload: exEnv(
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
		{
			name: "agent.stopped",
			title: "Agent Stopped",
			summary: "An agent completed or was terminated.",
			dataSchema: props(
				{
					agentId: { type: "string" },
					reason: { type: "string" },
					source: { type: "string" },
				},
				["agentId"],
			),
			examples: [
				{
					name: "Agent completed",
					payload: exEnv(
						"agent.stopped",
						{ agentId: EXAMPLE_AGENT_ID, reason: "completed" },
						EXAMPLE_AGENT_ID,
					),
				},
			],
		},
		{
			name: "agent.state_changed",
			title: "Agent State Changed",
			summary:
				"One or more agents in a session changed status (working, tool_running, idle, offline).",
			dataSchema: props(
				{
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
				["agents"],
			),
			examples: [
				{
					name: "Agent now working",
					payload: exEnv("agent.state_changed", {
						agents: [
							{
								agentId: EXAMPLE_AGENT_ID,
								agentType: "primary",
								sessionId: EXAMPLE_SESSION_ID,
								status: "working",
								startedAt: EXAMPLE_TS - 10000,
								lastActivityAt: EXAMPLE_TS,
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
	],
};

const USAGE_EVENTS: ChannelDef = {
	address: "usage/*",
	title: "Usage Events",
	description:
		"Token usage and cost tracking events, emitted per session and globally.",
	action: "send",
	messages: [
		{
			name: "usage.update",
			title: "Usage Update",
			summary: "Cumulative token and cost totals for a session were updated.",
			dataSchema: props({
				inputTokens: { type: "number" },
				outputTokens: { type: "number" },
				cacheCreationInputTokens: { type: "number" },
				cacheReadInputTokens: { type: "number" },
				totalCostUsd: { type: "number" },
				durationMs: { type: "number" },
				numTurns: { type: "number" },
			}),
			examples: [
				{
					name: "Usage totals",
					payload: exEnv("usage.update", {
						inputTokens: 5200,
						outputTokens: 1800,
						cacheCreationInputTokens: 1200,
						cacheReadInputTokens: 2000,
						totalCostUsd: 0.0842,
						durationMs: 45000,
						numTurns: 8,
					}),
				},
			],
		},
		{
			name: "usage.rate_limit",
			title: "Usage Rate Limit",
			summary: "A rate limit was encountered during the session.",
			dataSchema: props({
				allowed: { type: "boolean" },
				type: { type: "string" },
				message: { type: "string" },
				retryAfter: { type: "number" },
			}),
			examples: [
				{
					name: "Rate limit hit",
					payload: exEnv("usage.rate_limit", {
						allowed: false,
						type: "requests_per_minute",
						message: "Rate limited",
						retryAfter: 60,
					}),
				},
			],
		},
		{
			name: "usage.context",
			title: "Usage Context",
			summary: "Context window usage reported for a session.",
			dataSchema: props({
				percentUsed: { type: "number" },
				tokensUsed: { type: "number" },
				tokensMax: { type: "number" },
				categories: {
					type: "object",
					additionalProperties: { type: "number" },
				},
			}),
			examples: [
				{
					name: "Context usage",
					payload: exEnv("usage.context", {
						percentUsed: 22.5,
						tokensUsed: 45000,
						tokensMax: 200000,
					}),
				},
			],
		},
	],
};

const MCP_EVENTS: ChannelDef = {
	address: "mcp/*",
	title: "MCP Events",
	description:
		"Events related to MCP (Model Context Protocol) servers and elicitation. Derived from Claude Code hooks.",
	action: "send",
	messages: [
		{
			name: "mcp.server_status",
			title: "MCP Server Status",
			summary:
				"Status of an MCP server reported during session initialization.",
			dataSchema: props(
				{
					serverName: { type: "string" },
					status: { type: "string" },
					url: { type: "string" },
					tools: { type: "array", items: { type: "string" } },
				},
				["serverName", "status"],
			),
			examples: [
				{
					name: "Server connected",
					payload: exEnv("mcp.server_status", {
						serverName: "my-mcp-server",
						status: "connected",
						tools: ["search", "fetch"],
					}),
				},
			],
		},
		{
			name: "mcp.elicitation",
			title: "MCP Elicitation",
			summary: "An MCP server requested user input via an elicitation hook.",
			dataSchema: props(
				{
					question: { type: "string" },
					options: { type: "array", items: { type: "object" } },
					timeout: { type: "number" },
					source: { type: "string" },
				},
				["question"],
			),
			examples: [
				{
					name: "Elicitation prompt",
					payload: exEnv("mcp.elicitation", {
						question: "Which database to use?",
						options: [{ label: "PostgreSQL" }, { label: "SQLite" }],
						source: "db-server",
					}),
				},
			],
		},
		{
			name: "mcp.elicitation_result",
			title: "MCP Elicitation Result",
			summary: "The user responded to an MCP elicitation prompt.",
			dataSchema: props({
				answer: { type: "string" },
				source: { type: "string" },
			}),
			examples: [
				{
					name: "User answered",
					payload: exEnv("mcp.elicitation_result", {
						answer: "PostgreSQL",
						source: "db-server",
					}),
				},
			],
		},
	],
};

const FILE_EVENTS: ChannelDef = {
	address: "file/*",
	title: "File Events",
	description:
		"File system change notifications derived from Claude Code FileChanged hooks.",
	action: "send",
	messages: [
		{
			name: "file.changed",
			title: "File Changed",
			summary: "A file was created, modified, or deleted during the session.",
			dataSchema: props(
				{
					path: { type: "string" },
					changeType: {
						type: "string",
						description: "e.g. created, modified, deleted",
					},
				},
				["path"],
			),
			examples: [
				{
					name: "File modified",
					payload: exEnv("file.changed", {
						path: "/src/index.ts",
						changeType: "modified",
					}),
				},
			],
		},
	],
};

const CWD_EVENTS: ChannelDef = {
	address: "cwd/*",
	title: "CWD Events",
	description:
		"Working directory change notifications derived from Claude Code CwdChanged hooks.",
	action: "send",
	messages: [
		{
			name: "cwd.changed",
			title: "Working Directory Changed",
			summary: "The session's working directory changed.",
			dataSchema: props(
				{ newCwd: { type: "string" }, oldCwd: { type: "string" } },
				["newCwd"],
			),
			examples: [
				{
					name: "CWD changed",
					payload: exEnv("cwd.changed", {
						newCwd: "/Users/alice/projects/other",
						oldCwd: "/Users/alice/projects/myapp",
					}),
				},
			],
		},
	],
};

const PROMPT_EVENTS: ChannelDef = {
	address: "prompt/*",
	title: "Prompt Events",
	description: "Events related to AI-generated prompt suggestions.",
	action: "send",
	messages: [
		{
			name: "prompt.suggestion",
			title: "Prompt Suggestion",
			summary: "Claude generated suggested follow-up prompts.",
			dataSchema: props(
				{ suggestions: { type: "array", items: { type: "string" } } },
				["suggestions"],
			),
			examples: [
				{
					name: "Suggestions",
					payload: exEnv("prompt.suggestion", {
						suggestions: ["Run the tests", "Deploy to staging"],
					}),
				},
			],
		},
	],
};

const SYSTEM_EVENTS: ChannelDef = {
	address: "system/*",
	title: "System Events",
	description:
		"Internal server events such as errors. Broadcast to all connected clients regardless of subscriptions.",
	action: "send",
	messages: [
		{
			name: "system.error",
			title: "System Error",
			summary: "An internal server error occurred.",
			dataSchema: props(
				{
					source: { type: "string" },
					message: { type: "string" },
					recoverable: { type: "boolean" },
				},
				["source", "message", "recoverable"],
			),
			examples: [
				{
					name: "Recoverable error",
					payload: exEnv("system.error", {
						source: "session_watcher",
						message: "An internal error occurred; the server is continuing.",
						recoverable: true,
					}),
				},
			],
		},
	],
};

// ── Server → client response channel ─────────────────────────────────────────

const SERVER_RESPONSES: ChannelDef = {
	address: "/",
	title: "Server Responses",
	description:
		"Messages sent from the server to the client in response to client commands, or on initial connection.",
	action: "send",
	messages: [
		{
			name: "snapshot",
			title: "Snapshot",
			summary:
				"Full state snapshot sent on connect and in response to get_snapshot.",
			dataSchema: props(
				{
					type: { const: "snapshot" },
					sessions: {
						type: "array",
						items: { $ref: "#/components/schemas/SessionInfo" },
					},
					agents: {
						type: "array",
						items: { $ref: "#/components/schemas/AgentState" },
					},
				},
				["type", "sessions"],
			),
			envelope: false,
			examples: [
				{
					name: "Initial snapshot",
					payload: { type: "snapshot", sessions: [], agents: [] },
				},
			],
		},
		{
			name: "subscribed",
			title: "Subscribed",
			summary: "Acknowledgment after a successful subscribe command.",
			dataSchema: props(
				{
					type: { const: "subscribed" },
					topics: { type: "array", items: { type: "string" } },
				},
				["type", "topics"],
			),
			envelope: false,
			examples: [
				{
					name: "Subscribed ack",
					payload: { type: "subscribed", topics: ["tool.*", "session.*"] },
				},
			],
		},
		{
			name: "unsubscribed",
			title: "Unsubscribed",
			summary: "Acknowledgment after a successful unsubscribe command.",
			dataSchema: props(
				{
					type: { const: "unsubscribed" },
					topics: { type: "array", items: { type: "string" } },
				},
				["type", "topics"],
			),
			envelope: false,
			examples: [
				{
					name: "Unsubscribed ack",
					payload: { type: "unsubscribed", topics: ["session.*"] },
				},
			],
		},
		{
			name: "session_list",
			title: "Session List",
			summary: "List of all known sessions, in response to get_session_list.",
			dataSchema: props(
				{
					type: { const: "session_list" },
					sessions: {
						type: "array",
						items: { $ref: "#/components/schemas/SessionInfo" },
					},
				},
				["type", "sessions"],
			),
			envelope: false,
			examples: [
				{
					name: "Session list",
					payload: { type: "session_list", sessions: [] },
				},
			],
		},
		{
			name: "session_history",
			title: "Session History",
			summary:
				"Parsed event history for a session, in response to get_session_history.",
			dataSchema: props(
				{
					type: { const: "session_history" },
					sessionId: { type: "string" },
					events: {
						type: "array",
						items: { $ref: "#/components/schemas/EventEnvelope" },
					},
				},
				["type", "sessionId", "events"],
			),
			envelope: false,
			examples: [
				{
					name: "Session history",
					payload: {
						type: "session_history",
						sessionId: EXAMPLE_SESSION_ID,
						events: [],
					},
				},
			],
		},
		{
			name: "usage",
			title: "Usage",
			summary: "Usage totals (session or global), in response to get_usage.",
			dataSchema: props(
				{
					type: { const: "usage" },
					sessionId: { type: "string" },
					inputTokens: { type: "number" },
					outputTokens: { type: "number" },
					cacheCreationInputTokens: { type: "number" },
					cacheReadInputTokens: { type: "number" },
					totalCostUsd: { type: "number" },
					durationMs: { type: "number" },
					durationApiMs: { type: "number" },
					numTurns: { type: "number" },
					modelBreakdown: { type: "object" },
					lastUpdatedAt: { type: "number", nullable: true },
				},
				["type"],
			),
			envelope: false,
			examples: [
				{
					name: "Global usage",
					payload: {
						type: "usage",
						inputTokens: 10000,
						outputTokens: 3000,
						totalCostUsd: 0.15,
					},
				},
			],
		},
		{
			name: "subscribed_agent_log",
			title: "Subscribed Agent Log",
			summary: "Acknowledgment after subscribing to raw JSONL log lines.",
			dataSchema: props(
				{
					type: { const: "subscribed_agent_log" },
					sessionId: { type: "string" },
				},
				["type", "sessionId"],
			),
			envelope: false,
			examples: [
				{
					name: "Agent log subscribed",
					payload: {
						type: "subscribed_agent_log",
						sessionId: EXAMPLE_SESSION_ID,
					},
				},
			],
		},
		{
			name: "unsubscribed_agent_log",
			title: "Unsubscribed Agent Log",
			summary: "Acknowledgment after unsubscribing from raw JSONL log lines.",
			dataSchema: props(
				{
					type: { const: "unsubscribed_agent_log" },
					sessionId: { type: "string", nullable: true },
				},
				["type"],
			),
			envelope: false,
			examples: [
				{
					name: "Agent log unsubscribed",
					payload: { type: "unsubscribed_agent_log", sessionId: null },
				},
			],
		},
		{
			name: "agent_log",
			title: "Agent Log Line",
			summary: "A raw JSONL log line forwarded from a watched session.",
			dataSchema: props(
				{
					type: { const: "agent_log" },
					sessionId: { type: "string" },
					line: { type: "string" },
				},
				["type", "sessionId", "line"],
			),
			envelope: false,
			examples: [
				{
					name: "Raw log line",
					payload: {
						type: "agent_log",
						sessionId: EXAMPLE_SESSION_ID,
						line: '{"type":"assistant","message":{"content":[...]}}',
					},
				},
			],
		},
		{
			name: "error",
			title: "Error",
			summary: "Error response to an invalid or failed client command.",
			dataSchema: props(
				{ error: { type: "string" }, message: { type: "string" } },
				["error"],
			),
			envelope: false,
			examples: [
				{ name: "Invalid JSON", payload: { error: "invalid JSON" } },
				{
					name: "Rate limited",
					payload: {
						error: "rate_limited",
						message: "max 2 concurrent get_session_history requests",
					},
				},
			],
		},
	],
};

// ── Client → server command channel ──────────────────────────────────────────

const CLIENT_COMMANDS: ChannelDef = {
	address: "/",
	title: "Client Commands",
	description:
		"Messages the client sends to the server over the WebSocket connection to subscribe, query, and control event streams.",
	action: "receive",
	replyChannel: "server/responses",
	messages: [
		{
			name: "subscribe",
			title: "Subscribe",
			summary:
				"Subscribe to one or more event topics. Supports exact names and glob patterns (e.g. `session.*`, `tool.*`).",
			dataSchema: props(
				{
					type: { const: "subscribe" },
					topics: { type: "array", items: { type: "string" }, minItems: 1 },
					sessionId: {
						type: "string",
						description:
							"Optional session filter — only receive events for this session.",
					},
				},
				["type", "topics"],
			),
			envelope: false,
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
		{
			name: "unsubscribe",
			title: "Unsubscribe",
			summary: "Unsubscribe from one or more previously subscribed topics.",
			dataSchema: props(
				{
					type: { const: "unsubscribe" },
					topics: { type: "array", items: { type: "string" }, minItems: 1 },
				},
				["type", "topics"],
			),
			envelope: false,
			examples: [
				{
					name: "Unsubscribe from tool events",
					payload: { type: "unsubscribe", topics: ["tool.*"] },
				},
			],
		},
		{
			name: "get_snapshot",
			title: "Get Snapshot",
			summary:
				"Request the current snapshot of all sessions and agents. Server responds with a `snapshot` message.",
			dataSchema: props({ type: { const: "get_snapshot" } }, ["type"]),
			envelope: false,
			examples: [
				{ name: "Request snapshot", payload: { type: "get_snapshot" } },
			],
		},
		{
			name: "get_session_list",
			title: "Get Session List",
			summary:
				"Request the list of all known sessions. Server responds with a `session_list` message.",
			dataSchema: props({ type: { const: "get_session_list" } }, ["type"]),
			envelope: false,
			examples: [
				{ name: "Request session list", payload: { type: "get_session_list" } },
			],
		},
		{
			name: "get_session_history",
			title: "Get Session History",
			summary:
				"Request parsed event history for a session. Server responds with a `session_history` message.",
			dataSchema: props(
				{
					type: { const: "get_session_history" },
					sessionId: { type: "string" },
					limit: {
						type: "integer",
						minimum: 1,
						description: "Maximum events to return (default: 1000)",
					},
				},
				["type", "sessionId"],
			),
			envelope: false,
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
		{
			name: "subscribe_agent_log",
			title: "Subscribe Agent Log",
			summary:
				"Subscribe to raw JSONL log lines for a session. The server will forward each line as an `agent_log` message.",
			dataSchema: props(
				{
					type: { const: "subscribe_agent_log" },
					sessionId: { type: "string" },
				},
				["type", "sessionId"],
			),
			envelope: false,
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
		{
			name: "unsubscribe_agent_log",
			title: "Unsubscribe Agent Log",
			summary:
				"Unsubscribe from raw JSONL log lines. Omit sessionId to clear all agent log subscriptions.",
			dataSchema: props(
				{
					type: { const: "unsubscribe_agent_log" },
					sessionId: {
						type: "string",
						description: "If omitted, clears all agent log subscriptions.",
					},
				},
				["type"],
			),
			envelope: false,
			examples: [
				{
					name: "Stop streaming log",
					payload: {
						type: "unsubscribe_agent_log",
						sessionId: EXAMPLE_SESSION_ID,
					},
				},
			],
		},
		{
			name: "get_usage",
			title: "Get Usage",
			summary:
				"Request usage totals. Omit sessionId for global totals. Server responds with a `usage` message.",
			dataSchema: props(
				{
					type: { const: "get_usage" },
					sessionId: {
						type: "string",
						description:
							"If omitted, returns global totals across all sessions.",
					},
				},
				["type"],
			),
			envelope: false,
			examples: [
				{ name: "Global usage", payload: { type: "get_usage" } },
				{
					name: "Session usage",
					payload: { type: "get_usage", sessionId: EXAMPLE_SESSION_ID },
				},
			],
		},
		{
			name: "replay",
			title: "Replay",
			summary:
				"Request replay of buffered events after a sequence number. Useful for reconnecting clients to catch up on missed events.",
			dataSchema: props(
				{
					type: { const: "replay" },
					lastSeq: {
						type: "integer",
						minimum: 0,
						description: "Replay all buffered events with seq > lastSeq",
					},
				},
				["type", "lastSeq"],
			),
			envelope: false,
			examples: [
				{
					name: "Catch up from seq 42",
					payload: { type: "replay", lastSeq: 42 },
				},
			],
		},
	],
};

// ── Channel registry ─────────────────────────────────────────────────────────
//
// Order here determines order in the generated spec.

const CHANNEL_REGISTRY: Record<string, ChannelDef> = {
	"session/events": SESSION_EVENTS,
	"message/events": MESSAGE_EVENTS,
	"tool/events": TOOL_EVENTS,
	"stream/events": STREAM_EVENTS,
	"agent/events": AGENT_EVENTS,
	"usage/events": USAGE_EVENTS,
	"hook/events": HOOK_EVENTS,
	"mcp/events": MCP_EVENTS,
	"file/events": FILE_EVENTS,
	"cwd/events": CWD_EVENTS,
	"prompt/events": PROMPT_EVENTS,
	"system/events": SYSTEM_EVENTS,
	"client/commands": CLIENT_COMMANDS,
	"server/responses": SERVER_RESPONSES,
};

// ── Component schemas (from Zod) ─────────────────────────────────────────────

function buildComponentSchemas(): Record<string, object> {
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
		UnsubscribeAgentLogMessage: toSchema(UnsubscribeAgentLogMessageSchema),
		GetUsageMessage: toSchema(GetUsageMessageSchema),
		ReplayMessage: toSchema(ReplayMessageSchema),
	};
}

// ── Spec builder ─────────────────────────────────────────────────────────────

export function generateAsyncApiSpec(): object {
	const componentSchemas = buildComponentSchemas();
	const asyncApiChannels: Record<string, object> = {};
	const asyncApiOperations: Record<string, object> = {};
	const asyncApiMessages: Record<string, object> = {};

	// Message trait for the common envelope fields
	const envelopeTrait = {
		headers: {
			type: "object",
			properties: {
				type: {
					type: "string",
					description: "Event type (dot-separated namespace)",
				},
				timestamp: { type: "number", description: "Unix epoch milliseconds" },
				sessionId: { type: "string" },
				agentId: { type: "string" },
				seq: {
					type: "integer",
					minimum: 0,
					description: "Replay sequence number",
				},
			},
		},
	};

	for (const [channelKey, channelDef] of Object.entries(CHANNEL_REGISTRY)) {
		const channelMessageRefs: Record<string, object> = {};
		const safeChannelKey = channelKey.replace("/", "_");

		for (const msg of channelDef.messages) {
			const msgKey = msg.name.replace(/\./g, "_");
			const componentKey = `${safeChannelKey}__${msgKey}`;

			const useEnvelope =
				msg.envelope !== false &&
				channelDef.action === "send" &&
				channelKey !== "server/responses";
			const payload = useEnvelope ? enveloped(msg.dataSchema) : msg.dataSchema;

			asyncApiMessages[componentKey] = {
				name: msg.name,
				title: msg.title,
				summary: msg.summary,
				contentType: "application/json",
				payload,
				...(useEnvelope
					? { traits: [{ $ref: "#/components/messageTraits/eventEnvelope" }] }
					: {}),
				examples: msg.examples,
			};

			channelMessageRefs[msgKey] = {
				$ref: `#/components/messages/${componentKey}`,
			};
		}

		asyncApiChannels[channelKey] = {
			address: channelDef.address,
			title: channelDef.title,
			description: channelDef.description,
			messages: channelMessageRefs,
		};

		const operationKey =
			channelDef.action === "receive"
				? "clientCommands"
				: `send_${safeChannelKey}`;

		const operation: Record<string, unknown> = {
			action: channelDef.action,
			channel: { $ref: `#/channels/${jpEscape(channelKey)}` },
			summary: channelDef.description,
			messages: channelDef.messages.map((m) => ({
				$ref: `#/channels/${jpEscape(channelKey)}/messages/${m.name.replace(/\./g, "_")}`,
			})),
		};

		// AsyncAPI 3.0 request-reply pattern
		if (channelDef.replyChannel) {
			operation["reply"] = {
				channel: { $ref: `#/channels/${jpEscape(channelDef.replyChannel)}` },
			};
		}

		asyncApiOperations[operationKey] = operation;
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
		"- `message.*` — all message events",
		"- `tool.*` — all tool events",
		"- `stream.*` — all streaming delta events",
		"- `agent.*` — all agent events",
		"- `usage.*` — all usage/cost events",
		"- `hook.*` — all hook events (covers all 24 Claude Code hook types)",
		"- `mcp.*` — MCP server status and elicitation events",
		"- `file.*` — file change notifications",
		"- `cwd.*` — working directory change notifications",
		"- `prompt.*` — prompt suggestion events",
		"- `system.*` — internal server events",
		"",
		"Include an optional `sessionId` to filter events to a single Claude session.",
		"",
		"## Request / Response Commands",
		"",
		"| Client sends             | Server responds with                           |",
		"|--------------------------|------------------------------------------------|",
		"| `get_snapshot`           | `snapshot`                                     |",
		"| `get_session_list`       | `session_list`                                 |",
		"| `get_session_history`    | `session_history`                              |",
		"| `get_usage`              | `usage`                                        |",
		"| `subscribe`              | `subscribed`                                   |",
		"| `unsubscribe`            | `unsubscribed`                                 |",
		"| `subscribe_agent_log`    | `subscribed_agent_log`, then `agent_log` lines |",
		"| `unsubscribe_agent_log`  | `unsubscribed_agent_log`                       |",
		"| `replay`                 | Buffered events with seq > lastSeq             |",
		"",
		"## Replay / Reconnection",
		"",
		"Every server event carries a monotonically increasing `seq` number. After",
		"reconnecting, send a `replay` message with the last `seq` you received to",
		"catch up on missed events from the server's ring buffer.",
		"",
		"## Hook Integration",
		"",
		"Claude Code hooks can POST to `POST /hook` to emit events in real-time.",
		"Each hook type generates a `hook.<snake_case>` event. Tool-related hooks",
		"also produce `hook.started` / `hook.completed` summary events, and some",
		"hooks produce derived events in other namespaces (e.g. `mcp.*`, `file.*`,",
		"`cwd.*`, `agent.*`).",
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
		defaultContentType: "application/json",
		servers: {
			localhost: {
				host: "localhost:3838",
				protocol: "ws",
				description:
					"Default local server. Configure port via SERVER_PORT environment variable.",
			},
		},
		channels: asyncApiChannels,
		operations: asyncApiOperations,
		components: {
			messages: asyncApiMessages,
			schemas: componentSchemas,
			messageTraits: {
				eventEnvelope: envelopeTrait,
			},
		},
	};
}
