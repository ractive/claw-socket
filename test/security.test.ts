/**
 * Security hardening tests for claw-socket.
 *
 * Covers: maxConnections rejection (HTTP 503), oversized WS message handling,
 * Zod error sanitization (no internal fields leaked), unsubscribe_agent_log,
 * replay rate limiting, and CSP header on /docs.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectWs(
	port: number,
): Promise<{ ws: WebSocket; messages: unknown[] }> {
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
// maxConnections — each test uses its own isolated server
// ---------------------------------------------------------------------------

describe("maxConnections enforcement", () => {
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0, maxConnections: 2 });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("3rd connection attempt receives HTTP 503", async () => {
		// Occupy both slots
		const { ws: ws1 } = await connectWs(port);
		const { ws: ws2 } = await connectWs(port);

		// Third attempt — must not upgrade (expects 503 or connection error)
		const res = await fetch(`http://localhost:${port}`, {
			headers: { Upgrade: "websocket", Connection: "Upgrade" },
		});
		expect(res.status).toBe(503);

		ws1.close();
		ws2.close();
	});

	test("after a slot frees up, a new connection is accepted", async () => {
		const { ws: ws1 } = await connectWs(port);
		const { ws: ws2 } = await connectWs(port);

		// Close one slot and wait for the server to register it
		const closePromise = waitForClose(ws1);
		ws1.close();
		await closePromise;
		// Small yield so the server's close handler runs
		await new Promise((r) => setTimeout(r, 50));

		// Now a third connection should succeed
		const { ws: ws3 } = await connectWs(port);
		expect(ws3.readyState).toBe(WebSocket.OPEN);

		ws2.close();
		ws3.close();
	});
});

// ---------------------------------------------------------------------------
// Oversized WebSocket message
// ---------------------------------------------------------------------------

describe("oversized WebSocket message", () => {
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0 });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("sending a message > 64 KB causes the connection to close", async () => {
		const { ws } = await connectWs(port);

		// Build a payload just over the 64 KB maxPayloadLength
		const oversized = "x".repeat(65_537);
		ws.send(oversized);

		const closeEvent = await waitForClose(ws);
		// Bun closes the connection when the payload exceeds maxPayloadLength.
		// The close code may be 1009 (message too big) or a generic code.
		expect(ws.readyState).toBe(WebSocket.CLOSED);
		// Just verify we got a close — the exact code is Bun-internal
		expect(closeEvent).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Zod error sanitization — no internal fields leaked
// ---------------------------------------------------------------------------

describe("Zod error sanitization", () => {
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0 });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("invalid message returns 'invalid message' without Zod internals", async () => {
		const { ws, messages } = await connectWs(port);
		await waitForMessages(messages, 1); // snapshot

		// Send a structurally invalid message that will fail Zod validation
		ws.send(JSON.stringify({ type: "subscribe" })); // missing required `topics`
		await waitForMessages(messages, 2);

		const response = messages[1] as Record<string, unknown>;

		// Must surface a human-readable error
		expect(response["error"]).toBe("invalid message");

		// Must NOT expose Zod internals
		expect(response).not.toHaveProperty("issues");
		expect(response).not.toHaveProperty("errors");
		expect(response).not.toHaveProperty("_errors");

		// Serialized form must not contain Zod field-path noise
		const raw = JSON.stringify(response);
		expect(raw).not.toContain('"path"');
		expect(raw).not.toContain('"code"');
		expect(raw).not.toContain('"received"');
		expect(raw).not.toContain('"expected"');

		ws.close();
	});

	test("wrong field type returns 'invalid message' without leaking field names", async () => {
		const { ws, messages } = await connectWs(port);
		await waitForMessages(messages, 1); // snapshot

		// replay.lastSeq must be a non-negative integer — send a string
		ws.send(JSON.stringify({ type: "replay", lastSeq: "bad" }));
		await waitForMessages(messages, 2);

		const response = messages[1] as Record<string, unknown>;
		expect(response["error"]).toBe("invalid message");
		expect(response).not.toHaveProperty("issues");

		ws.close();
	});
});

// ---------------------------------------------------------------------------
// unsubscribe_agent_log
// ---------------------------------------------------------------------------

describe("unsubscribe_agent_log", () => {
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0 });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("subscribe then unsubscribe a specific session", async () => {
		const { ws, messages } = await connectWs(port);
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({ type: "subscribe_agent_log", sessionId: "sess-abc" }),
		);
		await waitForMessages(messages, 2);
		expect(messages[1]).toMatchObject({
			type: "subscribed_agent_log",
			sessionId: "sess-abc",
		});

		ws.send(
			JSON.stringify({ type: "unsubscribe_agent_log", sessionId: "sess-abc" }),
		);
		await waitForMessages(messages, 3);
		expect(messages[2]).toMatchObject({
			type: "unsubscribed_agent_log",
			sessionId: "sess-abc",
		});

		ws.close();
	});

	test("unsubscribe without sessionId clears all subscriptions", async () => {
		const { ws, messages } = await connectWs(port);
		await waitForMessages(messages, 1); // snapshot

		// Subscribe to two sessions
		ws.send(
			JSON.stringify({ type: "subscribe_agent_log", sessionId: "sess-1" }),
		);
		await waitForMessages(messages, 2);

		ws.send(
			JSON.stringify({ type: "subscribe_agent_log", sessionId: "sess-2" }),
		);
		await waitForMessages(messages, 3);

		// Unsubscribe all (no sessionId)
		ws.send(JSON.stringify({ type: "unsubscribe_agent_log" }));
		await waitForMessages(messages, 4);
		expect(messages[3]).toMatchObject({
			type: "unsubscribed_agent_log",
			sessionId: null,
		});

		ws.close();
	});
});

// ---------------------------------------------------------------------------
// Replay rate limiting
// ---------------------------------------------------------------------------

describe("replay rate limiting", () => {
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0 });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("second replay within 1 second returns rate_limited error", async () => {
		const { ws, messages } = await connectWs(port);
		await waitForMessages(messages, 1); // snapshot

		// First replay — should succeed (no events to replay, but accepted)
		ws.send(JSON.stringify({ type: "replay", lastSeq: 0 }));
		// Give it a moment to process; no events will come back but no error either
		await new Promise((r) => setTimeout(r, 50));

		const countAfterFirst = messages.length;

		// Second replay immediately — must be rate limited
		ws.send(JSON.stringify({ type: "replay", lastSeq: 0 }));
		await waitForMessages(messages, countAfterFirst + 1);

		const rateLimitedMsg = messages[countAfterFirst] as Record<string, unknown>;
		expect(rateLimitedMsg["error"]).toBe("rate_limited");
		expect(typeof rateLimitedMsg["message"]).toBe("string");

		ws.close();
	});

	test("replay succeeds again after 1 second has passed", async () => {
		const { ws, messages } = await connectWs(port);
		await waitForMessages(messages, 1); // snapshot

		// First replay
		ws.send(JSON.stringify({ type: "replay", lastSeq: 0 }));
		await new Promise((r) => setTimeout(r, 50));
		const countAfterFirst = messages.length;

		// Wait for the rate limit window to expire
		await new Promise((r) => setTimeout(r, 1100));

		// Second replay — should be accepted, not rate limited
		ws.send(JSON.stringify({ type: "replay", lastSeq: 0 }));
		await new Promise((r) => setTimeout(r, 100));

		// No rate_limited error should have arrived
		const newMessages = messages.slice(countAfterFirst);
		const hasRateLimitError = newMessages.some(
			(m) => (m as Record<string, unknown>)["error"] === "rate_limited",
		);
		expect(hasRateLimitError).toBe(false);

		ws.close();
	});
});

// ---------------------------------------------------------------------------
// /docs CSP header
// ---------------------------------------------------------------------------

describe("/docs endpoint", () => {
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0 });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("GET /docs returns HTML when public/index.html exists", async () => {
		// public/index.html is generated by `bun run export-spec && asyncapi generate ...`
		// If it exists, expect 200; if not, expect 503 with a helpful message.
		const res = await fetch(`http://localhost:${port}/docs`);
		if (res.status === 200) {
			expect(res.headers.get("content-type")).toContain("text/html");
			expect(res.headers.get("Content-Security-Policy")).toBeNull();
		} else {
			expect(res.status).toBe(503);
			const body = await res.text();
			expect(body).toContain("bun run export-spec");
		}
	});

	test("GET /docs does not include a Content-Security-Policy header", async () => {
		const res = await fetch(`http://localhost:${port}/docs`);
		expect(res.headers.get("Content-Security-Policy")).toBeNull();
	});
});
