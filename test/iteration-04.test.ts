/**
 * Iteration 04: Subscriptions & Filtering
 * Tests for:
 *   - get_session_list
 *   - get_session_history
 *   - subscribe_agent_log
 *   - Bun pub/sub glob pattern late-binding
 *   - Backpressure option wiring
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { envelope } from "../src/schemas/envelope.ts";
import { createServer } from "../src/server.ts";
import { deriveJsonlPath } from "../src/session-watcher.ts";

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

describe("get_session_list", () => {
	test("returns session_list with sessions array", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "get_session_list" }));
		await waitForMessages(messages, 2);

		expect(messages[1]).toMatchObject({
			type: "session_list",
			sessions: expect.any(Array),
		});
		ws.close();
	});

	test("session_list sessions consistent with snapshot", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "get_session_list" }));
		await waitForMessages(messages, 2);

		const snapshot = messages[0] as { sessions: unknown[] };
		const list = messages[1] as { sessions: unknown[] };
		// Both should return the same sessions array
		expect(list.sessions).toEqual(snapshot.sessions);
		ws.close();
	});
});

describe("get_session_history", () => {
	test("returns empty events for unknown session", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({
				type: "get_session_history",
				sessionId: "nonexistent-session-id",
			}),
		);
		await waitForMessages(messages, 2);

		expect(messages[1]).toMatchObject({
			type: "session_history",
			sessionId: "nonexistent-session-id",
			events: [],
		});
		ws.close();
	});

	test("accepts optional limit parameter", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({
				type: "get_session_history",
				sessionId: "nonexistent-session-id",
				limit: 10,
			}),
		);
		await waitForMessages(messages, 2);

		expect(messages[1]).toMatchObject({
			type: "session_history",
			sessionId: "nonexistent-session-id",
			events: expect.any(Array),
		});
		ws.close();
	});

	test("rejects negative limit", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({
				type: "get_session_history",
				sessionId: "some-session",
				limit: -1,
			}),
		);
		await waitForMessages(messages, 2);

		expect(messages[1]).toMatchObject({ error: "invalid message" });
		ws.close();
	});

	test("rejects missing sessionId", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "get_session_history" }));
		await waitForMessages(messages, 2);

		expect(messages[1]).toMatchObject({ error: "invalid message" });
		ws.close();
	});
});

describe("subscribe_agent_log", () => {
	test("returns subscribed_agent_log confirmation", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({
				type: "subscribe_agent_log",
				sessionId: "test-session-abc",
			}),
		);
		await waitForMessages(messages, 2);

		expect(messages[1]).toMatchObject({
			type: "subscribed_agent_log",
			sessionId: "test-session-abc",
		});
		ws.close();
	});

	test("rejects missing sessionId", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "subscribe_agent_log" }));
		await waitForMessages(messages, 2);

		expect(messages[1]).toMatchObject({ error: "invalid message" });
		ws.close();
	});

	test("multiple subscribe_agent_log calls for different sessions are independent", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({ type: "subscribe_agent_log", sessionId: "session-A" }),
		);
		ws.send(
			JSON.stringify({ type: "subscribe_agent_log", sessionId: "session-B" }),
		);
		await waitForMessages(messages, 3);

		expect(messages[1]).toMatchObject({
			type: "subscribed_agent_log",
			sessionId: "session-A",
		});
		expect(messages[2]).toMatchObject({
			type: "subscribed_agent_log",
			sessionId: "session-B",
		});
		ws.close();
	});
});

describe("pub/sub glob pattern routing", () => {
	test("glob subscriber receives broadcast for matching event type", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		await waitForMessages(messages, 2); // subscribed

		const before = messages.length;
		app.broadcast(
			envelope("session.discovered", "pub-sub-test-session", { pid: 9876 }),
		);
		await waitForMessages(messages, before + 1);

		expect(messages[before]).toMatchObject({ type: "session.discovered" });
		ws.close();
	});

	test("brand-new event type matching existing glob gets forwarded", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "subscribe", topics: ["custom.*"] }));
		await waitForMessages(messages, 2); // subscribed

		const before = messages.length;
		app.broadcast(envelope("custom.thing", "some-session", { value: 42 }));
		await waitForMessages(messages, before + 1);

		expect(messages[before]).toMatchObject({ type: "custom.thing" });
		ws.close();
	});

	test("non-matching glob does not receive event", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "subscribe", topics: ["tool.*"] }));
		await waitForMessages(messages, 2); // subscribed

		const before = messages.length;
		app.broadcast(
			envelope("session.discovered", "glob-filter-test", { pid: 1111 }),
		);
		await new Promise((r) => setTimeout(r, 60));
		expect(messages.length).toBe(before);
		ws.close();
	});

	test("exact topic subscriber does not receive different exact topic", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "subscribe", topics: ["tool.started"] }));
		await waitForMessages(messages, 2); // subscribed

		const before = messages.length;
		app.broadcast(
			envelope("tool.completed", "exact-topic-test", { toolName: "Bash" }),
		);
		await new Promise((r) => setTimeout(r, 60));
		expect(messages.length).toBe(before);
		ws.close();
	});

	test("session-filtered subscriber only receives events for their session", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({
				type: "subscribe",
				topics: ["session.*"],
				sessionId: "target-session",
			}),
		);
		await waitForMessages(messages, 2); // subscribed

		const before = messages.length;

		// Broadcast to a different session — should not arrive
		app.broadcast(
			envelope("session.discovered", "other-session", { pid: 111 }),
		);
		await new Promise((r) => setTimeout(r, 50));
		expect(messages.length).toBe(before);

		// Broadcast to the target session — should arrive
		app.broadcast(
			envelope("session.discovered", "target-session", { pid: 222 }),
		);
		await waitForMessages(messages, before + 1);
		expect(messages[before]).toMatchObject({
			type: "session.discovered",
			sessionId: "target-session",
		});
		ws.close();
	});
});

describe("backpressure option", () => {
	test("createServer accepts backpressureLimit option", () => {
		const customApp = createServer({ port: 0, backpressureLimit: 512_000 });
		expect(customApp.server).toBeDefined();
		customApp.stop();
	});
});

describe("deriveJsonlPath export", () => {
	test("is exported and returns a .jsonl path under .claude/projects", () => {
		const path = deriveJsonlPath("test-session-123", "/home/user/project");
		expect(path).toContain("test-session-123.jsonl");
		expect(path).toContain(".claude");
		expect(path).toContain("projects");
	});

	test("encodes forward slashes in cwd into path segment", () => {
		const path = deriveJsonlPath("abc", "/Users/james/my-project");
		expect(path).not.toContain("/Users/james/my-project");
		expect(path).toContain("abc.jsonl");
	});
});
