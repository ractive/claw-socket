/**
 * Tests for file-based token authentication (iteration 15).
 *
 * Covers: token file I/O, permissions, reuse, rotation,
 * WS upgrade auth enforcement, POST /hook auth enforcement,
 * read-only endpoints bypass, and --no-auth (authToken: null).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectWs(
	port: number,
	token?: string,
): Promise<{ ws: WebSocket; messages: unknown[] }> {
	return new Promise((resolve, reject) => {
		const url = token
			? `ws://localhost:${port}?token=${token}`
			: `ws://localhost:${port}`;
		const ws = new WebSocket(url);
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

// ---------------------------------------------------------------------------
// Token module tests (using isolated temp directory)
// ---------------------------------------------------------------------------

describe("token file I/O", () => {
	let tmpDir: string;
	let originalHome: string;

	beforeEach(async () => {
		tmpDir = join(
			tmpdir(),
			`claw-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(tmpDir, { recursive: true });
		originalHome = process.env["HOME"] ?? "";
		// We cannot easily override homedir() for the auth module,
		// so we test the module's public API through integration tests below.
		// Here we test the token format and file behaviour directly.
	});

	afterEach(async () => {
		process.env["HOME"] = originalHome;
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("ensureToken creates token with correct format", async () => {
		// We test through the server integration — ensureToken is called by CLI.
		// Here we verify the contract: 64 hex chars (32 bytes).
		const { ensureToken, tokenPath } = await import("../src/auth.ts");
		const token = await ensureToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(tokenPath()).toContain(".claw-socket/token");
	});

	test("ensureToken returns the same token on subsequent calls", async () => {
		const { ensureToken } = await import("../src/auth.ts");
		const token1 = await ensureToken();
		const token2 = await ensureToken();
		expect(token1).toBe(token2);
	});

	test("rotateToken generates a new token", async () => {
		const { ensureToken, rotateToken } = await import("../src/auth.ts");
		const original = await ensureToken();
		const rotated = await rotateToken();
		expect(rotated).toMatch(/^[0-9a-f]{64}$/);
		expect(rotated).not.toBe(original);

		// Subsequent ensureToken returns the rotated token
		const after = await ensureToken();
		expect(after).toBe(rotated);
	});

	test("token file has restrictive permissions (mode 600)", async () => {
		const { ensureToken, tokenPath } = await import("../src/auth.ts");
		await ensureToken();
		const s = await stat(tokenPath());
		// mode & 0o777 gives the permission bits
		expect(s.mode & 0o777).toBe(0o600);
	});

	test("token directory has restrictive permissions (mode 700)", async () => {
		const { ensureToken, tokenPath } = await import("../src/auth.ts");
		const { dirname } = await import("node:path");
		await ensureToken();
		const s = await stat(dirname(tokenPath()));
		expect(s.mode & 0o777).toBe(0o700);
	});
});

// ---------------------------------------------------------------------------
// Timing-safe token comparison
// ---------------------------------------------------------------------------

describe("constantTimeEquals", async () => {
	const { constantTimeEquals } = await import("../src/http-handler.ts");

	test("returns true for identical strings", () => {
		expect(constantTimeEquals("abc", "abc")).toBe(true);
		expect(constantTimeEquals("a".repeat(64), "a".repeat(64))).toBe(true);
	});

	test("returns false for different strings of same length", () => {
		expect(constantTimeEquals("abc", "abd")).toBe(false);
		expect(constantTimeEquals("a".repeat(64), "b".repeat(64))).toBe(false);
	});

	test("returns false for different lengths", () => {
		expect(constantTimeEquals("abc", "abcd")).toBe(false);
		expect(constantTimeEquals("", "a")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// WebSocket upgrade auth enforcement
// ---------------------------------------------------------------------------

describe("WebSocket upgrade auth", () => {
	const TEST_TOKEN = "a".repeat(64);
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0, authToken: TEST_TOKEN });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("upgrade without token returns 401", async () => {
		const res = await fetch(`http://localhost:${port}`, {
			headers: { Upgrade: "websocket", Connection: "Upgrade" },
		});
		expect(res.status).toBe(401);
	});

	test("upgrade with wrong token returns 401", async () => {
		const res = await fetch(`http://localhost:${port}?token=wrong`, {
			headers: { Upgrade: "websocket", Connection: "Upgrade" },
		});
		expect(res.status).toBe(401);
	});

	test("upgrade with correct token succeeds", async () => {
		const { ws, messages } = await connectWs(port, TEST_TOKEN);
		await waitForMessages(messages, 1); // snapshot
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});
});

// ---------------------------------------------------------------------------
// POST /hook auth enforcement
// ---------------------------------------------------------------------------

describe("POST /hook auth", () => {
	const TEST_TOKEN = "b".repeat(64);
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0, authToken: TEST_TOKEN });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("POST /hook without Authorization returns 401", async () => {
		const res = await fetch(`http://localhost:${port}/hook`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body["error"]).toBe("unauthorized");
	});

	test("POST /hook with wrong Bearer token returns 401", async () => {
		const res = await fetch(`http://localhost:${port}/hook`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer wrong-token",
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(401);
	});

	test("POST /hook with malformed Authorization headers returns 401", async () => {
		const malformed = [
			"Bearer",
			"Bearer ",
			"Basic abc123",
			`bearer ${TEST_TOKEN}`,
		];
		for (const header of malformed) {
			const res = await fetch(`http://localhost:${port}/hook`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: header,
				},
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(401);
		}
	});

	test("POST /hook with correct Bearer token is accepted", async () => {
		// Even with an invalid hook payload, we should get past auth (400, not 401)
		const res = await fetch(`http://localhost:${port}/hook`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${TEST_TOKEN}`,
			},
			body: JSON.stringify({}),
		});
		// 400 = invalid hook payload, but auth passed
		expect(res.status).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// Read-only endpoints bypass auth
// ---------------------------------------------------------------------------

describe("read-only endpoints bypass auth", () => {
	const TEST_TOKEN = "c".repeat(64);
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0, authToken: TEST_TOKEN });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("GET /health works without token", async () => {
		const res = await fetch(`http://localhost:${port}/health`);
		expect(res.status).toBe(200);
	});

	test("GET /asyncapi.json works without token", async () => {
		const res = await fetch(`http://localhost:${port}/asyncapi.json`);
		expect(res.status).toBe(200);
	});

	test("GET /docs works without token", async () => {
		const res = await fetch(`http://localhost:${port}/docs`);
		// 200 if docs exist, 503 if not — either way, not 401
		expect([200, 503]).toContain(res.status);
	});
});

// ---------------------------------------------------------------------------
// authToken: null (--no-auth) — auth disabled
// ---------------------------------------------------------------------------

describe("authToken: null disables auth", () => {
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeEach(async () => {
		app = createServer({ port: 0, authToken: null });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterEach(async () => {
		await app.stop();
	});

	test("WebSocket upgrade succeeds without token", async () => {
		const { ws, messages } = await connectWs(port);
		await waitForMessages(messages, 1);
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});

	test("POST /hook succeeds without Authorization header", async () => {
		const res = await fetch(`http://localhost:${port}/hook`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		// 400 = invalid payload, but auth was not checked
		expect(res.status).toBe(400);
	});
});
