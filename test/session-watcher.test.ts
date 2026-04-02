import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentState } from "../src/agent-tracker.ts";
import type { ParsedEvent } from "../src/jsonl-parser.ts";
import { JsonlWatcher } from "../src/jsonl-watcher.ts";
import { SessionWatcher } from "../src/session-watcher.ts";

/** Safe array access that throws if index is out of bounds */
function at<T>(arr: T[], index: number): T {
	const val = arr[index];
	if (val === undefined) throw new Error(`No element at index ${index}`);
	return val;
}

let tempDir: string;
beforeAll(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "claw-test-"));
});
afterAll(async () => {
	await rm(tempDir, { recursive: true });
});

function wait(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

describe("SessionWatcher", () => {
	test("watchSession creates watcher for correct derived path", () => {
		const events: ParsedEvent[] = [];
		const agentChanges: AgentState[][] = [];

		const watcher = new SessionWatcher({
			onEvent: (e) => events.push(e),
			onAgentStateChange: (_sessionId, agents) => agentChanges.push(agents),
			trackerOptions: {
				stalenessThresholdMs: 60_000,
				stalenessCheckIntervalMs: 60_000,
			},
		});

		// watchSession should not throw
		watcher.watchSession("sess-1", "/home/user/project");

		// Verify agents were registered
		const agents = watcher.getAgents();
		expect(agents).toHaveLength(1);
		const agent = agents[0];
		expect(agent?.agentId).toBe("master-sess-1");
		expect(agent?.sessionId).toBe("sess-1");
		expect(agent?.agentType).toBe("master");

		watcher.stop();
	});

	test("watchSession is idempotent", () => {
		const watcher = new SessionWatcher({
			onEvent: () => {},
			onAgentStateChange: () => {},
			trackerOptions: {
				stalenessThresholdMs: 60_000,
				stalenessCheckIntervalMs: 60_000,
			},
		});

		watcher.watchSession("sess-dup", "/home/user");
		watcher.watchSession("sess-dup", "/home/user"); // should not throw or duplicate

		expect(watcher.getAgents()).toHaveLength(1);

		watcher.stop();
	});

	test("unwatchSession cleans up watcher and agent", () => {
		const watcher = new SessionWatcher({
			onEvent: () => {},
			onAgentStateChange: () => {},
			trackerOptions: {
				stalenessThresholdMs: 60_000,
				stalenessCheckIntervalMs: 60_000,
			},
		});

		watcher.watchSession("sess-cleanup", "/home/user");
		expect(watcher.getAgents()).toHaveLength(1);

		watcher.unwatchSession("sess-cleanup");
		expect(watcher.getAgents()).toHaveLength(0);

		// Double unwatch should not throw
		watcher.unwatchSession("sess-cleanup");

		watcher.stop();
	});

	test("stop cleans up all sessions", () => {
		const watcher = new SessionWatcher({
			onEvent: () => {},
			onAgentStateChange: () => {},
			trackerOptions: {
				stalenessThresholdMs: 60_000,
				stalenessCheckIntervalMs: 60_000,
			},
		});

		watcher.watchSession("s1", "/a");
		watcher.watchSession("s2", "/b");
		expect(watcher.getAgents()).toHaveLength(2);

		watcher.stop();
		expect(watcher.getAgents()).toHaveLength(0);
	});

	test("integration: JSONL lines are parsed and emitted as events", async () => {
		// Create the directory structure the watcher expects
		// We need to work with real files, so we'll create a SessionWatcher
		// that watches a file we control directly using a custom path approach.
		// Since deriveJsonlPath uses homedir, we'll test the pipeline differently:
		// Create a temp JSONL file and use JsonlWatcher + parser directly through
		// the same pipeline that SessionWatcher uses.

		const jsonlPath = join(tempDir, "integration-test.jsonl");
		await writeFile(jsonlPath, "");

		const events: ParsedEvent[] = [];
		const { JsonlParser } = await import("../src/jsonl-parser.ts");

		const parser = new JsonlParser("int-sess", (event: ParsedEvent) => {
			events.push(event);
		});

		const watcher = new JsonlWatcher(
			jsonlPath,
			(line) => parser.processLine(line),
			{ pollIntervalMs: 50 },
		);

		watcher.start();

		// Write a system init line
		await appendFile(
			jsonlPath,
			`${JSON.stringify({
				type: "system",
				subtype: "init",
				model: "claude-opus-4-20250514",
				cwd: "/project",
			})}\n`,
		);
		await wait(150);

		expect(events).toHaveLength(1);
		expect(at(events, 0).type).toBe("session.started");
		expect(at(events, 0).sessionId).toBe("int-sess");
		expect(at(events, 0).data["model"]).toBe("claude-opus-4-20250514");

		// Write a user message
		await appendFile(
			jsonlPath,
			`${JSON.stringify({
				type: "user",
				message: { content: [{ type: "text", text: "Hello" }] },
			})}\n`,
		);
		await wait(150);

		expect(events).toHaveLength(2);
		expect(at(events, 1).type).toBe("message.user");
		expect(at(events, 1).data["text"]).toBe("Hello");

		// Write assistant with tool use
		await appendFile(
			jsonlPath,
			`${JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{ type: "text", text: "Running..." },
						{
							type: "tool_use",
							id: "t1",
							name: "Bash",
							input: { command: "ls" },
						},
					],
				},
			})}\n`,
		);
		await wait(150);

		expect(events).toHaveLength(4); // message.assistant + tool.started
		expect(at(events, 2).type).toBe("message.assistant");
		expect(at(events, 3).type).toBe("tool.started");
		expect(at(events, 3).data["toolName"]).toBe("Bash");

		// Write tool result
		await appendFile(
			jsonlPath,
			`${JSON.stringify({
				type: "user",
				message: {
					content: [
						{ type: "tool_result", tool_use_id: "t1", content: "output" },
					],
				},
			})}\n`,
		);
		await wait(150);

		expect(events).toHaveLength(5);
		expect(at(events, 4).type).toBe("tool.completed");
		expect(at(events, 4).data["toolName"]).toBe("Bash");

		watcher.stop();
	});
});
