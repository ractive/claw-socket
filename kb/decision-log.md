---
title: Decision Log
description: Architecture and design decisions for claw-socket
tags:
  - decisions
date: 2026-04-02
type: decisions
status: active
---

# Decision Log

## D001: Use Bun native WebSocket (not Socket.IO)

**Date**: 2026-04-02
**Status**: Proposed

**Context**: Need a WebSocket server runtime. Options: Bun native, Socket.IO (via bun engine), Elysia.

**Decision**: Use Bun's built-in `Bun.serve()` WebSocket with native pub/sub.

**Rationale**:
- Zero dependencies, best performance
- Built-in topic-based pub/sub maps perfectly to our event subscription model
- TypeScript types via `ServerWebSocket<T>`
- No framework overhead

**Tradeoffs**: Manual message routing vs framework conveniences.

---

## D002: Use AsyncAPI 3.0 for documentation

**Date**: 2026-04-02
**Status**: Accepted

**Context**: Need Swagger-like docs for WebSocket API.

**Decision**: Generate AsyncAPI 3.0 spec from Zod schemas at runtime; generate docs with the official `@asyncapi/cli` toolchain.

**Rationale**:
- Industry standard for event-driven APIs
- JSON Schema-based payload validation aligns with Zod
- `@asyncapi/html-template` (singleFile) produces polished, self-contained HTML served at `/docs`
- `@asyncapi/markdown-template` produces `kb/docs/api-reference.md` for editor/LLM use

**How docs are generated** (run manually when spec changes):
```bash
bun run export-spec   # writes asyncapi.json from the live generator
asyncapi generate fromTemplate asyncapi.json @asyncapi/html-template@3.5.4 --param singleFile=true -o public --force-write
asyncapi generate fromTemplate asyncapi.json @asyncapi/markdown-template@2.0.0 --param outFilename=api-reference.md -o kb/docs --force-write
```

**Note**: `scripts/export-spec.ts` strips `payload` from `messageTraits` before writing because `@asyncapi/specs` 3.0 schema has `additionalProperties: false` on traits and rejects it. Each message already carries the full payload schema directly.

**Note**: `scripts/patch-docs.ts` (step 4, `bun run patch-docs`) fixes a layout bug in `@asyncapi/html-template` where the inner fixed sidebar overflows its `w-64` container by ~66px. Run after step 2.

---

## D003: Zod schemas as single source of truth

**Date**: 2026-04-02
**Status**: Proposed

**Context**: Need type safety for WS messages + validation + docs generation.

**Decision**: Define all events with Zod schemas. Generate AsyncAPI spec from them.

**Rationale**:
- Define once → types + runtime validation + docs
- Similar to what zod-sockets does, but for raw Bun WebSocket
- Zod is the standard for TypeScript validation

---

## D004: Session discovery via file watching + hooks

**Date**: 2026-04-02
**Status**: Proposed

**Context**: Need to detect active Claude Code sessions.

**Decision**: Use both mechanisms:
1. Watch `~/.claude/sessions/` for session metadata files
2. Accept HTTP hooks from Claude Code for real-time events

**Rationale**: File watching catches sessions; hooks provide richer real-time events. Same approach as busy-agents, proven to work.

---

## D005: Topic-based subscription model

**Date**: 2026-04-02
**Status**: Proposed

**Context**: Clients need different levels of detail (dashboard vs deep inspection).

**Decision**: Glob-style topic patterns (e.g. `session.*`, `tool.started`).

**Rationale**:
- Maps naturally to Bun's pub/sub topics
- Clients subscribe only to what they need
- Reduces bandwidth for lightweight consumers

---

## D006: Single-port hook endpoint (not separate HTTP server)

**Date**: 2026-04-02
**Status**: Accepted

**Context**: Need to accept HTTP hook callbacks from Claude Code. busy-agents uses two ports: HTTP (7890) for hooks + static files, WS (7891) for real-time. We need to decide whether to follow that pattern or combine them.

**Decision**: Add `POST /hook` to the existing `Bun.serve()` `fetch` handler alongside `/health` and the WebSocket upgrade — single port for everything.

**Rationale**:
- Bun's `fetch` handler already routes both HTTP and WS on the same port
- Simpler deployment: one port to configure, one URL for hooks
- No coordination needed between two servers
- Hook installer only needs to know one port

**Tradeoffs**: If we later add static file serving (like busy-agents' game UI), we may want a separate HTTP server for serving assets with caching headers. That can be split out then.

---

## D007: Hook events use `hook.*` namespace, not merged into `tool.*`

**Date**: 2026-04-02
**Status**: Accepted

**Context**: Claude Code hooks (PreToolUse, PostToolUse) overlap with JSONL-sourced tool events (tool.started, tool.completed). Should we merge them into a single event stream or keep them separate?

**Decision**: Emit hooks as `hook.<snake_case_type>` (e.g. `hook.pre_tool_use`) and let JSONL events continue as `tool.*`. Both feed into the agent tracker for state updates. Clients choose granularity via topic subscriptions.

**Rationale**:
- Hooks arrive before JSONL writes (lower latency) and carry different data (e.g. `tool_response` in PostToolUse)
- Keeping them separate avoids deduplication complexity and lets clients subscribe to exactly what they want
- Agent tracker handles both sources, so state is always consistent
- `hook.*` and `tool.*` are independently useful: hooks for real-time UI, JSONL for post-hoc analysis
