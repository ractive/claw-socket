---
title: "Iteration 03: Hook Integration & Rich Events"
description: Accept Claude Code HTTP hooks for real-time tool/permission/task events
tags:
  - iteration
  - hooks
  - events
status: complete
iteration: 3
type: iteration
---

# Iteration 03: Hook Integration & Rich Events

## Goal
Accept HTTP hook callbacks from Claude Code for richer real-time events that JSONL doesn't capture.

## Tasks

- [x] HTTP hook endpoint (`POST /hook`) alongside WS server
- [x] Parse hook event types: PreToolUse, PostToolUse, PostToolUseFailure
- [x] Parse hook events: SessionStart, SessionEnd, SubagentStart, SubagentStop
- [x] Parse hook events: PermissionRequest, PermissionDenied
- [x] Parse hook events: TaskCreated, TaskCompleted, TeammateIdle
- [x] Parse hook events: FileChanged, CwdChanged, ConfigChange
- [x] Emit corresponding WS events for all hook types
- [x] Hook installer script (modify `~/.claude/settings.json`)
- [x] Merge hook data with JSONL data (deduplicate, enrich)
- [x] Tests for hook parsing and event emission
