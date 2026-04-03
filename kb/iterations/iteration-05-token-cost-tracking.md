---
title: "Iteration 05: Token & Cost Tracking"
description: >-
  Real-time token usage, cost tracking, rate limit events, context window
  monitoring
tags:
  - iteration
  - tokens
  - costs
  - usage
status: complete
iteration: 5
type: iteration
---

# Iteration 05: Token & Cost Tracking

## Goal
Stream real-time token usage, costs, and rate limit information per session.

## Tasks

- [x] Parse token usage from assistant messages (input, output, cache tokens)
- [x] Parse result messages for total cost, duration, model usage breakdown
- [x] Emit `usage.update` events with running totals
- [x] Parse rate limit events from JSONL
- [x] Emit `usage.rate_limit` events (allowed, warning, rejected)
- [x] Track per-model usage breakdown
- [x] Emit `usage.context` events (context window percentage, categories)
- [x] Aggregate cost across sessions (global dashboard data)
- [x] Tests for usage calculation and rate limit parsing
