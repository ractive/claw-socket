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

export interface HttpHandlerDeps {
	discovery: SessionDiscovery;
	sessionWatcher: SessionWatcher;
	broadcast: (event: EventEnvelope) => void;
	/** Returns the current number of connected WebSocket clients */
	clientCount: () => number;
	/** Maximum allowed simultaneous connections */
	maxConnections: number;
}

export async function handleHttpRequest(
	req: Request,
	server: {
		upgrade(req: Request, options: { data: ClientData }): boolean;
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

	// AsyncAPI docs UI — served from pre-generated static file
	if (url.pathname === "/docs") {
		try {
			if (docsHtmlCache === null) {
				docsHtmlCache = await Bun.file("public/index.html").text();
			}
			return new Response(docsHtmlCache, {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		} catch {
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

		return new Response(
			JSON.stringify({ status: "ok", eventsEmitted: result.events.length }),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	}

	// Reject new connections when at capacity
	if (deps.clientCount() >= deps.maxConnections) {
		logger.warn("connection limit reached, rejecting upgrade", {
			limit: deps.maxConnections,
		});
		return new Response("Too many connections", { status: 503 });
	}

	// WebSocket upgrade
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
		},
	});
	if (!upgraded) {
		return new Response("WebSocket upgrade failed", { status: 400 });
	}
	return undefined;
}
