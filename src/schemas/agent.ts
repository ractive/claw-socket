import { z } from "zod";

// ── Tool history ─────────────────────────────────────────────────────

/** Single entry in an agent's tool execution history */
export const ToolHistoryEntrySchema = z.object({
	toolName: z.string(),
	inputSummary: z.string(),
	durationMs: z.number(),
	success: z.boolean(),
	startedAt: z.number(),
});

export type ToolHistoryEntry = z.infer<typeof ToolHistoryEntrySchema>;

// ── Agent state ──────────────────────────────────────────────────────

/** Agent status values */
export const AgentStatusSchema = z.enum([
	"working",
	"tool_running",
	"idle",
	"offline",
]);

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** Full state of a single agent */
export const AgentStateSchema = z.object({
	agentId: z.string(),
	agentType: z.string(),
	sessionId: z.string(),
	status: AgentStatusSchema,
	currentTool: z.string().optional(),
	currentToolInput: z.string().optional(),
	startedAt: z.number(),
	lastActivityAt: z.number(),
	toolCount: z.number(),
	tokenCount: z.number(),
	cwd: z.string(),
	name: z.string().optional(),
	toolHistory: z.array(ToolHistoryEntrySchema),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// ── Agent lifecycle events ───────────────────────────────────────────

/** Emitted when an agent starts */
export const AgentStartedEventSchema = z.object({
	agentId: z.string(),
	agentType: z.string(),
	cwd: z.string().optional(),
	parentToolUseId: z.string().optional(),
});

export type AgentStartedEvent = z.infer<typeof AgentStartedEventSchema>;

/** Emitted when an agent stops */
export const AgentStoppedEventSchema = z.object({
	agentId: z.string(),
	reason: z.string().optional(),
});

export type AgentStoppedEvent = z.infer<typeof AgentStoppedEventSchema>;
