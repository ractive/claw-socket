---
title: "Iteration 07: Real-time Streaming & MCP Events"
description: Token-by-token streaming, MCP server events, file events
tags: [iteration, streaming, mcp, files]
status: planned
iteration: 7
---

# Iteration 07: Real-time Streaming & MCP Events

## Goal
Add fine-grained real-time events: token streaming, MCP server status, file changes.

## Tasks

- [ ] Parse stream_event messages for token-by-token text deltas
- [ ] Emit `stream.delta`, `stream.thinking_delta`, `stream.tool_use_delta`
- [ ] Parse MCP server status from system init and hook events
- [ ] Emit `mcp.server_status` events
- [ ] Parse elicitation events
- [ ] Emit `mcp.elicitation` events
- [ ] Parse file change hooks
- [ ] Emit `file.changed`, `file.persisted`, `cwd.changed` events
- [ ] Parse hook lifecycle from JSONL
- [ ] Emit `hook.started`, `hook.progress`, `hook.completed` events
- [ ] Optional: prompt suggestion forwarding (`prompt_suggestion` events)
- [ ] Tests for streaming and MCP event parsing
