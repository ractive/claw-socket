import { z } from "zod";

/** Standard envelope wrapping every server → client event */
export const EventEnvelopeSchema = z.object({
  type: z.string(),
  timestamp: z.number(),
  sessionId: z.string(),
  agentId: z.string().optional(),
  data: z.record(z.unknown()),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export function envelope(
  type: string,
  sessionId: string,
  data: Record<string, unknown>,
  agentId?: string,
): EventEnvelope {
  return {
    type,
    timestamp: Date.now(),
    sessionId,
    data,
    ...(agentId ? { agentId } : {}),
  };
}
