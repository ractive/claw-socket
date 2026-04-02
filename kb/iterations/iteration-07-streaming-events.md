---
title: "Iteration 07: Real-time Streaming & MCP Events"
description: Token-by-token streaming, MCP server events, file events
tags:
  - iteration
  - streaming
  - mcp
  - files
status: done
iteration: 7
---

# Iteration 07: Real-time Streaming & MCP Events

## Goal
Add fine-grained real-time events: token streaming, MCP server status, file changes.

## Tasks

- [x] Parse stream_event messages for token-by-token text deltas
- [x] Emit `stream.delta`, `stream.thinking_delta`, `stream.tool_use_delta`
- [x] Parse MCP server status from system init and hook events
- [x] Emit `mcp.server_status` events
- [x] Parse elicitation events
- [x] Emit `mcp.elicitation` events
- [x] Parse file change hooks
- [x] Emit `file.changed`, `file.persisted`, `cwd.changed` events
- [x] Parse hook lifecycle from JSONL
- [x] Emit `hook.started`, `hook.progress`, `hook.completed` events
- [x] Optional: prompt suggestion forwarding (`prompt_suggestion` events)
- [x] Tests for streaming and MCP event parsing
