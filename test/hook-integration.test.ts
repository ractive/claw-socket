import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";

let app: ReturnType<typeof createServer>;
let port = 0;

beforeAll(async () => {
	app = createServer({ port: 0 });
	await app.start();
	// biome-ignore lint: port is always assigned after Bun.serve
	port = app.server.port!;
});

afterAll(() => {
	app.stop();
});

/** POST JSON to the /hook endpoint */
function postHook(payload: unknown) {
	return fetch(`http://localhost:${port}/hook`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
}

/** Create a WebSocket with a buffered message queue so no messages are missed */
function connectWs(): Promise<{ ws: WebSocket; messages: unknown[] }> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://localhost:${port}`);
		const messages: unknown[] = [];
		ws.addEventListener("message", (e) => {
			messages.push(JSON.parse(e.data as string));
		});
		ws.onopen = () => resolve({ ws, messages });
		ws.onerror = (e) => reject(e);
	});
}

/** Wait until the message buffer has at least `count` entries */
function waitForMessages(
	messages: unknown[],
	count: number,
	timeoutMs = 2000,
): Promise<void> {
	if (messages.length >= count) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const check = setInterval(() => {
			if (messages.length >= count) {
				clearInterval(check);
				resolve();
			} else if (Date.now() - start > timeoutMs) {
				clearInterval(check);
				reject(
					new Error(
						`Timed out waiting for ${count} messages, got ${messages.length}`,
					),
				);
			}
		}, 10);
	});
}

// ── Valid base payloads ──────────────────────────────────────────────────────

const SESSION_ID = "test-session-hook-integration";
const AGENT_ID = "agent-abc-123";

const preToolUsePayload = {
	sessionId: SESSION_ID,
	type: "PreToolUse",
	agentId: AGENT_ID,
	data: {
		tool_name: "Bash",
		tool_use_id: "tu-001",
		tool_input: { command: "ls -la" },
	},
};

// ── HTTP endpoint tests ──────────────────────────────────────────────────────

describe("POST /hook — HTTP responses", () => {
	test("valid PreToolUse returns 200 with status ok", async () => {
		const res = await postHook(preToolUsePayload);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ status: "ok" });
		expect(typeof body["eventsEmitted"]).toBe("number");
		expect(body["eventsEmitted"] as number).toBeGreaterThan(0);
	});

	test("invalid JSON body returns 400", async () => {
		const res = await fetch(`http://localhost:${port}/hook`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{ not valid json !!!",
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toMatchObject({ error: "invalid JSON" });
	});

	test("payload missing sessionId returns 400", async () => {
		const res = await postHook({
			type: "PreToolUse",
			data: { tool_name: "Bash" },
			// sessionId intentionally omitted
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toMatchObject({ error: "invalid hook payload" });
	});

	test("unknown event type returns 400", async () => {
		const res = await postHook({
			sessionId: SESSION_ID,
			type: "UnknownEventType",
			data: {},
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toMatchObject({ error: "invalid hook payload" });
	});
});

// ── WebSocket broadcast tests ────────────────────────────────────────────────

describe("POST /hook — WS broadcast", () => {
	test("client subscribed to hook.* receives hook.pre_tool_use event", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // initial snapshot

		ws.send(JSON.stringify({ type: "subscribe", topics: ["hook.*"] }));
		await waitForMessages(messages, 2); // subscribed confirmation

		const beforeCount = messages.length;
		const res = await postHook(preToolUsePayload);
		expect(res.status).toBe(200);

		await waitForMessages(messages, beforeCount + 1);

		const hookMsg = messages.find(
			(m) => (m as Record<string, unknown>)["type"] === "hook.pre_tool_use",
		);
		expect(hookMsg).toBeDefined();
		expect(hookMsg).toMatchObject({
			type: "hook.pre_tool_use",
			sessionId: SESSION_ID,
		});

		ws.close();
	});

	test("client subscribed to agent.* receives agent.started from SubagentStart", async () => {
		const subagentId = "subagent-xyz-789";
		const subagentPayload = {
			sessionId: SESSION_ID,
			type: "SubagentStart",
			agentId: AGENT_ID,
			data: {
				agent_id: subagentId,
				agent_type: "subagent",
				cwd: "/tmp/work",
			},
		};

		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({ type: "subscribe", topics: ["hook.*", "agent.*"] }),
		);
		await waitForMessages(messages, 2); // subscribed

		const beforeCount = messages.length;
		const res = await postHook(subagentPayload);
		expect(res.status).toBe(200);

		// Expect both hook.subagent_start and agent.started
		await waitForMessages(messages, beforeCount + 2);

		const types = messages
			.slice(beforeCount)
			.map((m) => (m as Record<string, unknown>)["type"]);
		expect(types).toContain("hook.subagent_start");
		expect(types).toContain("agent.started");

		ws.close();
	});

	test("session filter: client only receives events for its session", async () => {
		const OTHER_SESSION = "other-session-999";

		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		// Subscribe with a session filter for SESSION_ID only
		ws.send(
			JSON.stringify({
				type: "subscribe",
				topics: ["hook.*"],
				sessionId: SESSION_ID,
			}),
		);
		await waitForMessages(messages, 2); // subscribed

		const beforeCount = messages.length;

		// Post to the OTHER session — should NOT arrive
		await postHook({ ...preToolUsePayload, sessionId: OTHER_SESSION });

		// Give a short window for any spurious delivery
		await new Promise((r) => setTimeout(r, 80));
		expect(messages.slice(beforeCount)).toHaveLength(0);

		// Post to SESSION_ID — SHOULD arrive
		await postHook(preToolUsePayload);
		await waitForMessages(messages, beforeCount + 1);
		expect(messages[beforeCount]).toMatchObject({
			type: "hook.pre_tool_use",
			sessionId: SESSION_ID,
		});

		ws.close();
	});
});

// ── Snapshot / state tests ───────────────────────────────────────────────────

describe("POST /hook — snapshot state", () => {
	test("SubagentStart makes agent appear in get_snapshot", async () => {
		const snapshotAgentId = "snapshot-agent-001";
		const sessionId = "snapshot-session-001";

		await postHook({
			sessionId,
			type: "SubagentStart",
			data: {
				agent_id: snapshotAgentId,
				agent_type: "subagent",
			},
		});

		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // auto-snapshot on connect

		ws.send(JSON.stringify({ type: "get_snapshot" }));
		await waitForMessages(messages, 2);

		const snapshot = messages[1] as {
			type: string;
			agents: Array<{ agentId: string }>;
		};
		expect(snapshot.type).toBe("snapshot");
		const found = snapshot.agents.find((a) => a.agentId === snapshotAgentId);
		expect(found).toBeDefined();

		ws.close();
	});

	test("SessionEnd marks master agent offline in snapshot", async () => {
		const sessionId = "session-end-test-001";
		const masterAgentId = `master-${sessionId}`;

		// Start the master agent via SubagentStart so it exists in the tracker
		await postHook({
			sessionId,
			type: "SubagentStart",
			data: {
				agent_id: masterAgentId,
				agent_type: "master",
			},
		});

		// End the session
		await postHook({
			sessionId,
			type: "SessionEnd",
			data: { reason: "completed" },
		});

		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		ws.send(JSON.stringify({ type: "get_snapshot" }));
		await waitForMessages(messages, 2);

		const snapshot = messages[1] as {
			type: string;
			agents: Array<{ agentId: string; status: string }>;
		};
		expect(snapshot.type).toBe("snapshot");
		const master = snapshot.agents.find((a) => a.agentId === masterAgentId);
		// Agent should be present and marked offline
		expect(master).toBeDefined();
		expect(master?.status).toBe("offline");

		ws.close();
	});
});
