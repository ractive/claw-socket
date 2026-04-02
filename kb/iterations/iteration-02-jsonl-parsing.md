---
title: "Iteration 02: JSONL Parsing & Message Events"
description: Parse session transcripts and stream structured message events
tags: [iteration, jsonl, messages]
status: planned
iteration: 2
---

# Iteration 02: JSONL Parsing & Message Events

## Goal
Tail-read session JSONL files and stream structured, typed events for messages, tools, and results.

## Tasks

- [ ] Implement JSONL file watcher (incremental byte-offset reading)
- [ ] Parse SDKMessage types from JSONL lines (user, assistant, result, system)
- [ ] Emit `message.user`, `message.assistant`, `message.result` events
- [ ] Emit `tool.started`, `tool.completed`, `tool.failed` events from tool_use blocks
- [ ] Emit `session.started` from system init messages
- [ ] Emit `session.state_changed` from state change messages
- [ ] Track agent state (status, currentTool, tokenCount, toolHistory)
- [ ] Emit `agent.started`, `agent.stopped` from subagent JSONL files
- [ ] Staleness detection (idle after N seconds of no activity)
- [ ] Tests for JSONL parsing and event emission
