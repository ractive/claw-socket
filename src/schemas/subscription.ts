import { z } from "zod";

/** Client → server: subscribe to topics */
export const SubscribeMessageSchema = z.object({
	type: z.literal("subscribe"),
	topics: z.array(z.string()).min(1),
	sessionId: z.string().optional(),
});

export type SubscribeMessage = z.infer<typeof SubscribeMessageSchema>;

/** Client → server: unsubscribe from topics */
export const UnsubscribeMessageSchema = z.object({
	type: z.literal("unsubscribe"),
	topics: z.array(z.string()).min(1),
});

export type UnsubscribeMessage = z.infer<typeof UnsubscribeMessageSchema>;

/** Client → server: request snapshot */
export const GetSnapshotMessageSchema = z.object({
	type: z.literal("get_snapshot"),
});

export type GetSnapshotMessage = z.infer<typeof GetSnapshotMessageSchema>;

/** Client → server: request list of all known sessions */
export const GetSessionListMessageSchema = z.object({
	type: z.literal("get_session_list"),
});

export type GetSessionListMessage = z.infer<typeof GetSessionListMessageSchema>;

/** Client → server: request parsed event history for a session */
export const GetSessionHistoryMessageSchema = z.object({
	type: z.literal("get_session_history"),
	sessionId: z.string(),
	limit: z.number().int().positive().optional(),
});

export type GetSessionHistoryMessage = z.infer<
	typeof GetSessionHistoryMessageSchema
>;

/** Client → server: subscribe to raw JSONL lines for a session */
export const SubscribeAgentLogMessageSchema = z.object({
	type: z.literal("subscribe_agent_log"),
	sessionId: z.string(),
});

export type SubscribeAgentLogMessage = z.infer<
	typeof SubscribeAgentLogMessageSchema
>;

/** Union of all client → server messages */
export const ClientMessageSchema = z.discriminatedUnion("type", [
	SubscribeMessageSchema,
	UnsubscribeMessageSchema,
	GetSnapshotMessageSchema,
	GetSessionListMessageSchema,
	GetSessionHistoryMessageSchema,
	SubscribeAgentLogMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
