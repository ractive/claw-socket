import { describe, expect, test } from "bun:test";
import { processHookEvent } from "../src/hook-handler.ts";
import { JsonlParser, type ParsedEvent } from "../src/jsonl-parser.ts";

/** Safe array access that throws if index is out of bounds */
function at<T>(arr: T[], index: number): T {
	const val = arr[index];
	if (val === undefined) throw new Error(`No element at index ${index}`);
	return val;
}

function createParser(sessionId = "stream-session") {
	const events: ParsedEvent[] = [];
	const parser = new JsonlParser(sessionId, (e) => events.push(e));
	return { parser, events };
}

const SESSION_ID = "sess-stream-001";

function makePayload(
	type: string,
	data: Record<string, unknown> = {},
	agentId?: string,
): Record<string, unknown> {
	return {
		sessionId: SESSION_ID,
		type,
		...(agentId !== undefined ? { agentId } : {}),
		data,
	};
}

// ── Stream delta parsing ───────────────────────────────────────────────────

describe("JsonlParser: content_block_delta", () => {
	test("text_delta emits stream.delta with index and text", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "Hello" },
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).type).toBe("stream.delta");
		expect(at(events, 0).data["index"]).toBe(0);
		expect(at(events, 0).data["text"]).toBe("Hello");
	});

	test("text_delta with non-zero index preserves index", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "content_block_delta",
			index: 2,
			delta: { type: "text_delta", text: "world" },
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).data["index"]).toBe(2);
	});

	test("thinking_delta emits stream.thinking_delta with index and thinking", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "content_block_delta",
			index: 0,
			delta: { type: "thinking_delta", thinking: "Let me think..." },
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).type).toBe("stream.thinking_delta");
		expect(at(events, 0).data["index"]).toBe(0);
		expect(at(events, 0).data["thinking"]).toBe("Let me think...");
	});

	test("input_json_delta emits stream.tool_use_delta with index and partialJson", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "content_block_delta",
			index: 1,
			delta: { type: "input_json_delta", partial_json: '{"file":' },
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).type).toBe("stream.tool_use_delta");
		expect(at(events, 0).data["index"]).toBe(1);
		expect(at(events, 0).data["partialJson"]).toBe('{"file":');
	});

	test("missing index defaults to 0", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "content_block_delta",
			delta: { type: "text_delta", text: "hi" },
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).data["index"]).toBe(0);
	});

	test("unknown delta type produces no events", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "content_block_delta",
			index: 0,
			delta: { type: "unknown_delta_type", value: "x" },
		});

		expect(events).toHaveLength(0);
	});

	test("missing delta produces no events", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "content_block_delta",
			index: 0,
		});

		expect(events).toHaveLength(0);
	});

	test("sessionId is set on stream.delta events", () => {
		const { parser, events } = createParser("my-session");

		parser.processLine({
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "x" },
		});

		expect(at(events, 0).sessionId).toBe("my-session");
	});

	test("multiple sequential deltas emit multiple events", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "Hello" },
		});
		parser.processLine({
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: " world" },
		});

		expect(events).toHaveLength(2);
		expect(at(events, 0).data["text"]).toBe("Hello");
		expect(at(events, 1).data["text"]).toBe(" world");
	});
});

// ── Prompt suggestion forwarding ──────────────────────────────────────────

describe("JsonlParser: prompt_suggestion", () => {
	test("emits prompt.suggestion with suggestions array", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "prompt_suggestion",
			suggestions: ["Run tests", "Fix the bug"],
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).type).toBe("prompt.suggestion");
		expect(at(events, 0).data["suggestions"]).toEqual([
			"Run tests",
			"Fix the bug",
		]);
	});

	test("empty suggestions array still emits event", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "prompt_suggestion",
			suggestions: [],
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).data["suggestions"]).toEqual([]);
	});

	test("missing suggestions array produces no event", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "prompt_suggestion",
		});

		expect(events).toHaveLength(0);
	});

	test("non-array suggestions produces no event", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "prompt_suggestion",
			suggestions: "Run tests",
		});

		expect(events).toHaveLength(0);
	});
});

// ── MCP server status extraction ──────────────────────────────────────────

describe("processHookEvent: SessionStart MCP server status", () => {
	test("emits mcp.server_status for each server in mcp_servers", () => {
		const result = processHookEvent(
			makePayload("SessionStart", {
				mcp_servers: [
					{
						name: "filesystem",
						status: "connected",
						url: "http://localhost:8080",
					},
					{ name: "github", status: "connected" },
				],
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const mcpEvents = result.events.filter(
			(e) => e.type === "mcp.server_status",
		);
		expect(mcpEvents).toHaveLength(2);

		expect(at(mcpEvents, 0).data["serverName"]).toBe("filesystem");
		expect(at(mcpEvents, 0).data["status"]).toBe("connected");
		expect(at(mcpEvents, 0).data["url"]).toBe("http://localhost:8080");

		expect(at(mcpEvents, 1).data["serverName"]).toBe("github");
		expect(at(mcpEvents, 1).data["status"]).toBe("connected");
		expect(at(mcpEvents, 1).data["url"]).toBeUndefined();
	});

	test("includes tools when present on server entry", () => {
		const result = processHookEvent(
			makePayload("SessionStart", {
				mcp_servers: [
					{
						name: "filesystem",
						status: "connected",
						tools: ["read_file", "write_file"],
					},
				],
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const mcpEvent = result.events.find((e) => e.type === "mcp.server_status");
		expect(mcpEvent?.data["tools"]).toEqual(["read_file", "write_file"]);
	});

	test("status defaults to 'unknown' when missing", () => {
		const result = processHookEvent(
			makePayload("SessionStart", {
				mcp_servers: [{ name: "myserver" }],
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const mcpEvent = result.events.find((e) => e.type === "mcp.server_status");
		expect(mcpEvent?.data["status"]).toBe("unknown");
	});

	test("skips server entries without a name", () => {
		const result = processHookEvent(
			makePayload("SessionStart", {
				mcp_servers: [{ status: "connected" }],
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const mcpEvents = result.events.filter(
			(e) => e.type === "mcp.server_status",
		);
		expect(mcpEvents).toHaveLength(0);
	});

	test("no mcp_servers → only hook.session_start event emitted", () => {
		const result = processHookEvent(
			makePayload("SessionStart", { model: "claude-sonnet" }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.events).toHaveLength(1);
		expect(at(result.events, 0).type).toBe("hook.session_start");
	});

	test("empty mcp_servers array → only hook.session_start event emitted", () => {
		const result = processHookEvent(
			makePayload("SessionStart", { mcp_servers: [] }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.events).toHaveLength(1);
	});
});

// ── Elicitation event parsing ─────────────────────────────────────────────

describe("processHookEvent: Elicitation", () => {
	test("emits hook.elicitation AND mcp.elicitation", () => {
		const result = processHookEvent(
			makePayload("Elicitation", {
				question: "Which approach should I use?",
				options: ["A", "B"],
				timeout: 30,
				source: "mcp-server",
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.events).toHaveLength(2);
		expect(at(result.events, 0).type).toBe("hook.elicitation");

		const elicitEvent = at(result.events, 1);
		expect(elicitEvent.type).toBe("mcp.elicitation");
		expect(elicitEvent.data["question"]).toBe("Which approach should I use?");
		expect(elicitEvent.data["options"]).toEqual(["A", "B"]);
		expect(elicitEvent.data["timeout"]).toBe(30);
		expect(elicitEvent.data["source"]).toBe("mcp-server");
	});

	test("options and source are omitted when not present", () => {
		const result = processHookEvent(
			makePayload("Elicitation", {
				question: "Continue?",
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const elicitEvent = result.events.find((e) => e.type === "mcp.elicitation");
		expect(elicitEvent?.data["question"]).toBe("Continue?");
		expect(elicitEvent?.data["options"]).toBeUndefined();
		expect(elicitEvent?.data["source"]).toBeUndefined();
	});

	test("question defaults to empty string when missing", () => {
		const result = processHookEvent(makePayload("Elicitation", {}));

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const elicitEvent = result.events.find((e) => e.type === "mcp.elicitation");
		expect(elicitEvent?.data["question"]).toBe("");
	});
});

describe("processHookEvent: ElicitationResult", () => {
	test("emits hook.elicitation_result AND mcp.elicitation_result", () => {
		const result = processHookEvent(
			makePayload("ElicitationResult", {
				answer: "Option A",
				source: "mcp-server",
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.events).toHaveLength(2);
		expect(at(result.events, 0).type).toBe("hook.elicitation_result");

		const resultEvent = at(result.events, 1);
		expect(resultEvent.type).toBe("mcp.elicitation_result");
		expect(resultEvent.data["answer"]).toBe("Option A");
		expect(resultEvent.data["source"]).toBe("mcp-server");
	});

	test("source is omitted when not present", () => {
		const result = processHookEvent(
			makePayload("ElicitationResult", { answer: "yes" }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const resultEvent = result.events.find(
			(e) => e.type === "mcp.elicitation_result",
		);
		expect(resultEvent?.data["answer"]).toBe("yes");
		expect(resultEvent?.data["source"]).toBeUndefined();
	});

	test("answer is omitted when not present", () => {
		const result = processHookEvent(makePayload("ElicitationResult", {}));

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const resultEvent = result.events.find(
			(e) => e.type === "mcp.elicitation_result",
		);
		expect(resultEvent?.data["answer"]).toBeUndefined();
	});
});

// ── File change event handling ────────────────────────────────────────────

describe("processHookEvent: FileChanged", () => {
	test("emits hook.file_changed AND file.changed with path", () => {
		const result = processHookEvent(
			makePayload("FileChanged", {
				path: "/some/file.ts",
				change_type: "modified",
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.events).toHaveLength(2);
		expect(at(result.events, 0).type).toBe("hook.file_changed");

		const fileEvent = at(result.events, 1);
		expect(fileEvent.type).toBe("file.changed");
		expect(fileEvent.data["path"]).toBe("/some/file.ts");
		expect(fileEvent.data["changeType"]).toBe("modified");
	});

	test("changeType is omitted when change_type not present", () => {
		const result = processHookEvent(
			makePayload("FileChanged", { path: "/some/file.ts" }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const fileEvent = result.events.find((e) => e.type === "file.changed");
		expect(fileEvent?.data["path"]).toBe("/some/file.ts");
		expect(fileEvent?.data["changeType"]).toBeUndefined();
	});

	test("path defaults to empty string when missing", () => {
		const result = processHookEvent(makePayload("FileChanged", {}));

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const fileEvent = result.events.find((e) => e.type === "file.changed");
		expect(fileEvent?.data["path"]).toBe("");
	});
});

// ── CwdChanged event handling ─────────────────────────────────────────────

describe("processHookEvent: CwdChanged", () => {
	test("emits hook.cwd_changed AND cwd.changed with newCwd", () => {
		const result = processHookEvent(
			makePayload("CwdChanged", {
				cwd: "/new/dir",
				old_cwd: "/old/dir",
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.events).toHaveLength(2);
		expect(at(result.events, 0).type).toBe("hook.cwd_changed");

		const cwdEvent = at(result.events, 1);
		expect(cwdEvent.type).toBe("cwd.changed");
		expect(cwdEvent.data["newCwd"]).toBe("/new/dir");
		expect(cwdEvent.data["oldCwd"]).toBe("/old/dir");
	});

	test("oldCwd is omitted when old_cwd not present", () => {
		const result = processHookEvent(
			makePayload("CwdChanged", { cwd: "/new/dir" }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const cwdEvent = result.events.find((e) => e.type === "cwd.changed");
		expect(cwdEvent?.data["newCwd"]).toBe("/new/dir");
		expect(cwdEvent?.data["oldCwd"]).toBeUndefined();
	});

	test("falls back to new_cwd field if cwd is missing", () => {
		const result = processHookEvent(
			makePayload("CwdChanged", { new_cwd: "/fallback/dir" }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const cwdEvent = result.events.find((e) => e.type === "cwd.changed");
		expect(cwdEvent?.data["newCwd"]).toBe("/fallback/dir");
	});

	test("newCwd defaults to empty string when no cwd fields present", () => {
		const result = processHookEvent(makePayload("CwdChanged", {}));

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const cwdEvent = result.events.find((e) => e.type === "cwd.changed");
		expect(cwdEvent?.data["newCwd"]).toBe("");
	});
});

// ── Hook lifecycle events ─────────────────────────────────────────────────

describe("processHookEvent: hook lifecycle", () => {
	test("PreToolUse emits hook.pre_tool_use AND hook.started", () => {
		const result = processHookEvent(
			makePayload("PreToolUse", {
				tool_name: "Read",
				tool_use_id: "tu-001",
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.events).toHaveLength(2);
		expect(at(result.events, 0).type).toBe("hook.pre_tool_use");

		const startedEvent = at(result.events, 1);
		expect(startedEvent.type).toBe("hook.started");
		expect(startedEvent.data["hookType"]).toBe("PreToolUse");
		expect(startedEvent.data["toolName"]).toBe("Read");
	});

	test("hook.started uses toolName default 'unknown' when tool_name missing", () => {
		const result = processHookEvent(makePayload("PreToolUse", {}));

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const startedEvent = result.events.find((e) => e.type === "hook.started");
		expect(startedEvent?.data["toolName"]).toBe("unknown");
	});

	test("PostToolUse emits hook.post_tool_use AND hook.completed with success:true", () => {
		const result = processHookEvent(
			makePayload("PostToolUse", {
				tool_name: "Bash",
				tool_response: "done",
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.events).toHaveLength(2);
		expect(at(result.events, 0).type).toBe("hook.post_tool_use");

		const completedEvent = at(result.events, 1);
		expect(completedEvent.type).toBe("hook.completed");
		expect(completedEvent.data["hookType"]).toBe("PostToolUse");
		expect(completedEvent.data["toolName"]).toBe("Bash");
		expect(completedEvent.data["success"]).toBe(true);
	});

	test("PostToolUseFailure emits hook.post_tool_use_failure AND hook.completed with success:false", () => {
		const result = processHookEvent(
			makePayload("PostToolUseFailure", {
				tool_name: "Write",
				error: "Permission denied",
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.events).toHaveLength(2);
		expect(at(result.events, 0).type).toBe("hook.post_tool_use_failure");

		const completedEvent = at(result.events, 1);
		expect(completedEvent.type).toBe("hook.completed");
		expect(completedEvent.data["hookType"]).toBe("PostToolUseFailure");
		expect(completedEvent.data["toolName"]).toBe("Write");
		expect(completedEvent.data["success"]).toBe(false);
	});

	test("hook.completed events carry sessionId", () => {
		const result = processHookEvent(
			makePayload("PostToolUse", { tool_name: "Read" }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const completedEvent = result.events.find(
			(e) => e.type === "hook.completed",
		);
		expect(completedEvent?.sessionId).toBe(SESSION_ID);
	});

	test("hook.started events carry sessionId", () => {
		const result = processHookEvent(
			makePayload("PreToolUse", { tool_name: "Read" }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const startedEvent = result.events.find((e) => e.type === "hook.started");
		expect(startedEvent?.sessionId).toBe(SESSION_ID);
	});
});

// ── End-to-end: mixed JSONL feed ──────────────────────────────────────────

describe("end-to-end: mixed JSONL feed", () => {
	test("processing multiple line types emits correct sequence of events", () => {
		const { parser, events } = createParser("e2e-session");

		// Session init
		parser.processLine({
			type: "system",
			subtype: "init",
			model: "claude-sonnet-4",
			cwd: "/workspace",
		});

		// Streaming text delta
		parser.processLine({
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "I'll help you with that." },
		});

		// Streaming thinking delta
		parser.processLine({
			type: "content_block_delta",
			index: 0,
			delta: { type: "thinking_delta", thinking: "User wants help." },
		});

		// Prompt suggestion
		parser.processLine({
			type: "prompt_suggestion",
			suggestions: ["Show me examples"],
		});

		const types = events.map((e) => e.type);
		expect(types).toContain("session.started");
		expect(types).toContain("stream.delta");
		expect(types).toContain("stream.thinking_delta");
		expect(types).toContain("prompt.suggestion");
	});

	test("tool use flow interleaved with stream deltas", () => {
		const { parser, events } = createParser();

		// Assistant starts a tool
		parser.processLine({
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: "tu-e2e",
						name: "Read",
						input: { file_path: "/test.txt" },
					},
				],
			},
		});

		// Streaming tool input delta
		parser.processLine({
			type: "content_block_delta",
			index: 1,
			delta: { type: "input_json_delta", partial_json: '{"file_path":' },
		});

		// Tool result
		parser.processLine({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "tu-e2e",
						content: "file contents here",
					},
				],
			},
		});

		const toolStarted = events.filter((e) => e.type === "tool.started");
		const streamDelta = events.filter(
			(e) => e.type === "stream.tool_use_delta",
		);
		const toolCompleted = events.filter((e) => e.type === "tool.completed");

		expect(toolStarted).toHaveLength(1);
		expect(streamDelta).toHaveLength(1);
		expect(toolCompleted).toHaveLength(1);
		expect(at(streamDelta, 0).data["partialJson"]).toBe('{"file_path":');
	});
});
