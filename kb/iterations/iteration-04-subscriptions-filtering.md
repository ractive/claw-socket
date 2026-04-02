---
title: "Iteration 04: Subscriptions & Filtering"
description: Topic-based subscriptions, session filtering, request/response protocol
tags:
  - iteration
  - subscriptions
  - filtering
status: done
iteration: 4
---

# Iteration 04: Subscriptions & Filtering

## Goal
Full subscription model so clients get exactly the events they need, plus request/response for on-demand data.

## Tasks

- [x] Glob-style topic matching (`session.*`, `tool.started`, `*`)
- [x] Session-scoped subscriptions (filter events to one session)
- [x] Multiple concurrent subscriptions per client
- [x] Request/response: `get_snapshot` (current state)
- [x] Request/response: `get_session_history` (past events from JSONL)
- [x] Request/response: `get_session_list` (all known sessions with metadata)
- [x] Request/response: `subscribe_agent_log` (raw JSONL lines for an agent)
- [x] Bun pub/sub topic mapping (leverage native `.subscribe()` / `.publish()`)
- [x] Backpressure handling (slow clients)
- [x] Tests for subscription matching and filtering
