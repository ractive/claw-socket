import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { envelope } from "../src/schemas/envelope.ts";
import { createServer } from "../src/server.ts";

let app: ReturnType<typeof createServer>;
let port = 0;

beforeAll(async () => {
	// Use port 0 to let the OS assign an ephemeral port
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
		// Buffer messages immediately — before onopen fires
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

describe("WebSocket server", () => {
	test("sends snapshot on connect", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);
		expect(messages[0]).toMatchObject({
			type: "snapshot",
			sessions: expect.any(Array),
		});
		ws.close();
	});

	test("subscribe returns confirmation", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		await waitForMessages(messages, 2);
		expect(messages[1]).toMatchObject({
			type: "subscribed",
			topics: ["session.*"],
		});
		ws.close();
	});

	test("unsubscribe returns confirmation", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({ type: "subscribe", topics: ["session.*", "tool.*"] }),
		);
		await waitForMessages(messages, 2); // subscribed

		ws.send(JSON.stringify({ type: "unsubscribe", topics: ["tool.*"] }));
		await waitForMessages(messages, 3);
		expect(messages[2]).toMatchObject({
			type: "unsubscribed",
			topics: ["session.*"],
		});
		ws.close();
	});

	test("get_snapshot returns current state", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "get_snapshot" }));
		await waitForMessages(messages, 2);
		expect(messages[1]).toMatchObject({ type: "snapshot" });
		ws.close();
	});

	test("rejects invalid JSON", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send("not json");
		await waitForMessages(messages, 2);
		expect(messages[1]).toMatchObject({ error: "invalid JSON" });
		ws.close();
	});

	test("rejects invalid message type", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "bogus" }));
		await waitForMessages(messages, 2);
		expect(messages[1]).toMatchObject({ error: "invalid message" });
		ws.close();
	});

	test("broadcast only reaches subscribed clients", async () => {
		const { ws: ws1, messages: msgs1 } = await connectWs();
		const { ws: ws2, messages: msgs2 } = await connectWs();
		await waitForMessages(msgs1, 1); // snapshot
		await waitForMessages(msgs2, 1); // snapshot

		// Subscribe ws1 to session.*, ws2 to tool.*
		ws1.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		ws2.send(JSON.stringify({ type: "subscribe", topics: ["tool.*"] }));
		await waitForMessages(msgs1, 2); // subscribed
		await waitForMessages(msgs2, 2); // subscribed

		const beforeCount1 = msgs1.length;
		const beforeCount2 = msgs2.length;

		// Broadcast a session event — only ws1 should receive it
		app.broadcast(
			envelope("session.discovered", "test-session", { pid: 9999 }),
		);

		await waitForMessages(msgs1, beforeCount1 + 1);
		// Give ws2 a moment to confirm it does NOT receive the message
		await new Promise((r) => setTimeout(r, 50));

		expect(msgs1.slice(beforeCount1)).toHaveLength(1);
		expect(msgs1[beforeCount1]).toMatchObject({ type: "session.discovered" });
		expect(msgs2.slice(beforeCount2)).toHaveLength(0);

		ws1.close();
		ws2.close();
	});

	test("subscribe without sessionId clears previous filter", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		// Subscribe with session filter
		ws.send(
			JSON.stringify({
				type: "subscribe",
				topics: ["session.*"],
				sessionId: "specific-session",
			}),
		);
		await waitForMessages(messages, 2);

		// Re-subscribe without sessionId to clear filter
		ws.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		await waitForMessages(messages, 3);

		const beforeCount = messages.length;

		// Broadcast to a different session — should now be received
		app.broadcast(
			envelope("session.discovered", "other-session", { pid: 1234 }),
		);
		await waitForMessages(messages, beforeCount + 1);
		expect(messages[beforeCount]).toMatchObject({ type: "session.discovered" });

		ws.close();
	});
});

describe("Health check", () => {
	test("/health returns ok", async () => {
		const res = await fetch(`http://localhost:${port}/health`);
		const body = await res.json();
		expect(body).toMatchObject({ status: "ok" });
	});
});
