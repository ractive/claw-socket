import { z } from "zod";

// ── Hook event types from Claude Code ───────────────────────────────

/** All known Claude Code hook event types */
export const HookEventTypeSchema = z.enum([
	// Tool lifecycle
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
	// Session lifecycle
	"SessionStart",
	"SessionEnd",
	"Stop",
	// Agent lifecycle
	"SubagentStart",
	"SubagentStop",
	"TeammateIdle",
	// Permissions
	"PermissionRequest",
	"PermissionDenied",
	// Tasks
	"TaskCreated",
	"TaskCompleted",
	// Notifications
	"Notification",
	"UserPromptSubmit",
	// Compaction
	"PreCompact",
	"PostCompact",
	// Elicitation
	"Elicitation",
	"ElicitationResult",
	// Environment
	"ConfigChange",
	"InstructionsLoaded",
	"CwdChanged",
	"FileChanged",
	// Worktrees
	"WorktreeCreate",
	"WorktreeRemove",
]);

export type HookEventType = z.infer<typeof HookEventTypeSchema>;

// ── Inbound hook payload ────────────────────────────────────────────

/** The JSON body Claude Code POSTs to our /hook endpoint */
export const HookPayloadSchema = z.object({
	sessionId: z.string(),
	type: HookEventTypeSchema,
	agentId: z.string().optional(),
	data: z.record(z.unknown()).default({}),
});

export type HookPayload = z.infer<typeof HookPayloadSchema>;
