---
title: "Iteration 03: Hook Integration & Rich Events"
description: Accept Claude Code HTTP hooks for real-time tool/permission/task events
tags: [iteration, hooks, events]
status: planned
iteration: 3
---

# Iteration 03: Hook Integration & Rich Events

## Goal
Accept HTTP hook callbacks from Claude Code for richer real-time events that JSONL doesn't capture.

## Tasks

- [ ] HTTP hook endpoint (`POST /hook`) alongside WS server
- [ ] Parse hook event types: PreToolUse, PostToolUse, PostToolUseFailure
- [ ] Parse hook events: SessionStart, SessionEnd, SubagentStart, SubagentStop
- [ ] Parse hook events: PermissionRequest, PermissionDenied
- [ ] Parse hook events: TaskCreated, TaskCompleted, TeammateIdle
- [ ] Parse hook events: FileChanged, CwdChanged, ConfigChange
- [ ] Emit corresponding WS events for all hook types
- [ ] Hook installer script (modify `~/.claude/settings.json`)
- [ ] Merge hook data with JSONL data (deduplicate, enrich)
- [ ] Tests for hook parsing and event emission
