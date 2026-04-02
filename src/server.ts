import type { ServerWebSocket } from "bun";
import { handleHttpRequest } from "./http-handler.ts";
import { logger } from "./logger.ts";
import { handleMessage, makeSnapshotSender } from "./message-handler.ts";
import { envelope } from "./schemas/envelope.ts";
import type { EventEnvelope } from "./schemas/index.ts";
import { SessionDiscovery, type SessionEvent } from "./session-discovery.ts";
import { SessionWatcher } from "./session-watcher.ts";
import { matchesAny, topicMatches } from "./topic-matcher.ts";
import { UsageTracker } from "./usage-tracker.ts";
import {
	type ClientData,
	DEFAULT_BACKPRESSURE_DROP_BYTES,
	DEFAULT_REPLAY_BUFFER_SIZE,
	makeReplayBuffer,
	makeSafeSend,
	type ReplayBuffer,
} from "./ws-utils.ts";

/** Heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** How long to wait for a pong after a ping before closing (ms) */
const PONG_TIMEOUT_MS = 10_000;

/** Grace period for graceful shutdown (ms) */
const SHUTDOWN_GRACE_MS = 3_000;

export interface ServerOptions {
	port?: number;
	hostname?: string;
	/** Buffer bytes above which a message is dropped for a slow client (default 1 MB) */
	backpressureLimit?: number;
	/** Max number of events to keep in replay buffer (default 1000) */
	replayBufferSize?: number;
	/** Maximum number of simultaneous WebSocket connections (default 100) */
	maxConnections?: number;
}

export function createServer(options: ServerOptions = {}) {
	const port = options.port ?? 3838;
	const hostname = options.hostname ?? "localhost";
	const backpressureDropLimit =
		options.backpressureLimit ?? DEFAULT_BACKPRESSURE_DROP_BYTES;
	const backpressureCloseLimit = backpressureDropLimit * 4;
	const replayBufferSize =
		options.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE;
	const maxConnections = options.maxConnections ?? 100;

	const clients = new Set<ServerWebSocket<ClientData>>();

	// -----------------------------------------------------------------------
	// Replay buffer and backpressure
	// -----------------------------------------------------------------------

	const replayBuffer: ReplayBuffer = makeReplayBuffer(replayBufferSize);
	const { assignSeq } = replayBuffer;
	const safeSend = makeSafeSend(backpressureDropLimit, backpressureCloseLimit);

	// -----------------------------------------------------------------------
	// All event types that have ever been seen
	// -----------------------------------------------------------------------

	const knownEventTypes = new Set<string>();

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
	// Broadcast
	// -----------------------------------------------------------------------

	function broadcastSystemError(
		source: string,
		message: string,
		recoverable: boolean,
	): void {
		// Log full detail server-side only; broadcast a generic message to clients.
		logger.error("system error", { source, detail: message, recoverable });
		const genericMessage = recoverable
			? "An internal error occurred; the server is continuing."
			: "A fatal internal error occurred.";
		const ev = envelope("system.error", "", {
			source,
			message: genericMessage,
			recoverable,
		});
		const { json } = assignSeq(ev);
		for (const ws of clients) {
			safeSend(ws, json);
		}
	}

	function broadcast(event: EventEnvelope): void {
		registerEventType(event.type);

		const { json } = assignSeq(event);

		for (const ws of clients) {
			const data = ws.data;
			if (data.subscriptions.size === 0) continue;
			if (!matchesAny(event.type, data.subscriptions)) continue;
			if (data.sessionFilter && event.sessionId !== data.sessionFilter)
				continue;
			safeSend(ws, json);
		}
	}

	// -----------------------------------------------------------------------
	// Core components
	// -----------------------------------------------------------------------

	const usageTracker = new UsageTracker((type, sessionId, data) => {
		broadcast(envelope(type, sessionId, data));
	});

	const sessionWatcher = new SessionWatcher({
		onEvent(event) {
			try {
				usageTracker.handleEvent(event);
				broadcast(
					envelope(event.type, event.sessionId, event.data, event.agentId),
				);
			} catch (err) {
				broadcastSystemError("session_watcher", String(err), true);
			}
		},
		onAgentStateChange(sessionId, agents) {
			try {
				broadcast(envelope("agent.state_changed", sessionId, { agents }));
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
	// Snapshot sender
	// -----------------------------------------------------------------------

	const sendSnapshot = makeSnapshotSender(discovery, sessionWatcher, safeSend);

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
		maxRequestBodySize: 1_048_576, // 1 MB — enforced at the Bun level before buffering
		async fetch(req, server) {
			return handleHttpRequest(req, server, {
				discovery,
				sessionWatcher,
				broadcast,
				clientCount: () => clients.size,
				maxConnections,
			});
		},

		websocket: {
			maxPayloadLength: 65536, // 64 KB — client messages are small commands

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
				if (ws.data.pongTimer !== null) {
					clearTimeout(ws.data.pongTimer);
					ws.data.pongTimer = null;
				}
				ws.data.lastPingAt = null;
			},

			message(ws, message) {
				handleMessage(ws, message, {
					safeSend,
					sendSnapshot,
					replayBuffer,
					knownEventTypes,
					discovery,
					sessionWatcher,
					usageTracker,
				});
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

			for (const ws of clients) {
				try {
					ws.close(1001, "server going away");
				} catch {
					// already closed
				}
			}

			if (clients.size > 0) {
				await new Promise<void>((resolve) =>
					setTimeout(resolve, SHUTDOWN_GRACE_MS),
				);
			}

			sessionWatcher.stop();
			discovery.stop();
			server.stop(true);
		},
	};
}
