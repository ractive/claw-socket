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

/** Union of all client → server messages */
export const ClientMessageSchema = z.discriminatedUnion("type", [
	SubscribeMessageSchema,
	UnsubscribeMessageSchema,
	GetSnapshotMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
