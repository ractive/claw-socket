import { timingSafeEqual } from "node:crypto";
import { generateAsyncApiSpec } from "./asyncapi-generator.ts";
import { processHookEvent } from "./hook-handler.ts";
import { logger } from "./logger.ts";
import { envelope } from "./schemas/envelope.ts";
import type { EventEnvelope } from "./schemas/index.ts";
import type { SessionDiscovery } from "./session-discovery.ts";
import type { SessionWatcher } from "./session-watcher.ts";
import type { ClientData } from "./ws-utils.ts";

// Lazily computed on first request — the spec is static for the lifetime of the process
let asyncApiSpecCache: string | null = null;
function getAsyncApiSpecJson(): string {
	if (asyncApiSpecCache === null) {
		asyncApiSpecCache = JSON.stringify(generateAsyncApiSpec(), null, 2);
	}
	return asyncApiSpecCache;
}

// Cached on first successful load — regenerate by restarting the server
let docsHtmlCache: string | null = null;

// ---------------------------------------------------------------------------
// Timing-safe token comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time string equality check to prevent timing side-channel attacks.
 * Returns false immediately for mismatched lengths (leaks only length info,
 * which is acceptable since all valid tokens are a fixed 64 hex chars).
 */
export function constantTimeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ---------------------------------------------------------------------------
// Origin validation — blocks Cross-Site WebSocket Hijacking (CSWSH)
// ---------------------------------------------------------------------------

const LOCALHOST_ORIGIN_RE =
	/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Returns true if the Origin header is acceptable for a WebSocket upgrade.
 * Allows: missing origin (non-browser), null (e.g. file:// or curl), localhost variants.
 */
export function isAllowedOrigin(origin: string | null): boolean {
	if (origin === null || origin === "null") return true;
	return LOCALHOST_ORIGIN_RE.test(origin);
}

// ---------------------------------------------------------------------------
// Per-IP connection tracking
// ---------------------------------------------------------------------------

export class IpConnectionTracker {
	private counts = new Map<string, number>();
	constructor(readonly maxPerIp: number = 10) {}

	/** Returns false if the IP is at its limit */
	acquire(ip: string): boolean {
		const current = this.counts.get(ip) ?? 0;
		if (current >= this.maxPerIp) return false;
		this.counts.set(ip, current + 1);
		return true;
	}

	release(ip: string): void {
		const current = this.counts.get(ip) ?? 0;
		if (current <= 1) {
			this.counts.delete(ip);
		} else {
			this.counts.set(ip, current - 1);
		}
	}

	getCount(ip: string): number {
		return this.counts.get(ip) ?? 0;
	}
}

// ---------------------------------------------------------------------------
// HTTP endpoint rate limiting (for /hook)
// ---------------------------------------------------------------------------

const HOOK_RATE_WINDOW_MS = 10_000;
const HOOK_RATE_MAX = 200;

interface RateWindow {
	count: number;
	windowStart: number;
}

export class HttpRateLimiter {
	private windows = new Map<string, RateWindow>();

	/** Returns true if the request is allowed */
	allow(ip: string): boolean {
		const now = Date.now();
		const entry = this.windows.get(ip);
		if (!entry || now - entry.windowStart >= HOOK_RATE_WINDOW_MS) {
			this.windows.set(ip, { count: 1, windowStart: now });
			return true;
		}
		entry.count++;
		return entry.count <= HOOK_RATE_MAX;
	}

	/** Remove entries older than the window to prevent unbounded growth */
	cleanup(): void {
		const now = Date.now();
		for (const [ip, entry] of this.windows) {
			if (now - entry.windowStart >= HOOK_RATE_WINDOW_MS) {
				this.windows.delete(ip);
			}
		}
	}
}

export interface HttpHandlerDeps {
	discovery: SessionDiscovery;
	sessionWatcher: SessionWatcher;
	broadcast: (event: EventEnvelope) => void;
	/** Returns the current number of connected WebSocket clients */
	clientCount: () => number;
	/** Maximum allowed simultaneous connections */
	maxConnections: number;
	/** Per-IP connection tracker */
	ipTracker: IpConnectionTracker;
	/** Per-IP HTTP rate limiter for /hook */
	hookRateLimiter: HttpRateLimiter;
	/** Shared secret for token auth. null = auth disabled (--no-auth). */
	authToken: string | null;
}

export async function handleHttpRequest(
	req: Request,
	server: {
		upgrade(req: Request, options: { data: ClientData }): boolean;
		requestIP?(req: Request): { address: string } | null;
	},
	deps: HttpHandlerDeps,
): Promise<Response | undefined> {
	const url = new URL(req.url);

	// Health check
	if (url.pathname === "/health") {
		return new Response(
			JSON.stringify({
				status: "ok",
				sessions: deps.discovery.getSessions().length,
			}),
			{ headers: { "Content-Type": "application/json" } },
		);
	}

	// AsyncAPI spec
	if (url.pathname === "/asyncapi.json") {
		return new Response(getAsyncApiSpecJson(), {
			headers: { "Content-Type": "application/json" },
		});
	}

	// AsyncAPI docs UI — served from pre-generated static file (public/index.html relative to CWD)
	if (url.pathname === "/docs") {
		try {
			if (docsHtmlCache === null) {
				const docsPath = `${process.cwd()}/public/index.html`;
				docsHtmlCache = await Bun.file(docsPath).text();
			}
			return new Response(docsHtmlCache, {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		} catch (err) {
			const notFound =
				err instanceof Error && "code" in err && err.code === "ENOENT";
			if (!notFound) {
				logger.error("failed to read docs file", { error: String(err) });
			}
			return new Response(
				"Docs not generated yet. Run:\n  bun run export-spec\n  asyncapi generate fromTemplate asyncapi.json @asyncapi/html-template@3.5.4 --param singleFile=true -o public --force-write\n  bun run patch-docs",
				{
					status: 503,
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				},
			);
		}
	}

	// Hook endpoint — body size is enforced by Bun's maxRequestBodySize at server level
	if (req.method === "POST" && url.pathname === "/hook") {
		// Per-IP rate limit on hook endpoint
		const hookIp = server.requestIP?.(req)?.address ?? "unknown";
		if (!deps.hookRateLimiter.allow(hookIp)) {
			return new Response(JSON.stringify({ error: "rate_limited" }), {
				status: 429,
				headers: { "Content-Type": "application/json" },
			});
		}

		// Token auth on POST /hook
		if (deps.authToken !== null) {
			const authHeader = req.headers.get("authorization");
			const bearerToken = authHeader?.startsWith("Bearer ")
				? authHeader.slice(7)
				: null;
			if (!bearerToken || !constantTimeEquals(bearerToken, deps.authToken)) {
				return new Response(JSON.stringify({ error: "unauthorized" }), {
					status: 401,
					headers: { "Content-Type": "application/json" },
				});
			}
		}

		let body: unknown;
		try {
			body = await req.json();
		} catch {
			return new Response(JSON.stringify({ error: "invalid JSON" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		const result = processHookEvent(body);
		if (!result.ok) {
			return new Response(JSON.stringify({ error: "invalid hook payload" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		// Process asynchronously so response is returned immediately
		queueMicrotask(() => {
			for (const event of result.events) {
				try {
					deps.sessionWatcher.handleExternalEvent(event);
					deps.broadcast(
						envelope(event.type, event.sessionId, event.data, event.agentId),
					);
				} catch (err) {
					logger.error("error processing hook event", {
						error: String(err),
						eventType: event.type,
					});
				}
			}
		});

		return new Response(JSON.stringify({ status: "accepted" }), {
			status: 202,
			headers: { "Content-Type": "application/json" },
		});
	}

	// --- Token auth on WebSocket upgrade ---
	// Note: token is in query param because WebSocket API doesn't support custom headers.
	// Do NOT log req.url or url.search — it contains the token.
	if (deps.authToken !== null) {
		const tokenParam = url.searchParams.get("token");
		if (!tokenParam || !constantTimeEquals(tokenParam, deps.authToken)) {
			return new Response(JSON.stringify({ error: "unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}
	}

	// --- Origin validation (CSWSH protection) ---
	const origin = req.headers.get("origin");
	if (!isAllowedOrigin(origin)) {
		logger.warn("rejected WebSocket upgrade: disallowed origin", { origin });
		return new Response("Forbidden origin", { status: 403 });
	}

	// Reject new connections when at capacity
	if (deps.clientCount() >= deps.maxConnections) {
		logger.warn("connection limit reached, rejecting upgrade", {
			limit: deps.maxConnections,
		});
		return new Response("Too many connections", { status: 503 });
	}

	// --- Per-IP connection limit ---
	const clientIp = server.requestIP?.(req)?.address ?? "unknown";
	if (!deps.ipTracker.acquire(clientIp)) {
		logger.warn("per-IP connection limit reached", { ip: clientIp });
		return new Response("Too many connections from this IP", { status: 429 });
	}

	// WebSocket upgrade
	const now = Date.now();
	const upgraded = server.upgrade(req, {
		data: {
			subscriptions: new Set(),
			sessionFilter: null,
			globPatterns: new Set(),
			rawLogSessions: new Set(),
			lastPingAt: null,
			pongTimer: null,
			lastReplayAt: null,
			activeHistoryRequests: 0,
			messageCount: 0,
			messageWindowStart: now,
			rateLimitViolations: 0,
			lastActivityAt: now,
			remoteAddress: clientIp,
		},
	});
	if (!upgraded) {
		// Release the IP slot since upgrade failed
		deps.ipTracker.release(clientIp);
		return new Response("WebSocket upgrade failed", { status: 400 });
	}
	return undefined;
}
