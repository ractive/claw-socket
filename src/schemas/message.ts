import { z } from "zod";

// ── Content blocks for assistant messages ────────────────────────────

export const TextBlockSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
});

export type TextBlock = z.infer<typeof TextBlockSchema>;

export const ToolUseBlockSchema = z.object({
	type: z.literal("tool_use"),
	id: z.string(),
	name: z.string(),
	input: z.record(z.unknown()),
});

export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;

export const ThinkingBlockSchema = z.object({
	type: z.literal("thinking"),
	thinking: z.string(),
});

export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>;

export const ContentBlockSchema = z.discriminatedUnion("type", [
	TextBlockSchema,
	ToolUseBlockSchema,
	ThinkingBlockSchema,
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// ── Message events ───────────────────────────────────────────────────

/** User message event data */
export const MessageUserEventSchema = z.object({
	text: z.string(),
	uuid: z.string(),
	isSynthetic: z.boolean().optional(),
});

export type MessageUserEvent = z.infer<typeof MessageUserEventSchema>;

/** Assistant message event data */
export const MessageAssistantEventSchema = z.object({
	contentBlocks: z.array(ContentBlockSchema),
	uuid: z.string(),
	model: z.string().optional(),
});

export type MessageAssistantEvent = z.infer<typeof MessageAssistantEventSchema>;

/** Token usage breakdown */
export const UsageSchema = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	cacheReadTokens: z.number().optional(),
	cacheCreationTokens: z.number().optional(),
});

export type Usage = z.infer<typeof UsageSchema>;

/** Message result subtypes */
export const MessageResultSubtypeSchema = z.enum([
	"success",
	"error_during_execution",
	"error_max_turns",
	"error_max_budget_usd",
]);

export type MessageResultSubtype = z.infer<typeof MessageResultSubtypeSchema>;

/** Message result event data */
export const MessageResultEventSchema = z.object({
	subtype: MessageResultSubtypeSchema,
	durationMs: z.number().optional(),
	durationApiMs: z.number().optional(),
	numTurns: z.number().optional(),
	totalCostUsd: z.number().optional(),
	usage: UsageSchema.optional(),
});

export type MessageResultEvent = z.infer<typeof MessageResultEventSchema>;

// ── Tool events ──────────────────────────────────────────────────────

/** Tool execution started */
export const ToolStartedEventSchema = z.object({
	toolName: z.string(),
	toolUseId: z.string(),
	inputSummary: z.string(),
});

export type ToolStartedEvent = z.infer<typeof ToolStartedEventSchema>;

/** Tool execution completed successfully */
export const ToolCompletedEventSchema = z.object({
	toolName: z.string(),
	toolUseId: z.string(),
	durationMs: z.number(),
	outputSummary: z.string(),
});

export type ToolCompletedEvent = z.infer<typeof ToolCompletedEventSchema>;

/** Tool execution failed */
export const ToolFailedEventSchema = z.object({
	toolName: z.string(),
	toolUseId: z.string(),
	error: z.string(),
	isInterrupt: z.boolean().optional(),
});

export type ToolFailedEvent = z.infer<typeof ToolFailedEventSchema>;

// ── Session init / state events ──────────────────────────────────────

/** Emitted when a session starts */
export const SessionStartedEventSchema = z.object({
	version: z.string().optional(),
	model: z.string().optional(),
	permissionMode: z.string().optional(),
	tools: z.array(z.string()).optional(),
	agents: z.array(z.string()).optional(),
	mcpServers: z.array(z.string()).optional(),
	cwd: z.string().optional(),
});

export type SessionStartedEvent = z.infer<typeof SessionStartedEventSchema>;

/** Session state transitions */
export const SessionStateSchema = z.enum([
	"idle",
	"running",
	"requires_action",
]);

export type SessionState = z.infer<typeof SessionStateSchema>;

/** Emitted when session state changes */
export const SessionStateChangedEventSchema = z.object({
	state: SessionStateSchema,
});

export type SessionStateChangedEvent = z.infer<
	typeof SessionStateChangedEventSchema
>;
