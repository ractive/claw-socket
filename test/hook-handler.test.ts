import { describe, expect, test } from "bun:test";
import { processHookEvent } from "../src/hook-handler.ts";

/** Safe array access that throws if index is out of bounds */
function at<T>(arr: T[], index: number): T {
	const val = arr[index];
	if (val === undefined) throw new Error(`No element at index ${index}`);
	return val;
}

const SESSION_ID = "sess-abc123";

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

describe("processHookEvent", () => {
	// ── Valid hook events ─────────────────────────────────────────────

	describe("PreToolUse", () => {
		test("returns ok:true and emits hook.pre_tool_use", () => {
			const result = processHookEvent(
				makePayload("PreToolUse", {
					tool_name: "Read",
					tool_use_id: "tu-001",
					tool_input: { file_path: "/tmp/test.txt" },
				}),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			const evt = at(result.events, 0);
			expect(evt.type).toBe("hook.pre_tool_use");
			expect(evt.sessionId).toBe(SESSION_ID);
			expect(evt.data["toolName"]).toBe("Read");
			expect(evt.data["toolUseId"]).toBe("tu-001");
			expect(typeof evt.data["inputSummary"]).toBe("string");
		});

		test("inputSummary is JSON-stringified tool_input", () => {
			const input = { file_path: "/some/path" };
			const result = processHookEvent(
				makePayload("PreToolUse", {
					tool_name: "Read",
					tool_input: input,
				}),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const evt = at(result.events, 0);
			expect(evt.data["inputSummary"]).toBe(JSON.stringify(input));
		});

		test("inputSummary is empty string when tool_input is absent", () => {
			const result = processHookEvent(
				makePayload("PreToolUse", { tool_name: "Read" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(at(result.events, 0).data["inputSummary"]).toBe("");
		});

		test("toolName defaults to 'unknown' when tool_name missing", () => {
			const result = processHookEvent(makePayload("PreToolUse", {}));

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(at(result.events, 0).data["toolName"]).toBe("unknown");
		});

		test("toolUseId is undefined when tool_use_id missing", () => {
			const result = processHookEvent(
				makePayload("PreToolUse", { tool_name: "Read" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(at(result.events, 0).data["toolUseId"]).toBeUndefined();
		});
	});

	describe("PostToolUse", () => {
		test("returns ok:true and emits hook.post_tool_use with enriched fields", () => {
			const result = processHookEvent(
				makePayload("PostToolUse", {
					tool_name: "Bash",
					tool_use_id: "tu-002",
					tool_response: "file1.txt\nfile2.txt",
				}),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			const evt = at(result.events, 0);
			expect(evt.type).toBe("hook.post_tool_use");
			expect(evt.data["toolName"]).toBe("Bash");
			expect(evt.data["toolUseId"]).toBe("tu-002");
			expect(evt.data["outputSummary"]).toBe("file1.txt\nfile2.txt");
		});

		test("outputSummary from non-string tool_response is JSON-stringified", () => {
			const response = { exitCode: 0, stdout: "ok" };
			const result = processHookEvent(
				makePayload("PostToolUse", {
					tool_name: "Bash",
					tool_response: response,
				}),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(at(result.events, 0).data["outputSummary"]).toBe(
				JSON.stringify(response),
			);
		});

		test("outputSummary is empty string when tool_response absent", () => {
			const result = processHookEvent(
				makePayload("PostToolUse", { tool_name: "Bash" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(at(result.events, 0).data["outputSummary"]).toBe("");
		});
	});

	describe("PostToolUseFailure", () => {
		test("emits hook.post_tool_use_failure with toolName, error, isInterrupt", () => {
			const result = processHookEvent(
				makePayload("PostToolUseFailure", {
					tool_name: "Write",
					error: "Permission denied",
					is_interrupt: true,
				}),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			const evt = at(result.events, 0);
			expect(evt.type).toBe("hook.post_tool_use_failure");
			expect(evt.data["toolName"]).toBe("Write");
			expect(evt.data["error"]).toBe("Permission denied");
			expect(evt.data["isInterrupt"]).toBe(true);
		});

		test("isInterrupt defaults to false", () => {
			const result = processHookEvent(
				makePayload("PostToolUseFailure", {
					tool_name: "Write",
					error: "oops",
				}),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(at(result.events, 0).data["isInterrupt"]).toBe(false);
		});

		test("error defaults to 'unknown error' when missing", () => {
			const result = processHookEvent(
				makePayload("PostToolUseFailure", { tool_name: "Write" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(at(result.events, 0).data["error"]).toBe("unknown error");
		});
	});

	describe("SubagentStart", () => {
		test("emits hook.subagent_start AND agent.started when agent_id present in data", () => {
			const result = processHookEvent(
				makePayload("SubagentStart", {
					agent_id: "sub-agent-42",
					agent_type: "worker",
					cwd: "/workspace",
				}),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			expect(at(result.events, 0).type).toBe("hook.subagent_start");

			const started = at(result.events, 1);
			expect(started.type).toBe("agent.started");
			expect(started.agentId).toBe("sub-agent-42");
			expect(started.sessionId).toBe(SESSION_ID);
			expect(started.data["agentId"]).toBe("sub-agent-42");
			expect(started.data["agentType"]).toBe("worker");
			expect(started.data["cwd"]).toBe("/workspace");
			expect(started.data["source"]).toBe("hook");
		});

		test("emits hook.subagent_start AND agent.started using payload.agentId as fallback", () => {
			const result = processHookEvent(
				makePayload("SubagentStart", {}, "payload-agent-id"),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			const started = at(result.events, 1);
			expect(started.type).toBe("agent.started");
			expect(started.agentId).toBe("payload-agent-id");
		});

		test("emits only hook.subagent_start when no agent_id available", () => {
			const result = processHookEvent(makePayload("SubagentStart", {}));

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(1);
			expect(at(result.events, 0).type).toBe("hook.subagent_start");
		});

		test("agentType defaults to 'subagent' when agent_type missing", () => {
			const result = processHookEvent(
				makePayload("SubagentStart", { agent_id: "sub-99" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const started = result.events.find((e) => e.type === "agent.started");
			expect(started?.data["agentType"]).toBe("subagent");
		});

		test("cwd omitted from agent.started when not present", () => {
			const result = processHookEvent(
				makePayload("SubagentStart", { agent_id: "sub-99" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const started = result.events.find((e) => e.type === "agent.started");
			expect(started?.data["cwd"]).toBeUndefined();
		});
	});

	describe("SubagentStop", () => {
		test("emits hook.subagent_stop AND agent.stopped when agent_id in data", () => {
			const result = processHookEvent(
				makePayload("SubagentStop", { agent_id: "sub-agent-42" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			expect(at(result.events, 0).type).toBe("hook.subagent_stop");

			const stopped = at(result.events, 1);
			expect(stopped.type).toBe("agent.stopped");
			expect(stopped.agentId).toBe("sub-agent-42");
			expect(stopped.sessionId).toBe(SESSION_ID);
			expect(stopped.data["agentId"]).toBe("sub-agent-42");
			expect(stopped.data["source"]).toBe("hook");
		});

		test("emits agent.stopped using payload.agentId as fallback", () => {
			const result = processHookEvent(
				makePayload("SubagentStop", {}, "payload-agent-id"),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			const stopped = at(result.events, 1);
			expect(stopped.type).toBe("agent.stopped");
			expect(stopped.agentId).toBe("payload-agent-id");
		});

		test("emits only hook.subagent_stop when no agent_id available", () => {
			const result = processHookEvent(makePayload("SubagentStop", {}));

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(1);
			expect(at(result.events, 0).type).toBe("hook.subagent_stop");
		});
	});

	describe("SessionStart", () => {
		test("emits hook.session_start only", () => {
			const result = processHookEvent(
				makePayload("SessionStart", { model: "claude-sonnet" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(1);
			expect(at(result.events, 0).type).toBe("hook.session_start");
			expect(at(result.events, 0).sessionId).toBe(SESSION_ID);
		});
	});

	describe("SessionEnd", () => {
		test("emits hook.session_end AND agent.stopped for master agent", () => {
			const result = processHookEvent(
				makePayload("SessionEnd", { reason: "user_exit" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			expect(at(result.events, 0).type).toBe("hook.session_end");

			const stopped = at(result.events, 1);
			expect(stopped.type).toBe("agent.stopped");
			expect(stopped.sessionId).toBe(SESSION_ID);
			expect(stopped.agentId).toBe(`master-${SESSION_ID}`);
			expect(stopped.data["agentId"]).toBe(`master-${SESSION_ID}`);
			expect(stopped.data["reason"]).toBe("user_exit");
			expect(stopped.data["source"]).toBe("hook");
		});

		test("reason defaults to 'session_end' when not in data", () => {
			const result = processHookEvent(makePayload("SessionEnd", {}));

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const stopped = result.events.find((e) => e.type === "agent.stopped");
			expect(stopped?.data["reason"]).toBe("session_end");
		});
	});

	describe("PermissionRequest", () => {
		test("emits hook.permission_request only", () => {
			const result = processHookEvent(
				makePayload("PermissionRequest", { tool_name: "Bash", command: "rm" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(1);
			expect(at(result.events, 0).type).toBe("hook.permission_request");
			expect(at(result.events, 0).sessionId).toBe(SESSION_ID);
		});
	});

	describe("TaskCreated", () => {
		test("emits hook.task_created only", () => {
			const result = processHookEvent(
				makePayload("TaskCreated", { task_id: "t-1", description: "do stuff" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(1);
			expect(at(result.events, 0).type).toBe("hook.task_created");
		});
	});

	describe("FileChanged", () => {
		test("emits hook.file_changed and file.changed", () => {
			const result = processHookEvent(
				makePayload("FileChanged", { path: "/some/file.ts" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			expect(at(result.events, 0).type).toBe("hook.file_changed");
			expect(at(result.events, 1).type).toBe("file.changed");
		});
	});

	describe("CwdChanged", () => {
		test("emits hook.cwd_changed and cwd.changed", () => {
			const result = processHookEvent(
				makePayload("CwdChanged", { cwd: "/new/dir" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(2);
			expect(at(result.events, 0).type).toBe("hook.cwd_changed");
			expect(at(result.events, 1).type).toBe("cwd.changed");
		});
	});

	// ── Passthrough: known enum types without special handling ────────

	describe("passthrough hook types", () => {
		test("Notification emits hook.notification", () => {
			const result = processHookEvent(
				makePayload("Notification", { message: "hello" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(1);
			expect(at(result.events, 0).type).toBe("hook.notification");
		});

		test("Stop emits hook.stop", () => {
			const result = processHookEvent(makePayload("Stop", {}));

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.events).toHaveLength(1);
			expect(at(result.events, 0).type).toBe("hook.stop");
		});

		test("UserPromptSubmit emits hook.user_prompt_submit", () => {
			const result = processHookEvent(
				makePayload("UserPromptSubmit", { prompt: "do the thing" }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(at(result.events, 0).type).toBe("hook.user_prompt_submit");
		});
	});

	// ── Agent ID derivation ───────────────────────────────────────────

	describe("agentId propagation", () => {
		test("events include agentId when payload has agentId", () => {
			const result = processHookEvent(
				makePayload("SessionStart", {}, "agent-xyz"),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const evt = at(result.events, 0);
			expect(evt.agentId).toBe("agent-xyz");
		});

		test("events omit agentId when payload has none", () => {
			const result = processHookEvent(makePayload("SessionStart", {}));

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const evt = at(result.events, 0);
			expect(evt.agentId).toBeUndefined();
			// agentId key should not be present at all
			expect(Object.hasOwn(evt, "agentId")).toBe(false);
		});
	});

	// ── Invalid payloads ──────────────────────────────────────────────

	describe("invalid payloads", () => {
		test("missing sessionId returns ok:false", () => {
			const result = processHookEvent({ type: "SessionStart", data: {} });
			expect(result.ok).toBe(false);
		});

		test("missing type returns ok:false", () => {
			const result = processHookEvent({
				sessionId: SESSION_ID,
				data: {},
			});
			expect(result.ok).toBe(false);
		});

		test("unknown type string returns ok:false", () => {
			const result = processHookEvent({
				sessionId: SESSION_ID,
				type: "SomethingMadeUp",
				data: {},
			});
			expect(result.ok).toBe(false);
		});

		test("null input returns ok:false", () => {
			const result = processHookEvent(null);
			expect(result.ok).toBe(false);
		});

		test("string input returns ok:false", () => {
			const result = processHookEvent("not an object");
			expect(result.ok).toBe(false);
		});

		test("array input returns ok:false", () => {
			const result = processHookEvent([]);
			expect(result.ok).toBe(false);
		});

		test("number input returns ok:false", () => {
			const result = processHookEvent(42);
			expect(result.ok).toBe(false);
		});
	});

	// ── Snake case conversion ─────────────────────────────────────────

	describe("snake_case conversion", () => {
		const cases: Array<[string, string]> = [
			["PreToolUse", "hook.pre_tool_use"],
			["PostToolUse", "hook.post_tool_use"],
			["PostToolUseFailure", "hook.post_tool_use_failure"],
			["SubagentStart", "hook.subagent_start"],
			["SubagentStop", "hook.subagent_stop"],
			["SessionStart", "hook.session_start"],
			["SessionEnd", "hook.session_end"],
			["PermissionRequest", "hook.permission_request"],
			["TaskCreated", "hook.task_created"],
			["FileChanged", "hook.file_changed"],
			["CwdChanged", "hook.cwd_changed"],
			["Notification", "hook.notification"],
		];

		for (const [input, expected] of cases) {
			test(`${input} → ${expected}`, () => {
				const result = processHookEvent(makePayload(input));

				expect(result.ok).toBe(true);
				if (!result.ok) return;

				expect(at(result.events, 0).type).toBe(expected);
			});
		}
	});

	// ── Data passthrough ──────────────────────────────────────────────

	describe("raw data fields passthrough", () => {
		test("arbitrary data fields are included on the event", () => {
			const result = processHookEvent(
				makePayload("Notification", {
					message: "something happened",
					severity: "info",
					count: 3,
				}),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const evt = at(result.events, 0);
			expect(evt.data["message"]).toBe("something happened");
			expect(evt.data["severity"]).toBe("info");
			expect(evt.data["count"]).toBe(3);
		});
	});
});
