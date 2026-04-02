import type { ServerWebSocket } from "bun";
import { ClientMessageSchema, type Snapshot } from "./schemas/index.ts";
import type { SessionDiscovery } from "./session-discovery.ts";
import { readSessionHistory } from "./session-history.ts";
import type { SessionWatcher } from "./session-watcher.ts";
import { topicMatches } from "./topic-matcher.ts";
import type { UsageTracker } from "./usage-tracker.ts";
import type { BufferedEvent, ClientData } from "./ws-utils.ts";
import { sendReplay } from "./ws-utils.ts";

export interface MessageHandlerDeps {
	safeSend: (ws: ServerWebSocket<ClientData>, msg: string) => void;
	sendSnapshot: (ws: ServerWebSocket<ClientData>) => void;
	replayBuffer: readonly BufferedEvent[];
	knownEventTypes: Set<string>;
	discovery: SessionDiscovery;
	sessionWatcher: SessionWatcher;
	usageTracker: UsageTracker;
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
	} = deps;

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
