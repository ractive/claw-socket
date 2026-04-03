---
title: "Iteration 09: Code Organization & Module Splitting"
description: Split oversized modules, deduplicate code, clean up dead code and types
tags:
  - iteration
  - refactor
  - architecture
status: complete
iteration: 9
type: iteration
---

# Iteration 09: Code Organization & Module Splitting

## Goal
Decompose oversized modules into focused, digestible files. Eliminate code duplication and dead code. Improve type safety and naming consistency.

## Tasks

### Split server.ts (747 lines → target <300)
- [x] Extract HTTP routes to `src/http-handler.ts` (health, hook, asyncapi.json, docs)
- [x] Extract WS message handler to `src/message-handler.ts` (the `switch (msg.type)` block)
- [x] Extract `readSessionHistory` to `src/session-history.ts`
- [x] Extract `safeSend`, backpressure, replay buffer to `src/ws-utils.ts`
- [x] Verify server.ts is now a thin orchestrator wiring modules together

### Deduplicate code
- [x] Create `src/utils.ts` with shared `truncate()` (duplicated in jsonl-parser.ts:15 and hook-handler.ts:9)
- [x] Add `isRecord()` type guard to utils (replaces 23× `as Record<string, unknown>` casts; reuse `isPlainObject` from hook-installer.ts)
- [x] Make `agent-tracker.ts` import `AgentState`/`AgentStatus`/`ToolHistoryEntry` from `schemas/agent.ts` instead of redeclaring them
- [x] Extract tool field extraction helper in `agent-tracker.ts` (3 hook cases share ~90 lines of near-identical logic)

### Clean up dead code
- [x] Remove unused `setEventCallback()` from `usage-tracker.ts:53`
- [x] Remove empty `if` block at `usage-tracker.ts:218`
- [x] Make `processContentBlockDelta` private in `jsonl-parser.ts:301`
- [x] Audit and unexport internal-only types (`ParsedEventHandler`, `SessionEventHandler`, `JsonlLineHandler`, `UsageEventCallback`)

### Naming and structure
- [x] Rename `schemas/message.ts` → `schemas/events.ts` (it contains session + tool event schemas, not just messages)
- [x] Parameterize `homedir()` paths in `session-discovery.ts` and `hook-installer.ts` for testability
- [x] Remove redundant `as Record<string, unknown>` casts in `usage-tracker.ts:158-169` where `d` is already typed

### Tests
- [x] All existing 267 tests still pass after refactor
- [x] No new public API changes — only internal restructuring
