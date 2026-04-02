import { describe, expect, test } from "bun:test";
import { JsonlParser, type ParsedEvent } from "../src/jsonl-parser.ts";

/** Safe array access that throws if index is out of bounds */
function at<T>(arr: T[], index: number): T {
	const val = arr[index];
	if (val === undefined) throw new Error(`No element at index ${index}`);
	return val;
}

function createParser(sessionId = "test-session") {
	const events: ParsedEvent[] = [];
	const parser = new JsonlParser(sessionId, (e) => events.push(e));
	return { parser, events };
}

describe("JsonlParser", () => {
	test("user messages emit message.user", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "user",
			message: {
				uuid: "u1",
				content: [{ type: "text", text: "Hello world" }],
			},
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).type).toBe("message.user");
		expect(at(events, 0).sessionId).toBe("test-session");
		expect(at(events, 0).data["text"]).toBe("Hello world");
		expect(at(events, 0).data["uuid"]).toBe("u1");
		expect(at(events, 0).data["isSynthetic"]).toBe(false);
	});

	test("synthetic user messages have isSynthetic=true", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "user",
			isSynthetic: true,
			message: { content: "synthetic msg" },
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).data["isSynthetic"]).toBe(true);
	});

	test("assistant messages with tool_use emit message.assistant + tool.started", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "assistant",
			message: {
				uuid: "a1",
				model: "claude-opus-4-20250514",
				content: [
					{ type: "text", text: "Let me read that file." },
					{
						type: "tool_use",
						id: "tu1",
						name: "Read",
						input: { file_path: "/tmp/test.txt" },
					},
				],
			},
		});

		expect(events).toHaveLength(2);
		expect(at(events, 0).type).toBe("message.assistant");
		expect(at(events, 0).data["model"]).toBe("claude-opus-4-20250514");

		expect(at(events, 1).type).toBe("tool.started");
		expect(at(events, 1).data["toolName"]).toBe("Read");
		expect(at(events, 1).data["toolUseId"]).toBe("tu1");
	});

	test("user messages with tool_result emit tool.completed", () => {
		const { parser, events } = createParser();

		// First start a tool so it's tracked in-flight
		parser.processLine({
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: "tu2",
						name: "Bash",
						input: { command: "ls" },
					},
				],
			},
		});

		// Now send the result
		parser.processLine({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "tu2",
						content: "file1.txt\nfile2.txt",
					},
				],
			},
		});

		const completed = events.filter((e) => e.type === "tool.completed");
		expect(completed).toHaveLength(1);
		expect(at(completed, 0).data["toolName"]).toBe("Bash");
		expect(at(completed, 0).data["toolUseId"]).toBe("tu2");
		expect(typeof at(completed, 0).data["durationMs"]).toBe("number");
	});

	test("user messages with tool_result and is_error emit tool.failed", () => {
		const { parser, events } = createParser();

		// Start a tool
		parser.processLine({
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: "tu3",
						name: "Write",
						input: {},
					},
				],
			},
		});

		// Error result
		parser.processLine({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "tu3",
						is_error: true,
						content: "Permission denied",
					},
				],
			},
		});

		const failed = events.filter((e) => e.type === "tool.failed");
		expect(failed).toHaveLength(1);
		expect(at(failed, 0).data["toolName"]).toBe("Write");
		expect(at(failed, 0).data["error"]).toBe("Permission denied");
	});

	test("result messages emit message.result", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "result",
			subtype: "success",
			duration_ms: 5000,
			duration_api_ms: 3000,
			num_turns: 3,
			total_cost_usd: 0.05,
			usage: { input_tokens: 100, output_tokens: 200 },
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).type).toBe("message.result");
		expect(at(events, 0).data["subtype"]).toBe("success");
		expect(at(events, 0).data["durationMs"]).toBe(5000);
		expect(at(events, 0).data["durationApiMs"]).toBe(3000);
		expect(at(events, 0).data["numTurns"]).toBe(3);
		expect(at(events, 0).data["totalCostUsd"]).toBe(0.05);
	});

	test("system init emits session.started", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "system",
			subtype: "init",
			model: "claude-opus-4-20250514",
			version: "1.0.0",
			cwd: "/home/user/project",
			tools: ["Read", "Write", "Bash"],
			permission_mode: "auto",
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).type).toBe("session.started");
		expect(at(events, 0).data["model"]).toBe("claude-opus-4-20250514");
		expect(at(events, 0).data["version"]).toBe("1.0.0");
		expect(at(events, 0).data["cwd"]).toBe("/home/user/project");
		expect(at(events, 0).data["tools"]).toEqual(["Read", "Write", "Bash"]);
		expect(at(events, 0).data["permissionMode"]).toBe("auto");
	});

	test("session_state_changed emits session.state_changed", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "system",
			subtype: "session_state_changed",
			state: { mode: "code" },
		});

		expect(events).toHaveLength(1);
		expect(at(events, 0).type).toBe("session.state_changed");
		expect(at(events, 0).data["state"]).toEqual({ mode: "code" });
	});

	test("in-flight tool tracking computes duration", () => {
		const { parser, events } = createParser();

		// Start tool
		parser.processLine({
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: "tu-duration",
						name: "Bash",
						input: { command: "sleep 0" },
					},
				],
			},
		});

		// Complete tool
		parser.processLine({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "tu-duration",
						content: "done",
					},
				],
			},
		});

		const completed = events.filter((e) => e.type === "tool.completed");
		expect(completed).toHaveLength(1);
		const durationMs = at(completed, 0).data["durationMs"] as number;
		// Duration should be non-negative and small (test runs fast)
		expect(durationMs).toBeGreaterThanOrEqual(0);
		expect(durationMs).toBeLessThan(5000);
	});

	test("tool_result for unknown tool_use_id uses unknown name", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "unknown-id",
						content: "result",
					},
				],
			},
		});

		const completed = events.filter((e) => e.type === "tool.completed");
		expect(completed).toHaveLength(1);
		expect(at(completed, 0).data["toolName"]).toBe("unknown");
	});

	test("lines without type are ignored", () => {
		const { parser, events } = createParser();
		parser.processLine({ foo: "bar" });
		expect(events).toHaveLength(0);
	});
});
