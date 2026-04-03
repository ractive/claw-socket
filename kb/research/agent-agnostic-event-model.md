---
title: "Agent-Agnostic Event Model: Claude Code + OpenCode"
date: 2026-04-02
description: >-
  Feasibility analysis for supporting multiple coding agents (Claude Code,
  OpenCode) with a unified event model
status: complete
tags:
  - research
  - architecture
  - opencode
  - claude-code
  - events
type: research
---

# Agent-Agnostic Event Model: Claude Code + OpenCode

## Executive Summary

Supporting both Claude Code and OpenCode is **feasible**. The core event categories (session lifecycle, messages, tool execution, permissions) overlap ~70%. The main challenges are transport inversion (Claude Code pushes via HTTP hooks; OpenCode streams via SSE) and differing granularity in tool/agent events. A source adapter pattern with a normalized common event taxonomy would work.

## OpenCode Overview

OpenCode is a Go/TypeScript coding agent with:
- **Dual event system**: Bus events (real-time pub/sub) + Sync events (event sourcing with replay)
- **Transport**: Server-Sent Events (SSE) over HTTP at `GET /event` (default port 4096)
- **Schema validation**: Zod (same as claw-socket)
- **Plugin system**: Server/TUI/Theme plugins with hook triggers
- **No WebSocket**: Uses SSE for server→client streaming

Source: `/Users/james/devel/opencode/`

## Event Comparison

### Session Lifecycle

| Concept | Claude Code | OpenCode | Mappable? |
|---------|------------|----------|-----------|
| Session created | `SessionStart` hook | `session.created` bus event | Yes |
| Session ended | `SessionEnd` hook | N/A (inferred from status) | Partial |
| Session status | `session.state_changed` (JSONL) | `session.status` (idle/busy/retry) | Yes |
| Session compacted | `PreCompact`/`PostCompact` hooks | `session.compacted` sync event | Yes |

### Messages

| Concept | Claude Code | OpenCode | Mappable? |
|---------|------------|----------|-----------|
| User message | `message.user` (JSONL) | `message.updated` (role=user) | Yes |
| Assistant message | `message.assistant` (JSONL) | `message.updated` (role=assistant) | Yes |
| Streaming delta | Not via hooks (JSONL `stream_event`) | `message.part.delta` (native SSE) | Yes (both have it) |
| Result/cost | `message.result` (JSONL) | Embedded in session metadata | Partial |

### Tool Execution

| Concept | Claude Code | OpenCode | Mappable? |
|---------|------------|----------|-----------|
| Tool starting | `PreToolUse` hook + `tool.started` (JSONL) | `command.executed` (single event) | Partial |
| Tool completed | `PostToolUse` hook + `tool.completed` (JSONL) | Inferred from next event | Partial |
| Tool failed | `PostToolUseFailure` hook + `tool.failed` (JSONL) | No distinct event | Claude Code only |
| Tool input/output | Rich: `tool_input`, `tool_response` | `command.executed` has args | Partial |

**Key gap**: Claude Code has pre/post tool hooks with input+output. OpenCode has a single `command.executed` event. Unified model must handle the superset (some fields empty for OpenCode).

### Agent/Subagent

| Concept | Claude Code | OpenCode | Mappable? |
|---------|------------|----------|-----------|
| Subagent spawned | `SubagentStart` hook | No equivalent | Claude Code only |
| Subagent stopped | `SubagentStop` hook | No equivalent | Claude Code only |
| Teammate idle | `TeammateIdle` hook | No equivalent | Claude Code only |

OpenCode has no multi-agent/subagent model. These events would be source-specific.

### Permissions

| Concept | Claude Code | OpenCode | Mappable? |
|---------|------------|----------|-----------|
| Permission requested | `PermissionRequest` hook | `permission.asked` bus event | Yes |
| Permission response | `PermissionDenied` hook | `permission.replied` bus event | Yes |

### File Changes

| Concept | Claude Code | OpenCode | Mappable? |
|---------|------------|----------|-----------|
| File modified | `FileChanged` hook | `file.edited` bus event | Yes |
| CWD changed | `CwdChanged` hook | `project.vcs.branch.updated` | Partial |

### OpenCode-Only Events

These have no Claude Code equivalent:
- `pty.created`/`pty.updated`/`pty.exited` — terminal process management
- `lsp.updated` — language server events
- `ide.installed` — IDE integration
- `tui.*` — TUI-specific UI events
- `question.asked`/`question.replied` — interactive questions (similar to elicitation?)

### Claude Code-Only Events

These have no OpenCode equivalent:
- `agent.*` (subagents, teammates)
- `task.*` (task creation/completion)
- `hook.*` lifecycle (hook_started, hook_progress, hook_completed)
- `mcp.elicitation`/`mcp.elicitation_result`
- `worktree.*`

## Transport Differences

```
Claude Code architecture (push):
  Claude Code ──HTTP POST──→ claw-socket /hook endpoint
  Claude Code ──JSONL files──→ claw-socket file watcher

OpenCode architecture (pull):
  claw-socket ──SSE client──→ OpenCode GET /event (port 4096)
```

**This is the biggest architectural change.** Currently claw-socket only *receives* — it needs to also *poll/subscribe*. The OpenCode adapter would be an SSE client that connects to OpenCode's event stream and translates events into the common model.

## Proposed Unified Model

### Envelope (extends current)

```typescript
interface EventEnvelope {
  type: string              // normalized event type
  timestamp: number         // ms since epoch
  sessionId: string
  source: "claude-code" | "opencode" | string  // NEW
  agentId?: string
  data: Record<string, unknown>
  raw?: Record<string, unknown>  // original event, opt-in
}
```

### Common Event Taxonomy

Core events that both sources map to:

```
session.started          — session initialized
session.ended            — session terminated
session.status_changed   — idle/busy state change
session.compacted        — context compacted

message.user             — user input
message.assistant        — assistant output
message.delta            — streaming text chunk
message.result           — completion with cost/usage

tool.started             — tool execution began
tool.completed           — tool execution succeeded
tool.failed              — tool execution failed

permission.requested     — user prompted for permission
permission.responded     — user granted/denied

file.changed             — file modified/created/deleted
```

Source-specific events pass through with their native type prefixed by source:

```
claude-code:hook.teammate_idle
claude-code:agent.started
opencode:pty.created
opencode:lsp.updated
```

Or alternatively, use the existing namespace but document which sources emit which events.

### Source Adapter Interface

```typescript
interface SourceAdapter {
  readonly source: string  // "claude-code" | "opencode"

  /** Start receiving events from the coding agent */
  start(): Promise<void>

  /** Stop and clean up */
  stop(): Promise<void>

  /** Subscribe to normalized events */
  onEvent(handler: (event: EventEnvelope) => void): void

  /** Get current sessions (for snapshot) */
  getSessions(): SessionInfo[]
}
```

Two implementations:
- `ClaudeCodeAdapter` — HTTP POST receiver + JSONL watcher (existing code, extracted)
- `OpenCodeAdapter` — SSE client connecting to OpenCode's `/event` endpoint

## Feasibility Assessment

### What works well
- **~70% event overlap** on core categories (session, message, tool, permission, file)
- **Same validation approach** — both use Zod schemas
- **Envelope is already generic** — adding `source` field is non-breaking
- **Topic subscriptions already support glob** — `tool.*` works regardless of source

### Challenges

| Challenge | Severity | Mitigation |
|-----------|----------|------------|
| Transport inversion (push vs pull) | Medium | New SSE client module for OpenCode adapter |
| Tool event granularity mismatch | Medium | Superset model; empty fields when source doesn't provide |
| Agent hierarchy (Claude Code only) | Low | Source-specific events, documented as such |
| Streaming delta format differences | Low | Normalize to common `message.delta` shape |
| Session discovery differences | Medium | Each adapter discovers its own way; common `SessionInfo` output |
| OpenCode API stability | Unknown | OpenCode is newer; API may change more frequently |

### Effort Estimate

| Component | Effort |
|-----------|--------|
| Add `source` to envelope + schemas | Small — one field |
| Extract `ClaudeCodeAdapter` from existing code | Medium — refactor, not rewrite |
| Build `OpenCodeAdapter` (SSE client) | Medium — new module |
| Event normalization mapping | Medium — mapping table + tests |
| Update topic matcher for source filtering | Small — `source:claude-code:tool.*` pattern |
| Update snapshot/state management | Medium — multi-source session tracking |

### Recommendation

1. **Add `source` field now** (iteration 4) — backwards-compatible, zero risk
2. **Extract adapter interface** (iteration 4-5) — refactor existing code into `ClaudeCodeAdapter`
3. **Build OpenCode adapter** (new iteration) — SSE client + event mapping
4. **Don't merge event namespaces yet** — keep `hook.*` and source-specific events separate until we have real client feedback on what abstraction level is useful

## Open Questions

- Should clients be able to filter by source? (e.g., `subscribe({ source: "opencode", topics: ["tool.*"] })`)
- Should we normalize Claude Code's PascalCase hook types into the common taxonomy, or keep them as `hook.*` pass-through?
- OpenCode's `session.status` has `retry` state — do we surface this or map it to `busy`?
- How do we handle session IDs that might collide across sources? (prefix with source?)
