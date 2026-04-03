import type { ServerWebSocket } from "bun";
import { logger } from "./logger.ts";
import { ClientMessageSchema, type Snapshot } from "./schemas/index.ts";
import type { SessionDiscovery } from "./session-discovery.ts";
import { readSessionHistory } from "./session-history.ts";
import type { SessionWatcher } from "./session-watcher.ts";
import { topicMatches } from "./topic-matcher.ts";
import type { UsageTracker } from "./usage-tracker.ts";
import type { ClientData, ReplayBuffer } from "./ws-utils.ts";
import { sendReplay } from "./ws-utils.ts";

const MAX_CONCURRENT_HISTORY = 2;
const REPLAY_RATE_LIMIT_MS = 1_000;
const MAX_RAW_LOG_SUBSCRIPTIONS = 50;

/** Max messages per rate-limit window before throttling */
const MSG_RATE_LIMIT = 100;
/** Rate-limit window duration (ms) */
const MSG_RATE_WINDOW_MS = 10_000;
/** Close connection after this many consecutive rate-limit violations */
const MSG_RATE_MAX_VIOLATIONS = 3;

/** Maximum total topic subscriptions per client */
const MAX_TOTAL_SUBSCRIPTIONS = 200;

export interface MessageHandlerDeps {
	safeSend: (ws: ServerWebSocket<ClientData>, msg: string) => void;
	sendSnapshot: (ws: ServerWebSocket<ClientData>) => void;
	replayBuffer: ReplayBuffer;
	knownEventTypes: Set<string>;
	discovery: SessionDiscovery;
	sessionWatcher: SessionWatcher;
	usageTracker: UsageTracker;
	onPatternSubscribe: (
		ws: ServerWebSocket<ClientData>,
		pattern: string,
	) => void;
	onPatternUnsubscribe: (
		ws: ServerWebSocket<ClientData>,
		pattern: string,
	) => void;
}

export function handleMessage(
	ws: ServerWebSocket<ClientData>,
	message: string | Buffer,
	deps: MessageHandlerDeps,
): void {
	const {
		safeSend,
		sendSnapshot,
		replayBuffer,
		knownEventTypes,
		discovery,
		sessionWatcher,
		usageTracker,
		onPatternSubscribe,
		onPatternUnsubscribe,
	} = deps;

	// Update activity timestamp for idle-timeout tracking
	const now = Date.now();
	ws.data.lastActivityAt = now;

	// --- Global per-client message rate limit ---
	if (now - ws.data.messageWindowStart >= MSG_RATE_WINDOW_MS) {
		// New window — reset counters
		ws.data.messageCount = 0;
		ws.data.messageWindowStart = now;
		ws.data.rateLimitViolations = 0;
	}
	ws.data.messageCount++;
	if (ws.data.messageCount > MSG_RATE_LIMIT) {
		ws.data.rateLimitViolations++;
		if (ws.data.rateLimitViolations >= MSG_RATE_MAX_VIOLATIONS) {
			ws.close(1008, "message rate limit exceeded");
			return;
		}
		safeSend(
			ws,
			JSON.stringify({
				error: "rate_limited",
				message: `max ${MSG_RATE_LIMIT} messages per ${MSG_RATE_WINDOW_MS / 1000}s`,
			}),
		);
		return;
	}

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
		logger.debug("invalid client message", { issues: result.error.issues });
		safeSend(
			ws,
			JSON.stringify({
				error: "invalid message",
			}),
		);
		return;
	}

	const msg = result.data;

	switch (msg.type) {
		case "subscribe": {
			// Check total subscription cap (counting only genuinely new topics)
			const newTopics = msg.topics.filter((t) => !ws.data.subscriptions.has(t));
			if (
				ws.data.subscriptions.size + newTopics.length >
				MAX_TOTAL_SUBSCRIPTIONS
			) {
				safeSend(
					ws,
					JSON.stringify({
						error: "limit_exceeded",
						message: `max ${MAX_TOTAL_SUBSCRIPTIONS} total subscriptions per client`,
					}),
				);
				break;
			}
			for (const topic of msg.topics) {
				ws.data.subscriptions.add(topic);
				onPatternSubscribe(ws, topic);
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
				onPatternUnsubscribe(ws, topic);
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
			if (ws.data.activeHistoryRequests >= MAX_CONCURRENT_HISTORY) {
				safeSend(
					ws,
					JSON.stringify({
						error: "rate_limited",
						message: `max ${MAX_CONCURRENT_HISTORY} concurrent get_session_history requests`,
					}),
				);
				break;
			}
			const { sessionId, limit = 1000 } = msg;
			ws.data.activeHistoryRequests++;
			readSessionHistory(sessionId, limit, sessionWatcher, discovery)
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
				})
				.finally(() => {
					ws.data.activeHistoryRequests--;
				});
			break;
		}

		case "subscribe_agent_log": {
			if (ws.data.rawLogSessions.size >= MAX_RAW_LOG_SUBSCRIPTIONS) {
				safeSend(
					ws,
					JSON.stringify({
						error: "limit_exceeded",
						message: `max ${MAX_RAW_LOG_SUBSCRIPTIONS} agent log subscriptions per client`,
					}),
				);
				break;
			}
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

		case "unsubscribe_agent_log": {
			if (msg.sessionId !== undefined) {
				ws.data.rawLogSessions.delete(msg.sessionId);
			} else {
				ws.data.rawLogSessions.clear();
			}
			safeSend(
				ws,
				JSON.stringify({
					type: "unsubscribed_agent_log",
					sessionId: msg.sessionId ?? null,
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
			const now = Date.now();
			const lastReplayAt = ws.data.lastReplayAt;
			if (lastReplayAt !== null && now - lastReplayAt < REPLAY_RATE_LIMIT_MS) {
				safeSend(
					ws,
					JSON.stringify({
						error: "rate_limited",
						message: "replay is limited to 1 request per second",
					}),
				);
				break;
			}
			ws.data.lastReplayAt = now;
			sendReplay(ws, msg.lastSeq, replayBuffer, safeSend);
			break;
		}
	}
}

export function makeSnapshotSender(
	discovery: SessionDiscovery,
	sessionWatcher: SessionWatcher,
	safeSend: (ws: ServerWebSocket<ClientData>, msg: string) => void,
) {
	return function sendSnapshot(ws: ServerWebSocket<ClientData>): void {
		const snapshot: Snapshot = {
			type: "snapshot",
			sessions: discovery.getSessions(),
			agents: sessionWatcher.getAgents(),
		};
		safeSend(ws, JSON.stringify(snapshot));
	};
}
