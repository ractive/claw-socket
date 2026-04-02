import { z } from "zod";

/** Standard envelope wrapping every server → client event */
export const EventEnvelopeSchema = z.object({
	type: z.string(),
	timestamp: z.number(),
	sessionId: z.string(),
	agentId: z.string().optional(),
	data: z.record(z.unknown()),
	/** Monotonically increasing sequence number assigned by the server */
	seq: z.number().int().nonnegative().optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export function envelope(
	type: string,
	sessionId: string,
	data: Record<string, unknown>,
	agentId?: string,
): EventEnvelope {
	const env: EventEnvelope = { type, timestamp: Date.now(), sessionId, data };
	if (agentId) env.agentId = agentId;
	return env;
}
