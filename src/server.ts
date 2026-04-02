import type { ServerWebSocket } from "bun";
import { generateAsyncApiSpec } from "./asyncapi-generator.ts";
import { processHookEvent } from "./hook-handler.ts";
import { JsonlParser, type ParsedEvent } from "./jsonl-parser.ts";
import { logger } from "./logger.ts";
import { envelope } from "./schemas/envelope.ts";
import {
	ClientMessageSchema,
	type EventEnvelope,
	type SessionInfo,
	type Snapshot,
} from "./schemas/index.ts";
import { SessionDiscovery, type SessionEvent } from "./session-discovery.ts";
import { deriveJsonlPath, SessionWatcher } from "./session-watcher.ts";
import { matchesAny, topicMatches } from "./topic-matcher.ts";
import { UsageTracker } from "./usage-tracker.ts";

/** Maximum JSONL file size to read for session history (10 MB) */
const MAX_HISTORY_FILE_BYTES = 10 * 1_048_576;

/** Backpressure drop threshold in bytes (1 MB). Close threshold is 4x this. */
const DEFAULT_BACKPRESSURE_DROP_BYTES = 1_048_576;

/** Heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** How long to wait for a pong after a ping before closing (ms) */
const PONG_TIMEOUT_MS = 10_000;

/** Default replay buffer size (number of events) */
const DEFAULT_REPLAY_BUFFER_SIZE = 1000;

/** Grace period for graceful shutdown (ms) */
const SHUTDOWN_GRACE_MS = 3_000;

interface ClientData {
	subscriptions: Set<string>;
	sessionFilter: string | null;
	/** Glob patterns stored for matching new event types discovered at runtime */
	globPatterns: Set<string>;
	/** Sessions the client wants to receive raw JSONL lines for */
	rawLogSessions: Set<string>;
	/** Last ping time (ms), used for pong tracking */
	lastPingAt: number | null;
	/** Timer handle for pong timeout */
	pongTimer: ReturnType<typeof setTimeout> | null;
}

export interface ServerOptions {
	port?: number;
	hostname?: string;
	/** Buffer bytes above which a message is dropped for a slow client (default 1 MB) */
	backpressureLimit?: number;
	/** Max number of events to keep in replay buffer (default 1000) */
	replayBufferSize?: number;
}

export function createServer(options: ServerOptions = {}) {
	const port = options.port ?? 3838;
	const hostname = options.hostname ?? "localhost";
	const backpressureDropLimit =
		options.backpressureLimit ?? DEFAULT_BACKPRESSURE_DROP_BYTES;
	const backpressureCloseLimit = backpressureDropLimit * 4;
	const replayBufferSize =
		options.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE;

	const clients = new Set<ServerWebSocket<ClientData>>();

	// -----------------------------------------------------------------------
	// Sequence numbers and replay buffer
	// -----------------------------------------------------------------------

	let nextSeq = 0;

	interface BufferedEvent {
		seq: number;
		event: EventEnvelope & { seq: number };
	}

	const replayBuffer: BufferedEvent[] = [];

	function assignSeq(ev: EventEnvelope): EventEnvelope & { seq: number } {
		const seq = nextSeq++;
		const stamped = { ...ev, seq };
		replayBuffer.push({ seq, event: stamped });
		if (replayBuffer.length > replayBufferSize) {
			replayBuffer.shift();
		}
		return stamped;
	}

	// -----------------------------------------------------------------------
	// All event types that have ever been seen
	// -----------------------------------------------------------------------

	const knownEventTypes = new Set<string>();

	const usageTracker = new UsageTracker((type, sessionId, data) => {
		broadcast(envelope(type, sessionId, data));
	});

	// -----------------------------------------------------------------------
	// Backpressure-aware send
	// -----------------------------------------------------------------------

	function safeSend(ws: ServerWebSocket<ClientData>, msg: string): void {
		const buffered = ws.getBufferedAmount();
		if (buffered >= backpressureCloseLimit) {
			logger.warn("closing slow client due to backpressure", { buffered });
			ws.close(1008, "backpressure limit exceeded");
			return;
		}
		if (buffered >= backpressureDropLimit) {
			logger.warn("dropping message for slow client", { buffered });
			return;
		}
		ws.send(msg);
	}

	// -----------------------------------------------------------------------
	// Pub/sub helpers
	// -----------------------------------------------------------------------

	function registerEventType(eventType: string): void {
		if (knownEventTypes.has(eventType)) return;
		knownEventTypes.add(eventType);

		for (const ws of clients) {
			for (const pattern of ws.data.globPatterns) {
				if (topicMatches(eventType, pattern)) {
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
			try {
				usageTracker.handleEvent(event);
				broadcast(
					envelope(event.type, event.sessionId, event.data, event.agentId),
				);
			} catch (err) {
				logger.error("error in session watcher event handler", {
					error: String(err),
					eventType: event.type,
				});
				broadcastSystemError("session_watcher", String(err), true);
			}
		},
		onAgentStateChange(agents) {
			try {
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
			} catch (err) {
				logger.error("error in agent state change handler", {
					error: String(err),
				});
			}
		},
		onRawLine(sessionId, line) {
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

	function broadcastSystemError(
		source: string,
		message: string,
		recoverable: boolean,
	): void {
		const ev = envelope("system.error", "", { source, message, recoverable });
		const stamped = assignSeq(ev);
		const msg = JSON.stringify(stamped);
		for (const ws of clients) {
			safeSend(ws, msg);
		}
	}

	function broadcast(event: EventEnvelope): void {
		registerEventType(event.type);

		const stamped = assignSeq(event);
		const msg = JSON.stringify(stamped);

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
	// Replay
	// -----------------------------------------------------------------------

	function sendReplay(ws: ServerWebSocket<ClientData>, lastSeq: number): void {
		const toReplay = replayBuffer.filter((b) => b.seq > lastSeq);
		for (const { event } of toReplay) {
			// Only send events that match the client's subscriptions
			const data = ws.data;
			if (data.subscriptions.size === 0) continue;
			if (!matchesAny(event.type, data.subscriptions)) continue;
			if (data.sessionFilter && event.sessionId !== data.sessionFilter)
				continue;
			safeSend(ws, JSON.stringify(event));
		}
	}

	// -----------------------------------------------------------------------
	// get_session_history helper
	// -----------------------------------------------------------------------

	async function readSessionHistory(
		sessionId: string,
		limit: number,
	): Promise<ParsedEvent[]> {
		let jsonlPath = sessionWatcher.getJsonlPath(sessionId);

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

		const file = Bun.file(jsonlPath);
		let text: string;
		try {
			const size = file.size;
			if (size > MAX_HISTORY_FILE_BYTES) {
				return [];
			}
			text = await file.text();
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
	// Heartbeat
	// -----------------------------------------------------------------------

	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	function startHeartbeat(): void {
		heartbeatTimer = setInterval(() => {
			for (const ws of clients) {
				if (ws.readyState !== 1 /* OPEN */) continue;
				ws.data.lastPingAt = Date.now();
				ws.ping();
				// Schedule pong timeout
				ws.data.pongTimer = setTimeout(() => {
					logger.warn("client did not respond to ping, closing");
					ws.close(1001, "ping timeout");
				}, PONG_TIMEOUT_MS);
			}
		}, HEARTBEAT_INTERVAL_MS);
	}

	function stopHeartbeat(): void {
		if (heartbeatTimer !== null) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
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

			// AsyncAPI spec
			if (url.pathname === "/asyncapi.json") {
				return new Response(JSON.stringify(generateAsyncApiSpec(), null, 2), {
					headers: { "Content-Type": "application/json" },
				});
			}

			// AsyncAPI docs UI
			if (url.pathname === "/docs") {
				const html = `<!DOCTYPE html>
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
				return new Response(html, {
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
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
					try {
						sessionWatcher.handleExternalEvent(event);
						broadcast(
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
		},

		websocket: {
			open(ws) {
				clients.add(ws);
				sendSnapshot(ws);
				logger.debug("client connected", { total: clients.size });
			},

			close(ws) {
				if (ws.data.pongTimer !== null) {
					clearTimeout(ws.data.pongTimer);
				}
				clients.delete(ws);
				logger.debug("client disconnected", { total: clients.size });
			},

			pong(ws) {
				// Clear the pong timeout when pong is received
				if (ws.data.pongTimer !== null) {
					clearTimeout(ws.data.pongTimer);
					ws.data.pongTimer = null;
				}
				ws.data.lastPingAt = null;
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
							if (topic.includes("*")) {
								ws.data.globPatterns.add(topic);
								for (const knownType of knownEventTypes) {
									if (topicMatches(knownType, topic)) {
										ws.subscribe(knownType);
										if (msg.sessionId) {
											ws.subscribe(`${msg.sessionId}/${knownType}`);
										}
									}
								}
							} else {
								ws.subscribe(topic);
								if (msg.sessionId) {
									ws.subscribe(`${msg.sessionId}/${topic}`);
								}
							}
						}
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
						readSessionHistory(sessionId, limit)
							.then((events) => {
								safeSend(
									ws,
									JSON.stringify({
										type: "session_history",
										sessionId,
										events,
									}),
								);
							})
							.catch(() => {
								safeSend(
									ws,
									JSON.stringify({
										type: "session_history",
										sessionId,
										events: [],
									}),
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

					case "get_usage": {
						if (msg.sessionId) {
							const sessionUsage = usageTracker.getSessionUsage(msg.sessionId);
							const modelBreakdown: Record<
								string,
								{ inputTokens: number; outputTokens: number; costUsd: number }
							> = {};
							if (sessionUsage) {
								for (const [model, usage] of sessionUsage.modelBreakdown) {
									modelBreakdown[model] = { ...usage };
								}
							}
							safeSend(
								ws,
								JSON.stringify({
									type: "usage",
									sessionId: msg.sessionId,
									...(sessionUsage
										? {
												inputTokens: sessionUsage.inputTokens,
												outputTokens: sessionUsage.outputTokens,
												cacheCreationInputTokens:
													sessionUsage.cacheCreationInputTokens,
												cacheReadInputTokens: sessionUsage.cacheReadInputTokens,
												totalCostUsd: sessionUsage.totalCostUsd,
												durationMs: sessionUsage.durationMs,
												durationApiMs: sessionUsage.durationApiMs,
												numTurns: sessionUsage.numTurns,
												modelBreakdown,
												lastUpdatedAt: sessionUsage.lastUpdatedAt,
											}
										: {
												inputTokens: 0,
												outputTokens: 0,
												cacheCreationInputTokens: 0,
												cacheReadInputTokens: 0,
												totalCostUsd: 0,
												durationMs: 0,
												durationApiMs: 0,
												numTurns: 0,
												modelBreakdown: {},
												lastUpdatedAt: null,
											}),
								}),
							);
						} else {
							const global = usageTracker.getGlobalUsage();
							safeSend(
								ws,
								JSON.stringify({
									type: "usage",
									...global,
								}),
							);
						}
						break;
					}

					case "replay": {
						sendReplay(ws, msg.lastSeq);
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
			startHeartbeat();
			logger.info("claw-socket listening", {
				url: `ws://${hostname}:${server.port}`,
			});
		},

		async stop(): Promise<void> {
			stopHeartbeat();

			// Close all connected clients with "going away"
			for (const ws of clients) {
				try {
					ws.close(1001, "server going away");
				} catch {
					// already closed
				}
			}

			// Grace period for in-flight operations
			await new Promise<void>((resolve) =>
				setTimeout(resolve, SHUTDOWN_GRACE_MS),
			);

			sessionWatcher.stop();
			discovery.stop();
			server.stop(true);
		},
	};
}
