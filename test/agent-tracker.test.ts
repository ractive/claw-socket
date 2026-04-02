import { describe, expect, test } from "bun:test";
import { AgentTracker } from "../src/agent-tracker.ts";
import type { ParsedEvent } from "../src/jsonl-parser.ts";

function makeEvent(
	type: string,
	data: Record<string, unknown> = {},
	sessionId = "sess1",
	agentId?: string,
): ParsedEvent {
	return { type, sessionId, data, ...(agentId ? { agentId } : {}) };
}

describe("AgentTracker", () => {
	test("registerAgent and removeAgent", () => {
		const tracker = new AgentTracker();

		tracker.registerAgent("a1", "sess1", "master", "/home");
		expect(tracker.getAgents()).toHaveLength(1);

		const agent = tracker.getAgent("a1");
		expect(agent).toBeDefined();
		expect(agent?.agentId).toBe("a1");
		expect(agent?.sessionId).toBe("sess1");
		expect(agent?.agentType).toBe("master");
		expect(agent?.cwd).toBe("/home");
		expect(agent?.status).toBe("working");
		expect(agent?.toolCount).toBe(0);
		expect(agent?.toolHistory).toEqual([]);

		tracker.removeAgent("a1");
		expect(tracker.getAgents()).toHaveLength(0);
		expect(tracker.getAgent("a1")).toBeUndefined();
	});

	test("removeAgent for nonexistent agent is a no-op", () => {
		const tracker = new AgentTracker();
		tracker.removeAgent("nonexistent"); // should not throw
		expect(tracker.getAgents()).toHaveLength(0);
	});

	test("handleEvent tool.started sets status to tool_running", () => {
		const tracker = new AgentTracker();
		tracker.registerAgent("a1", "sess1", "master", "/home");

		tracker.handleEvent(
			makeEvent(
				"tool.started",
				{
					toolName: "Read",
					inputSummary: '{"file":"test.ts"}',
				},
				"sess1",
				"a1",
			),
		);

		const agent = tracker.getAgent("a1");
		expect(agent?.status).toBe("tool_running");
		expect(agent?.currentTool).toBe("Read");
		expect(agent?.currentToolInput).toBe('{"file":"test.ts"}');
	});

	test("handleEvent tool.completed sets status to working and clears currentTool", () => {
		const tracker = new AgentTracker();
		tracker.registerAgent("a1", "sess1", "master", "/home");

		tracker.handleEvent(
			makeEvent("tool.started", { toolName: "Read" }, "sess1", "a1"),
		);
		tracker.handleEvent(
			makeEvent(
				"tool.completed",
				{ toolName: "Read", durationMs: 100 },
				"sess1",
				"a1",
			),
		);

		const agent = tracker.getAgent("a1");
		expect(agent?.status).toBe("working");
		expect(agent?.currentTool).toBeUndefined();
		expect(agent?.currentToolInput).toBeUndefined();
		expect(agent?.toolCount).toBe(1);
	});

	test("handleEvent tool.failed sets status to working", () => {
		const tracker = new AgentTracker();
		tracker.registerAgent("a1", "sess1", "master", "/home");

		tracker.handleEvent(
			makeEvent("tool.started", { toolName: "Write" }, "sess1", "a1"),
		);
		tracker.handleEvent(
			makeEvent(
				"tool.failed",
				{ toolName: "Write", error: "denied" },
				"sess1",
				"a1",
			),
		);

		const agent = tracker.getAgent("a1");
		expect(agent?.status).toBe("working");
		expect(agent?.toolCount).toBe(1);
	});

	test("toolHistory ring buffer caps at 10 entries", () => {
		const tracker = new AgentTracker();
		tracker.registerAgent("a1", "sess1", "master", "/home");

		for (let i = 0; i < 15; i++) {
			tracker.handleEvent(
				makeEvent(
					"tool.completed",
					{ toolName: `tool-${i}`, durationMs: i },
					"sess1",
					"a1",
				),
			);
		}

		const agent = tracker.getAgent("a1");
		expect(agent?.toolHistory).toHaveLength(10);
		// Oldest should be tool-5 (first 5 were shifted out)
		const history = agent?.toolHistory ?? [];
		expect(history[0]?.toolName).toBe("tool-5");
		expect(history[9]?.toolName).toBe("tool-14");
	});

	test("handleEvent for unregistered agent is a no-op", () => {
		const tracker = new AgentTracker();
		// Should not throw
		tracker.handleEvent(
			makeEvent("tool.started", { toolName: "Bash" }, "sess1", "unknown"),
		);
		expect(tracker.getAgents()).toHaveLength(0);
	});

	test("staleness detection marks agent idle and recovery marks active", async () => {
		const stalenessChanges: Array<{ agentId: string; isStale: boolean }> = [];
		const tracker = new AgentTracker({
			stalenessThresholdMs: 50,
			stalenessCheckIntervalMs: 25,
		});
		tracker.onStalenessChange = (agentId, isStale) => {
			stalenessChanges.push({ agentId, isStale });
		};

		tracker.registerAgent("a1", "sess1", "master", "/home");
		tracker.startStalenessCheck();

		// Wait for staleness to kick in
		await new Promise((r) => setTimeout(r, 150));

		const staleEvent = stalenessChanges.find(
			(c) => c.agentId === "a1" && c.isStale,
		);
		expect(staleEvent).toBeDefined();

		const agent = tracker.getAgent("a1");
		expect(agent?.status).toBe("idle");

		// Send activity to recover
		tracker.handleEvent(
			makeEvent(
				"message.assistant",
				{
					contentBlocks: [{ type: "text", text: "hello" }],
				},
				"sess1",
				"a1",
			),
		);

		const recovered = tracker.getAgent("a1");
		expect(recovered?.status).toBe("working");

		const recoveryEvent = stalenessChanges.find(
			(c) => c.agentId === "a1" && !c.isStale,
		);
		expect(recoveryEvent).toBeDefined();

		tracker.stopStalenessCheck();
	});

	test("agent.started event registers new agent", () => {
		const tracker = new AgentTracker();

		tracker.handleEvent(
			makeEvent(
				"agent.started",
				{ agentType: "sub-agent", cwd: "/project" },
				"sess1",
				"sub1",
			),
		);

		const agent = tracker.getAgent("sub1");
		expect(agent).toBeDefined();
		expect(agent?.agentType).toBe("sub-agent");
		expect(agent?.cwd).toBe("/project");
	});

	test("agent.stopped event marks agent offline", () => {
		const tracker = new AgentTracker();
		tracker.registerAgent("a1", "sess1", "master", "/home");

		tracker.handleEvent(makeEvent("agent.stopped", {}, "sess1", "a1"));

		const agent = tracker.getAgent("a1");
		expect(agent?.status).toBe("offline");
	});

	test("message.assistant updates token count", () => {
		const tracker = new AgentTracker();
		tracker.registerAgent("a1", "sess1", "master", "/home");

		tracker.handleEvent(
			makeEvent(
				"message.assistant",
				{
					contentBlocks: [
						{ type: "text", text: "A".repeat(400) }, // ~100 tokens
					],
				},
				"sess1",
				"a1",
			),
		);

		const agent = tracker.getAgent("a1");
		expect(agent?.tokenCount).toBe(100);
	});

	test("message.result with usage updates token count", () => {
		const tracker = new AgentTracker();
		tracker.registerAgent("a1", "sess1", "master", "/home");

		tracker.handleEvent(
			makeEvent(
				"message.result",
				{
					usage: { input_tokens: 500, output_tokens: 200 },
				},
				"sess1",
				"a1",
			),
		);

		const agent = tracker.getAgent("a1");
		// output_tokens sets it to 200, then input_tokens adds 500
		expect(agent?.tokenCount).toBe(700);
	});

	test("events without agentId fall back to sessionId", () => {
		const tracker = new AgentTracker();
		// Register with sessionId as the agentId
		tracker.registerAgent("sess1", "sess1", "master", "/home");

		tracker.handleEvent(
			makeEvent("tool.started", { toolName: "Bash" }, "sess1"),
		);

		const agent = tracker.getAgent("sess1");
		expect(agent?.status).toBe("tool_running");
	});
});
