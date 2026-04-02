import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";

const PORT = 13838;
let app: ReturnType<typeof createServer>;

beforeAll(async () => {
	app = createServer({ port: PORT });
	await app.start();
});

afterAll(() => {
	app.stop();
});

function connectWs(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://localhost:${PORT}`);
		ws.onopen = () => resolve(ws);
		ws.onerror = (e) => reject(e);
	});
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
	return new Promise((resolve) => {
		ws.onmessage = (e) => resolve(JSON.parse(e.data as string));
	});
}

describe("WebSocket server", () => {
	test("sends snapshot on connect", async () => {
		const ws = await connectWs();
		const msg = await waitForMessage(ws);
		expect(msg).toMatchObject({
			type: "snapshot",
			sessions: expect.any(Array),
		});
		ws.close();
	});

	test("subscribe returns confirmation", async () => {
		const ws = await connectWs();
		// Consume snapshot
		await waitForMessage(ws);

		ws.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		const msg = await waitForMessage(ws);
		expect(msg).toMatchObject({ type: "subscribed", topics: ["session.*"] });
		ws.close();
	});

	test("unsubscribe returns confirmation", async () => {
		const ws = await connectWs();
		await waitForMessage(ws);

		ws.send(
			JSON.stringify({ type: "subscribe", topics: ["session.*", "tool.*"] }),
		);
		await waitForMessage(ws);

		ws.send(JSON.stringify({ type: "unsubscribe", topics: ["tool.*"] }));
		const msg = await waitForMessage(ws);
		expect(msg).toMatchObject({ type: "unsubscribed", topics: ["session.*"] });
		ws.close();
	});

	test("get_snapshot returns current state", async () => {
		const ws = await connectWs();
		await waitForMessage(ws);

		ws.send(JSON.stringify({ type: "get_snapshot" }));
		const msg = await waitForMessage(ws);
		expect(msg).toMatchObject({ type: "snapshot" });
		ws.close();
	});

	test("rejects invalid JSON", async () => {
		const ws = await connectWs();
		await waitForMessage(ws);

		ws.send("not json");
		const msg = await waitForMessage(ws);
		expect(msg).toMatchObject({ error: "invalid JSON" });
		ws.close();
	});

	test("rejects invalid message type", async () => {
		const ws = await connectWs();
		await waitForMessage(ws);

		ws.send(JSON.stringify({ type: "bogus" }));
		const msg = await waitForMessage(ws);
		expect(msg).toMatchObject({ error: "invalid message" });
		ws.close();
	});

	test("broadcast only reaches subscribed clients", async () => {
		const ws1 = await connectWs();
		const ws2 = await connectWs();

		// Collect ALL messages from both sockets
		const ws1Messages: unknown[] = [];
		const ws2Messages: unknown[] = [];
		ws1.onmessage = (e) => ws1Messages.push(JSON.parse(e.data as string));
		ws2.onmessage = (e) => ws2Messages.push(JSON.parse(e.data as string));

		// Wait for snapshots
		await new Promise((r) => setTimeout(r, 100));

		// Subscribe
		ws1.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		ws2.send(JSON.stringify({ type: "subscribe", topics: ["tool.*"] }));

		// Wait for subscribe confirmations
		await new Promise((r) => setTimeout(r, 100));

		// Clear collected messages
		const ws1Before = ws1Messages.length;
		const ws2Before = ws2Messages.length;

		// Broadcast a session event
		const { envelope } = await import("../src/schemas/envelope.ts");
		app.broadcast(
			envelope("session.discovered", "test-session", { pid: 9999 }),
		);

		// Give messages time to arrive
		await new Promise((r) => setTimeout(r, 200));

		const ws1New = ws1Messages.slice(ws1Before);
		const ws2New = ws2Messages.slice(ws2Before);

		expect(ws1New).toHaveLength(1);
		expect(ws1New[0]).toMatchObject({ type: "session.discovered" });
		expect(ws2New).toHaveLength(0);

		ws1.close();
		ws2.close();
	});
});

describe("Health check", () => {
	test("/health returns ok", async () => {
		const res = await fetch(`http://localhost:${PORT}/health`);
		const body = await res.json();
		expect(body).toMatchObject({ status: "ok" });
	});
});
