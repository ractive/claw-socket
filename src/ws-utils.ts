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
	/** Pre-serialized JSON string, cached to avoid re-serialization during replay */
	json: string;
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
	// Ring buffer: fixed-size array with head/tail indices for O(1) push/eviction
	const effectiveSize = Math.max(1, maxSize);
	const ring = new Array<BufferedEvent | undefined>(effectiveSize);
	let head = 0; // index of the oldest entry (next slot to overwrite)
	let count = 0; // number of valid entries currently stored
	let nextSeq = 0;

	function assignSeq(ev: EventEnvelope): {
		stamped: EventEnvelope & { seq: number };
		json: string;
	} {
		const seq = nextSeq++;
		const stamped = { ...ev, seq };
		const json = JSON.stringify(stamped);
		const tail = (head + count) % effectiveSize;
		ring[tail] = { seq, event: stamped, json };
		if (count < effectiveSize) {
			count++;
		} else {
			// Buffer full: advance head to evict oldest entry
			head = (head + 1) % effectiveSize;
		}
		return { stamped, json };
	}

	/**
	 * Iterate buffered events with seq > lastSeq.
	 * Seqs are monotonic so we binary-search for the start index.
	 */
	function forEachSince(
		lastSeq: number,
		cb: (entry: BufferedEvent) => void,
	): void {
		if (count === 0) return;

		// Binary search for the first entry with seq > lastSeq
		let lo = 0;
		let hi = count - 1;
		let startOffset = count; // default: nothing to replay

		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			const entry = ring[(head + mid) % effectiveSize] as BufferedEvent;
			if (entry.seq <= lastSeq) {
				lo = mid + 1;
			} else {
				startOffset = mid;
				hi = mid - 1;
			}
		}

		for (let i = startOffset; i < count; i++) {
			cb(ring[(head + i) % effectiveSize] as BufferedEvent);
		}
	}

	return { assignSeq, forEachSince };
}

export type ReplayBuffer = ReturnType<typeof makeReplayBuffer>;

export function sendReplay(
	ws: ServerWebSocket<ClientData>,
	lastSeq: number,
	replayBuffer: ReplayBuffer,
	safeSend: (ws: ServerWebSocket<ClientData>, msg: string) => void,
): void {
	const data = ws.data;
	replayBuffer.forEachSince(lastSeq, (entry) => {
		const { event, json } = entry;
		if (data.subscriptions.size === 0) return;
		if (!matchesAny(event.type, data.subscriptions)) return;
		if (data.sessionFilter && event.sessionId !== data.sessionFilter) return;
		safeSend(ws, json);
	});
}
