---
title: "Iteration 10: Performance Optimization"
description: Fix hot-path allocations, ring buffer, caching, and memory bounds
tags:
  - iteration
  - performance
  - optimization
status: complete
iteration: 10
type: iteration
---

# Iteration 10: Performance Optimization

## Goal
Eliminate unnecessary allocations in hot paths, add bounded data structures, and cache static computations. Focus on the broadcast and event-processing paths that fire hundreds of times per second during streaming.

## Tasks

### High impact — hot path allocations
- [x] Add dirty flag to `AgentTracker` — only call `onAgentStateChange` when state actually changes (currently fires on every JSONL line including streaming deltas, allocating `AgentState[]` + `Map` each time)
- [x] Skip `onAgentStateChange` for event types that don't affect agent state (`content_block_delta`, `prompt_suggestion`, `usage.rate_limit`, `usage.context`)
- [x] Avoid double object allocation per broadcast: mutate envelope in place for `seq` instead of spreading (`server.ts:84`, `envelope.ts:22`)
- [x] Fix `envelope()` conditional spread `...(agentId ? { agentId } : {})` — use direct assignment to avoid allocating empty `{}`

### Medium impact — replay buffer
- [x] Replace `Array.shift()` replay buffer with ring buffer (fixed array + head/tail index) — O(1) instead of O(n) per event
- [x] Cache serialized JSON string alongside event in replay buffer — avoid re-serializing during replay
- [x] Use binary search or index scan for replay instead of `Array.filter()` (seqs are monotonic)

### Medium impact — caching
- [x] Cache `generateAsyncApiSpec()` result — spec is static, currently regenerated + JSON.stringify'd on every `/asyncapi.json` request
- [x] Cache `discovery.getSessions()` array — invalidate on session add/remove instead of allocating new array on every call

### Memory bounds
- [x] Add size cap to `AgentTracker.inFlightTools` Map (no limit currently; `JsonlParser.inFlight` caps at 100 — match that pattern)
- [x] Remove redundant `text.length > maxBytes` check in hook endpoint — `maxRequestBodySize` already enforces at Bun level; use `req.json()` directly

### Low impact
- [x] Hoist `toSnakeCase` regex to module scope in `hook-handler.ts`
- [x] Add fast-path exact `Set.has()` check in `matchesAny` before falling through to glob iteration
- [x] Consider `onAgentStateChange` passing only the affected session's agents instead of grouping all agents by session

### Tests
- [x] Add benchmark or load test for broadcast throughput (optional)
- [x] All existing tests still pass
