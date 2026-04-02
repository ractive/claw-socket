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

const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>claw-socket API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/@asyncapi/react-component@latest/styles/default.min.css">
</head>
<body>
  <div id="asyncapi"></div>
  <script src="https://unpkg.com/@asyncapi/react-component@latest/browser/standalone/index.js"></script>
  <script>
    AsyncApiComponent.render({
      schema: { url: '/asyncapi.json' },
      config: { show: { sidebar: true } }
    }, document.getElementById('asyncapi'));
  </script>
</body>
</html>`;

export interface HttpHandlerDeps {
	discovery: SessionDiscovery;
	sessionWatcher: SessionWatcher;
	broadcast: (event: EventEnvelope) => void;
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

	// AsyncAPI docs UI
	if (url.pathname === "/docs") {
		return new Response(DOCS_HTML, {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
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

	// WebSocket upgrade
	const upgraded = server.upgrade(req, {
		data: {
			subscriptions: new Set(),
			sessionFilter: null,
			globPatterns: new Set(),
			rawLogSessions: new Set(),
			lastPingAt: null,
			pongTimer: null,
		},
	});
	if (!upgraded) {
		return new Response("WebSocket upgrade failed", { status: 400 });
	}
	return undefined;
}
