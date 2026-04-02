import { z } from "zod";

/** Raw session file from ~/.claude/sessions/{pid}.json */
export const SessionFileSchema = z.object({
  pid: z.number(),
  sessionId: z.string(),
  cwd: z.string(),
  startedAt: z.number(),
});

export type SessionFile = z.infer<typeof SessionFileSchema>;

/** Tracked session with enriched state */
export const SessionInfoSchema = z.object({
  pid: z.number(),
  sessionId: z.string(),
  cwd: z.string(),
  startedAt: z.number(),
  discoveredAt: z.number(),
});

export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/** session.discovered event data */
export const SessionDiscoveredSchema = z.object({
  pid: z.number(),
  sessionId: z.string(),
  cwd: z.string(),
  startedAt: z.number(),
});

export type SessionDiscovered = z.infer<typeof SessionDiscoveredSchema>;

/** session.removed event data */
export const SessionRemovedSchema = z.object({
  sessionId: z.string(),
  reason: z.enum(["process_exited", "file_removed", "manual"]),
});

export type SessionRemoved = z.infer<typeof SessionRemovedSchema>;

/** Snapshot sent on client connect */
export const SnapshotSchema = z.object({
  type: z.literal("snapshot"),
  sessions: z.array(SessionInfoSchema),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;
