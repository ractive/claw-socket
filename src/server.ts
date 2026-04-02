import type { ServerWebSocket } from "bun";
import { processHookEvent } from "./hook-handler.ts";
import { JsonlParser, type ParsedEvent } from "./jsonl-parser.ts";
import { envelope } from "./schemas/envelope.ts";
import {
	ClientMessageSchema,
	type EventEnvelope,
	type SessionInfo,
	type Snapshot,
} from "./schemas/index.ts";
import { SessionDiscovery, type SessionEvent } from "./session-discovery.ts";
import { deriveJsonlPath, SessionWatcher } from "./session-watcher.ts";
import { matchesAny } from "./topic-matcher.ts";

/** Backpressure drop threshold in bytes (1 MB). Close threshold is 4x this. */
const DEFAULT_BACKPRESSURE_DROP_BYTES = 1_048_576;

interface ClientData {
	subscriptions: Set<string>;
	sessionFilter: string | null;
	/** Glob patterns stored for matching new event types discovered at runtime */
	globPatterns: Set<string>;
	/** Sessions the client wants to receive raw JSONL lines for */
	rawLogSessions: Set<string>;
}

export interface ServerOptions {
	port?: number;
	hostname?: string;
	/** Buffer bytes above which a message is dropped for a slow client (default 1 MB) */
	backpressureLimit?: number;
}

export function createServer(options: ServerOptions = {}) {
	const port = options.port ?? 3838;
	const hostname = options.hostname ?? "localhost";
	const backpressureDropLimit =
		options.backpressureLimit ?? DEFAULT_BACKPRESSURE_DROP_BYTES;
	const backpressureCloseLimit = backpressureDropLimit * 4;

	const clients = new Set<ServerWebSocket<ClientData>>();

	/**
	 * All event types that have ever been seen. Used to subscribe glob-pattern
	 * clients to newly discovered topics automatically.
	 */
	const knownEventTypes = new Set<string>();

	// -----------------------------------------------------------------------
	// Backpressure-aware send
	// -----------------------------------------------------------------------

	function safeSend(ws: ServerWebSocket<ClientData>, msg: string): void {
		const buffered = ws.getBufferedAmount();
		if (buffered >= backpressureCloseLimit) {
			console.warn(`[backpressure] closing slow client (buffered=${buffered})`);
			ws.close(1008, "backpressure limit exceeded");
			return;
		}
		if (buffered >= backpressureDropLimit) {
			console.warn(
				`[backpressure] dropping message for slow client (buffered=${buffered})`,
			);
			return;
		}
		ws.send(msg);
	}

	// -----------------------------------------------------------------------
	// Pub/sub helpers
	// -----------------------------------------------------------------------

	/**
	 * Register a new event type. For any connected client whose glob patterns
	 * match the new type, subscribe them to the Bun pub/sub topic.
	 */
	function registerEventType(eventType: string): void {
		if (knownEventTypes.has(eventType)) return;
		knownEventTypes.add(eventType);

		// For each client, check if any of their glob patterns match this new type
		for (const ws of clients) {
			for (const pattern of ws.data.globPatterns) {
				// Only subscribe if it's actually a glob (contains * or ?)
				if (
					matchesAny(eventType, new Set([pattern])) &&
					(pattern.includes("*") || pattern.includes("?"))
				) {
					// Subscribe to both unfiltered and session-filtered topics
					ws.subscribe(eventType);
					if (ws.data.sessionFilter) {
						ws.subscribe(`${ws.data.sessionFilter}/${eventType}`);
					}
					break;
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Session watcher
	// -----------------------------------------------------------------------

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
		onRawLine(sessionId, line) {
			// Forward raw JSONL lines to clients subscribed via subscribe_agent_log
			const msg = JSON.stringify({
				type: "agent_log",
				sessionId,
				line,
			});
			for (const ws of clients) {
				if (ws.data.rawLogSessions.has(sessionId)) {
					safeSend(ws, msg);
				}
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

	// -----------------------------------------------------------------------
	// Broadcast
	// -----------------------------------------------------------------------

	function broadcast(event: EventEnvelope): void {
		registerEventType(event.type);

		const msg = JSON.stringify(event);

		for (const ws of clients) {
			const data = ws.data;
			if (data.subscriptions.size === 0) continue;
			if (!matchesAny(event.type, data.subscriptions)) continue;
			if (data.sessionFilter && event.sessionId !== data.sessionFilter)
				continue;
			safeSend(ws, msg);
		}
	}

	// -----------------------------------------------------------------------
	// Snapshot
	// -----------------------------------------------------------------------

	function sendSnapshot(ws: ServerWebSocket<ClientData>): void {
		const snapshot: Snapshot = {
			type: "snapshot",
			sessions: discovery.getSessions(),
			agents: sessionWatcher.getAgents(),
		};
		safeSend(ws, JSON.stringify(snapshot));
	}

	// -----------------------------------------------------------------------
	// get_session_history helper
	// -----------------------------------------------------------------------

	async function readSessionHistory(
		sessionId: string,
		limit: number,
	): Promise<ParsedEvent[]> {
		// Try to get the path from the watcher (session is currently active)
		let jsonlPath = sessionWatcher.getJsonlPath(sessionId);

		// Fall back: look up from discovery (session may still be in discovery map)
		if (!jsonlPath) {
			const sessions = discovery.getSessions();
			const found = sessions.find(
				(s: SessionInfo) => s.sessionId === sessionId,
			);
			if (found) {
				jsonlPath = deriveJsonlPath(sessionId, found.cwd);
			}
		}

		if (!jsonlPath) {
			return [];
		}

		let text: string;
		try {
			text = await Bun.file(jsonlPath).text();
		} catch {
			return [];
		}

		const events: ParsedEvent[] = [];
		const parser = new JsonlParser(sessionId, (event) => {
			events.push(event);
		});

		for (const rawLine of text.split("\n")) {
			const trimmed = rawLine.trim();
			if (!trimmed) continue;
			try {
				const parsed: unknown = JSON.parse(trimmed);
				if (
					typeof parsed === "object" &&
					parsed !== null &&
					!Array.isArray(parsed)
				) {
					parser.processLine(parsed as Record<string, unknown>);
				}
			} catch {
				// Skip malformed lines
			}
		}

		return limit > 0 ? events.slice(-limit) : events;
	}

	// -----------------------------------------------------------------------
	// Bun server
	// -----------------------------------------------------------------------

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
				const maxBytes = 1_048_576;
				let text: string;
				try {
					text = await req.text();
				} catch {
					return new Response(JSON.stringify({ error: "invalid JSON" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}
				if (text.length > maxBytes) {
					return new Response(JSON.stringify({ error: "payload too large" }), {
						status: 413,
						headers: { "Content-Type": "application/json" },
					});
				}

				let body: unknown;
				try {
					body = JSON.parse(text);
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
				data: {
					subscriptions: new Set(),
					sessionFilter: null,
					globPatterns: new Set(),
					rawLogSessions: new Set(),
				},
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
					safeSend(ws, JSON.stringify({ error: "invalid JSON" }));
					return;
				}

				const result = ClientMessageSchema.safeParse(parsed);
				if (!result.success) {
					safeSend(
						ws,
						JSON.stringify({
							error: "invalid message",
							details: result.error.issues,
						}),
					);
					return;
				}

				const msg = result.data;

				switch (msg.type) {
					case "subscribe": {
						for (const topic of msg.topics) {
							ws.data.subscriptions.add(topic);
							// Track glob patterns separately for late-binding to new event types
							if (topic.includes("*") || topic.includes("?")) {
								ws.data.globPatterns.add(topic);
								// Subscribe to all already-known event types matching this glob
								for (const knownType of knownEventTypes) {
									if (matchesAny(knownType, new Set([topic]))) {
										ws.subscribe(knownType);
										if (msg.sessionId) {
											ws.subscribe(`${msg.sessionId}/${knownType}`);
										}
									}
								}
							} else {
								// Exact topic — subscribe directly to Bun pub/sub
								ws.subscribe(topic);
								if (msg.sessionId) {
									ws.subscribe(`${msg.sessionId}/${topic}`);
								}
							}
						}
						// Set or clear session filter
						ws.data.sessionFilter = msg.sessionId ?? null;
						safeSend(
							ws,
							JSON.stringify({
								type: "subscribed",
								topics: Array.from(ws.data.subscriptions),
							}),
						);
						break;
					}

					case "unsubscribe": {
						for (const topic of msg.topics) {
							ws.data.subscriptions.delete(topic);
							ws.data.globPatterns.delete(topic);
							ws.unsubscribe(topic);
							// Unsubscribe from any session-prefixed variants
							if (ws.data.sessionFilter) {
								ws.unsubscribe(`${ws.data.sessionFilter}/${topic}`);
							}
						}
						safeSend(
							ws,
							JSON.stringify({
								type: "unsubscribed",
								topics: Array.from(ws.data.subscriptions),
							}),
						);
						break;
					}

					case "get_snapshot":
						sendSnapshot(ws);
						break;

					case "get_session_list": {
						const sessions = discovery.getSessions();
						safeSend(ws, JSON.stringify({ type: "session_list", sessions }));
						break;
					}

					case "get_session_history": {
						const { sessionId, limit = 1000 } = msg;
						readSessionHistory(sessionId, limit).then((events) => {
							safeSend(
								ws,
								JSON.stringify({ type: "session_history", sessionId, events }),
							);
						});
						break;
					}

					case "subscribe_agent_log": {
						ws.data.rawLogSessions.add(msg.sessionId);
						safeSend(
							ws,
							JSON.stringify({
								type: "subscribed_agent_log",
								sessionId: msg.sessionId,
							}),
						);
						break;
					}
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
