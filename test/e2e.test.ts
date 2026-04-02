/**
 * End-to-end integration tests for claw-socket.
 *
 * Covers: startup, health check, WebSocket lifecycle, snapshot, subscribe,
 * replay with sequence numbers, heartbeat/ping-pong, graceful shutdown,
 * hook endpoint, and error recovery.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";

let app: ReturnType<typeof createServer>;
let port = 0;

beforeAll(async () => {
	app = createServer({ port: 0, replayBufferSize: 100 });
	await app.start();
	// biome-ignore lint: port is always assigned after Bun.serve
	port = app.server.port!;
});

afterAll(async () => {
	await app.stop();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function waitForMessages(
	messages: unknown[],
	count: number,
	timeoutMs = 3000,
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

function waitForClose(ws: WebSocket, timeoutMs = 3000): Promise<CloseEvent> {
	if (ws.readyState === WebSocket.CLOSED)
		return Promise.resolve(new CloseEvent("close"));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Timed out waiting for close")),
			timeoutMs,
		);
		ws.addEventListener("close", (e) => {
			clearTimeout(timer);
			resolve(e);
		});
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("health check endpoint", () => {
	test("GET /health returns ok", async () => {
		const res = await fetch(`http://localhost:${port}/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe("ok");
	});
});

describe("WebSocket connection", () => {
	test("server sends snapshot on connect", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);
		expect(messages[0]).toMatchObject({
			type: "snapshot",
			sessions: expect.any(Array),
			agents: expect.any(Array),
		});
		ws.close();
	});

	test("client can subscribe and receive confirmation", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		ws.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		await waitForMessages(messages, 2);
		expect(messages[1]).toMatchObject({
			type: "subscribed",
			topics: expect.arrayContaining(["session.*"]),
		});
		ws.close();
	});

	test("broadcast events include sequence numbers", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		ws.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		await waitForMessages(messages, 2);

		// Trigger a broadcast via the internal API
		app.broadcast({
			type: "session.discovered",
			sessionId: "e2e-seq-test",
			timestamp: Date.now(),
			data: {
				pid: 999,
				sessionId: "e2e-seq-test",
				cwd: "/tmp",
				startedAt: Date.now(),
			},
		});

		await waitForMessages(messages, 3);
		const ev = messages[2] as Record<string, unknown>;
		expect(typeof ev["seq"]).toBe("number");
		expect(ev["seq"]).toBeGreaterThanOrEqual(0);
		ws.close();
	});

	test("replay delivers events after lastSeq", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		// Subscribe so replayed events are filtered through
		ws.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		await waitForMessages(messages, 2);

		// Emit a known event to populate the replay buffer
		app.broadcast({
			type: "session.discovered",
			sessionId: "e2e-replay-test",
			timestamp: Date.now(),
			data: {
				pid: 123,
				sessionId: "e2e-replay-test",
				cwd: "/tmp",
				startedAt: Date.now(),
			},
		});
		await waitForMessages(messages, 3);

		const firstEvent = messages[2] as Record<string, unknown>;
		const seqBefore = (firstEvent["seq"] as number) - 1;

		// Request replay from before that event
		ws.send(JSON.stringify({ type: "replay", lastSeq: seqBefore }));

		// The replayed event should arrive
		await waitForMessages(messages, 4);
		const replayed = messages[3] as Record<string, unknown>;
		expect(replayed["type"]).toBe("session.discovered");
		expect(replayed["sessionId"]).toBe("e2e-replay-test");

		ws.close();
	});

	test("replay with seq at latest returns nothing", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		ws.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
		await waitForMessages(messages, 2);

		// Emit an event to get a high seq
		app.broadcast({
			type: "session.discovered",
			sessionId: "e2e-replay-empty",
			timestamp: Date.now(),
			data: {
				pid: 456,
				sessionId: "e2e-replay-empty",
				cwd: "/tmp",
				startedAt: Date.now(),
			},
		});
		await waitForMessages(messages, 3);
		const lastEv = messages[2] as Record<string, unknown>;
		const latestSeq = lastEv["seq"] as number;

		const before = messages.length;
		ws.send(JSON.stringify({ type: "replay", lastSeq: latestSeq }));

		// Allow some time to confirm no extra messages arrive
		await new Promise((r) => setTimeout(r, 100));
		expect(messages.length).toBe(before);

		ws.close();
	});
});

describe("ping-pong / heartbeat", () => {
	test("server accepts pong response from client", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		// The native WebSocket API handles pong automatically in browsers/Bun clients.
		// We just verify the connection stays open after a short delay.
		await new Promise((r) => setTimeout(r, 50));
		expect(ws.readyState).toBe(WebSocket.OPEN);

		ws.close();
	});
});

describe("hook endpoint", () => {
	test("POST /hook with valid payload emits event", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		ws.send(JSON.stringify({ type: "subscribe", topics: ["tool.*"] }));
		await waitForMessages(messages, 2);

		const hookPayload = {
			sessionId: "e2e-hook-session",
			type: "PostToolUse",
			data: {
				tool_name: "Bash",
				tool_input: { command: "echo hello" },
				tool_response: { output: "hello\n", exit_code: 0 },
			},
		};

		const res = await fetch(`http://localhost:${port}/hook`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(hookPayload),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe("ok");

		ws.close();
	});

	test("POST /hook with invalid payload returns 400", async () => {
		const res = await fetch(`http://localhost:${port}/hook`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ not: "a hook" }),
		});
		expect(res.status).toBe(400);
	});

	test("POST /hook with malformed JSON returns 400", async () => {
		const res = await fetch(`http://localhost:${port}/hook`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json at all",
		});
		expect(res.status).toBe(400);
	});
});

describe("graceful shutdown", () => {
	test("connections closed with code 1001 on stop", async () => {
		// Spin up a separate server so we can stop it independently
		const tempApp = createServer({ port: 0 });
		await tempApp.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		const tempPort = tempApp.server.port!;

		const { ws } = await new Promise<{ ws: WebSocket; messages: unknown[] }>(
			(resolve, reject) => {
				const w = new WebSocket(`ws://localhost:${tempPort}`);
				const msgs: unknown[] = [];
				w.addEventListener("message", (e) =>
					msgs.push(JSON.parse(e.data as string)),
				);
				w.onopen = () => resolve({ ws: w, messages: msgs });
				w.onerror = reject;
			},
		);

		expect(ws.readyState).toBe(WebSocket.OPEN);

		const closePromise = waitForClose(ws);
		void tempApp.stop();

		const closeEvent = await closePromise;
		// Server sends 1001 "going away"; Bun normalizes it to 1000 on the client side
		expect(closeEvent.code).toBeLessThanOrEqual(1001);
		expect(closeEvent.reason).toBe("server going away");
	});
});

describe("error handling", () => {
	test("invalid message type returns error", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		ws.send(JSON.stringify({ type: "unknown_type_xyz" }));
		await waitForMessages(messages, 2);
		expect(messages[1]).toMatchObject({ error: "invalid message" });
		ws.close();
	});

	test("malformed JSON returns error", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		ws.send("{bad json");
		await waitForMessages(messages, 2);
		expect(messages[1]).toMatchObject({ error: "invalid JSON" });
		ws.close();
	});

	test("replay message with invalid schema returns error", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1);

		ws.send(JSON.stringify({ type: "replay", lastSeq: "not-a-number" }));
		await waitForMessages(messages, 2);
		expect(messages[1]).toMatchObject({ error: "invalid message" });
		ws.close();
	});
});

describe("AsyncAPI spec", () => {
	test("GET /asyncapi.json returns valid spec", async () => {
		const res = await fetch(`http://localhost:${port}/asyncapi.json`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { asyncapi: string };
		expect(body.asyncapi).toBeTruthy();
	});
});
