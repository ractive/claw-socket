import type { ServerWebSocket } from "bun";
import { logger } from "./logger.ts";
import type { EventEnvelope } from "./schemas/index.ts";
import { matchesAny } from "./topic-matcher.ts";

/** Backpressure drop threshold in bytes (1 MB). Close threshold is 4x this. */
export const DEFAULT_BACKPRESSURE_DROP_BYTES = 1_048_576;

/** Default replay buffer size (number of events) */
export const DEFAULT_REPLAY_BUFFER_SIZE = 1000;

export interface ClientData {
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

export interface BufferedEvent {
	seq: number;
	event: EventEnvelope & { seq: number };
}

export function makeSafeSend(
	backpressureDropLimit: number,
	backpressureCloseLimit: number,
) {
	return function safeSend(ws: ServerWebSocket<ClientData>, msg: string): void {
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
	};
}

export function makeReplayBuffer(maxSize: number) {
	const buffer: BufferedEvent[] = [];
	let nextSeq = 0;

	function assignSeq(ev: EventEnvelope): EventEnvelope & { seq: number } {
		const seq = nextSeq++;
		const stamped = { ...ev, seq };
		buffer.push({ seq, event: stamped });
		if (buffer.length > maxSize) {
			buffer.shift();
		}
		return stamped;
	}

	function getBuffer(): readonly BufferedEvent[] {
		return buffer;
	}

	return { assignSeq, getBuffer };
}

export function sendReplay(
	ws: ServerWebSocket<ClientData>,
	lastSeq: number,
	buffer: readonly BufferedEvent[],
	safeSend: (ws: ServerWebSocket<ClientData>, msg: string) => void,
): void {
	const toReplay = buffer.filter((b) => b.seq > lastSeq);
	for (const { event } of toReplay) {
		const data = ws.data;
		if (data.subscriptions.size === 0) continue;
		if (!matchesAny(event.type, data.subscriptions)) continue;
		if (data.sessionFilter && event.sessionId !== data.sessionFilter) continue;
		safeSend(ws, JSON.stringify(event));
	}
}
