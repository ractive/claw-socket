---
title: "Iteration 05: Token & Cost Tracking"
description: Real-time token usage, cost tracking, rate limit events, context window monitoring
tags: [iteration, tokens, costs, usage]
status: planned
iteration: 5
---

# Iteration 05: Token & Cost Tracking

## Goal
Stream real-time token usage, costs, and rate limit information per session.

## Tasks

- [ ] Parse token usage from assistant messages (input, output, cache tokens)
- [ ] Parse result messages for total cost, duration, model usage breakdown
- [ ] Emit `usage.update` events with running totals
- [ ] Parse rate limit events from JSONL
- [ ] Emit `usage.rate_limit` events (allowed, warning, rejected)
- [ ] Track per-model usage breakdown
- [ ] Emit `usage.context` events (context window percentage, categories)
- [ ] Aggregate cost across sessions (global dashboard data)
- [ ] Tests for usage calculation and rate limit parsing
