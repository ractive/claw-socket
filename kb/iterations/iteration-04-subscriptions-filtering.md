---
title: "Iteration 04: Subscriptions & Filtering"
description: Topic-based subscriptions, session filtering, request/response protocol
tags: [iteration, subscriptions, filtering]
status: planned
iteration: 4
---

# Iteration 04: Subscriptions & Filtering

## Goal
Full subscription model so clients get exactly the events they need, plus request/response for on-demand data.

## Tasks

- [ ] Glob-style topic matching (`session.*`, `tool.started`, `*`)
- [ ] Session-scoped subscriptions (filter events to one session)
- [ ] Multiple concurrent subscriptions per client
- [ ] Request/response: `get_snapshot` (current state)
- [ ] Request/response: `get_session_history` (past events from JSONL)
- [ ] Request/response: `get_session_list` (all known sessions with metadata)
- [ ] Request/response: `subscribe_agent_log` (raw JSONL lines for an agent)
- [ ] Bun pub/sub topic mapping (leverage native `.subscribe()` / `.publish()`)
- [ ] Backpressure handling (slow clients)
- [ ] Tests for subscription matching and filtering
