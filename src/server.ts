import type { ServerWebSocket } from "bun";
import { processHookEvent } from "./hook-handler.ts";
import { envelope } from "./schemas/envelope.ts";
import {
	ClientMessageSchema,
	type EventEnvelope,
	type Snapshot,
} from "./schemas/index.ts";
import { SessionDiscovery, type SessionEvent } from "./session-discovery.ts";
import { SessionWatcher } from "./session-watcher.ts";
import { matchesAny } from "./topic-matcher.ts";

interface ClientData {
	subscriptions: Set<string>;
	sessionFilter: string | null;
}

export interface ServerOptions {
	port?: number;
	hostname?: string;
}

export function createServer(options: ServerOptions = {}) {
	const port = options.port ?? 3838;
	const hostname = options.hostname ?? "localhost";

	const clients = new Set<ServerWebSocket<ClientData>>();

	const sessionWatcher = new SessionWatcher({
		onEvent(event) {
			broadcast(
				envelope(event.type, event.sessionId, event.data, event.agentId),
			);
		},
		onAgentStateChange(agents) {
			const bySession = new Map<string, typeof agents>();
			for (const a of agents) {
				const list = bySession.get(a.sessionId) ?? [];
				list.push(a);
				bySession.set(a.sessionId, list);
			}
			for (const [sid, sessionAgents] of bySession) {
				broadcast(
					envelope("agent.state_changed", sid, { agents: sessionAgents }),
				);
			}
		},
	});

	const discovery = new SessionDiscovery((event: SessionEvent) => {
		if (event.type === "session.discovered") {
			sessionWatcher.watchSession(event.session.sessionId, event.session.cwd);
			const ev = envelope("session.discovered", event.session.sessionId, {
				pid: event.session.pid,
				sessionId: event.session.sessionId,
				cwd: event.session.cwd,
				startedAt: event.session.startedAt,
			});
			broadcast(ev);
		} else {
			sessionWatcher.unwatchSession(event.sessionId);
			const ev = envelope("session.removed", event.sessionId, {
				sessionId: event.sessionId,
				reason: event.reason,
			});
			broadcast(ev);
		}
	});

	function broadcast(event: EventEnvelope): void {
		const msg = JSON.stringify(event);
		for (const ws of clients) {
			const data = ws.data;
			// Check subscription match
			if (data.subscriptions.size === 0) continue;
			if (!matchesAny(event.type, data.subscriptions)) continue;
			// Check session filter
			if (data.sessionFilter && event.sessionId !== data.sessionFilter)
				continue;
			ws.send(msg);
		}
	}

	function sendSnapshot(ws: ServerWebSocket<ClientData>): void {
		const snapshot: Snapshot = {
			type: "snapshot",
			sessions: discovery.getSessions(),
			agents: sessionWatcher.getAgents(),
		};
		ws.send(JSON.stringify(snapshot));
	}

	const server = Bun.serve<ClientData>({
		port,
		hostname,
		async fetch(req, server) {
			const url = new URL(req.url);

			// Health check
			if (url.pathname === "/health") {
				return new Response(
					JSON.stringify({
						status: "ok",
						sessions: discovery.getSessions().length,
					}),
					{
						headers: { "Content-Type": "application/json" },
					},
				);
			}

			// Hook endpoint
			if (req.method === "POST" && url.pathname === "/hook") {
				const contentLength = Number(req.headers.get("content-length") ?? 0);
				if (contentLength > 1_048_576) {
					return new Response(JSON.stringify({ error: "payload too large" }), {
						status: 413,
						headers: { "Content-Type": "application/json" },
					});
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
					return new Response(
						JSON.stringify({ error: "invalid hook payload" }),
						{ status: 400, headers: { "Content-Type": "application/json" } },
					);
				}

				for (const event of result.events) {
					// Feed agent-tracker-compatible events through sessionWatcher
					sessionWatcher.handleExternalEvent(event);
					broadcast(
						envelope(event.type, event.sessionId, event.data, event.agentId),
					);
				}

				return new Response(
					JSON.stringify({ status: "ok", eventsEmitted: result.events.length }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}

			// WebSocket upgrade
			const upgraded = server.upgrade(req, {
				data: { subscriptions: new Set(), sessionFilter: null },
			});
			if (!upgraded) {
				return new Response("WebSocket upgrade failed", { status: 400 });
			}
			return undefined;
		},

		websocket: {
			open(ws) {
				clients.add(ws);
				sendSnapshot(ws);
			},

			close(ws) {
				clients.delete(ws);
			},

			message(ws, message) {
				const text = typeof message === "string" ? message : message.toString();
				let parsed: unknown;
				try {
					parsed = JSON.parse(text);
				} catch {
					ws.send(JSON.stringify({ error: "invalid JSON" }));
					return;
				}

				const result = ClientMessageSchema.safeParse(parsed);
				if (!result.success) {
					ws.send(
						JSON.stringify({
							error: "invalid message",
							details: result.error.issues,
						}),
					);
					return;
				}

				const msg = result.data;

				switch (msg.type) {
					case "subscribe":
						for (const topic of msg.topics) {
							ws.data.subscriptions.add(topic);
						}
						// Set or clear session filter
						ws.data.sessionFilter = msg.sessionId ?? null;
						ws.send(
							JSON.stringify({
								type: "subscribed",
								topics: Array.from(ws.data.subscriptions),
							}),
						);
						break;

					case "unsubscribe":
						for (const topic of msg.topics) {
							ws.data.subscriptions.delete(topic);
						}
						ws.send(
							JSON.stringify({
								type: "unsubscribed",
								topics: Array.from(ws.data.subscriptions),
							}),
						);
						break;

					case "get_snapshot":
						sendSnapshot(ws);
						break;
				}
			},
		},
	});

	return {
		server,
		discovery,
		broadcast,

		async start() {
			await discovery.start();
			console.log(`claw-socket listening on ws://${hostname}:${port}`);
		},

		stop() {
			sessionWatcher.stop();
			discovery.stop();
			server.stop();
		},
	};
}
