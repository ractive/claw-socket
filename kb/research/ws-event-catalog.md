---
title: WebSocket Event Catalog Design
description: All streams and events claw-socket could offer to WS clients
tags: [design, events, websocket, catalog]
status: complete
date: 2026-04-02
---

# WebSocket Event Catalog

## Design Principles

1. **Subscribe to what you need** — clients choose event types via topic subscriptions
2. **Layered detail** — summary events for dashboards, detailed events for deep inspection
3. **Structured, not raw** — we parse JSONL and deliver typed, structured events
4. **Backward compatible** — new event types don't break existing clients

## Connection Flow

```
Client connects → ws://localhost:<port>
  ← server sends: snapshot (all active sessions + agents)
  → client sends: subscribe to specific topics/sessions
  ← server streams: events matching subscription
```

## Event Categories

### 1. Session Lifecycle Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `session.discovered` | New Claude Code session detected | sessionId, cwd, pid, model, startedAt |
| `session.started` | Session init message parsed | sessionId, version, model, permissionMode, tools, agents, mcpServers |
| `session.ended` | Session process exited | sessionId, reason, duration, totalCost, numTurns |
| `session.state_changed` | Session state transition | sessionId, state (idle/running/requires_action) |
| `session.compacted` | Conversation compaction | sessionId, trigger, preTokens |
| `session.removed` | Session fully cleaned up | sessionId |

### 2. Agent/Subagent Lifecycle Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `agent.started` | Subagent spawned | agentId, agentType, sessionId, parentToolUseId |
| `agent.stopped` | Subagent completed | agentId, transcriptPath, lastMessage |
| `agent.idle` | Agent went idle (no activity) | agentId, idleSince |
| `agent.state_changed` | Agent status change | agentId, status (working/tool_running/idle/offline) |

### 3. Message Stream Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `message.user` | User sent a message | sessionId, text (preview), uuid, isSynthetic |
| `message.assistant` | Assistant response (complete) | sessionId, contentBlocks, uuid, model |
| `message.assistant.text` | Text content block | sessionId, text, uuid |
| `message.assistant.thinking` | Thinking block | sessionId, thinking (summary), uuid |
| `message.result` | Turn completed | sessionId, subtype, duration, cost, usage, numTurns |
| `message.error` | Error occurred | sessionId, error, errorType |

### 4. Tool Execution Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `tool.started` | Tool invocation began | sessionId, agentId, toolName, toolUseId, inputSummary |
| `tool.progress` | Tool execution progress | sessionId, toolUseId, elapsedSeconds |
| `tool.completed` | Tool finished successfully | sessionId, toolUseId, toolName, durationMs, outputSummary |
| `tool.failed` | Tool execution failed | sessionId, toolUseId, toolName, error, isInterrupt |
| `tool.permission_requested` | Permission needed | sessionId, toolName, toolInput, suggestions |
| `tool.permission_denied` | Tool denied | sessionId, toolName, reason |

### 5. Token & Cost Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `usage.update` | Token usage update | sessionId, inputTokens, outputTokens, cacheTokens, costUsd |
| `usage.rate_limit` | Rate limit event | sessionId, status, resetsAt, utilization, rateLimitType |
| `usage.context` | Context window status | sessionId, totalTokens, maxTokens, percentage, categories |

### 6. Hook Events

**Implemented (iter-03)** — received via `POST /hook` from Claude Code HTTP hooks:

| Event | Description | Key Fields |
|-------|-------------|------------|
| `hook.pre_tool_use` | Tool about to execute | toolName, toolUseId, inputSummary, tool_input |
| `hook.post_tool_use` | Tool finished successfully | toolName, toolUseId, outputSummary, tool_response |
| `hook.post_tool_use_failure` | Tool execution failed | toolName, error, isInterrupt |
| `hook.session_start` | Claude Code session started | source, agent_type, model |
| `hook.session_end` | Claude Code session ended | reason |
| `hook.stop` | Stop hook fired | stop_hook_active, last_assistant_message |
| `hook.subagent_start` | Subagent spawned | agent_id, agent_type, agent_transcript_path |
| `hook.subagent_stop` | Subagent finished | agent_id, agent_transcript_path |
| `hook.permission_request` | Permission prompt shown | tool_name, permission_suggestions |
| `hook.permission_denied` | Permission denied | tool_name, reason |
| `hook.task_created` | Claude Code task created | task_id, task_subject, teammate_name |
| `hook.task_completed` | Claude Code task completed | task_id, task_subject, teammate_name |
| `hook.teammate_idle` | Teammate waiting for work | teammate_name, team_name |
| `hook.notification` | Notification fired | message, title, notification_type |
| `hook.user_prompt_submit` | User submitted a prompt | prompt text |
| `hook.pre_compact` | About to compact context | trigger |
| `hook.post_compact` | Compaction finished | compact_summary |
| `hook.config_change` | Config file changed | source, file_path |
| `hook.instructions_loaded` | Instructions file loaded | file_path, memory_type, load_reason |
| `hook.cwd_changed` | Working directory changed | old_cwd, new_cwd |
| `hook.file_changed` | File modified/added/removed | file_path, event |
| `hook.elicitation` | MCP elicitation started | mcp_server_name, mode, schema |
| `hook.elicitation_result` | MCP elicitation result | mcp_server_name |
| `hook.worktree_create` | Git worktree created | name, worktree_path |
| `hook.worktree_remove` | Git worktree removed | name, worktree_path |

**Planned (iter-07)** — parsed from JSONL system messages about hook execution lifecycle:

| Event | Description | Key Fields |
|-------|-------------|------------|
| `hook.started` | Hook execution began | sessionId, hookId, hookName, hookEvent |
| `hook.progress` | Hook output streaming | sessionId, hookId, stdout, stderr |
| `hook.completed` | Hook finished | sessionId, hookId, exitCode, outcome |

### 7. Task Events (Claude Code tasks/todos)

| Event | Description | Key Fields |
|-------|-------------|------------|
| `task.created` | Task created | sessionId, taskId, subject, description |
| `task.progress` | Task progress update | sessionId, taskId, usage |
| `task.completed` | Task finished | sessionId, taskId, status (completed/failed/stopped) |

### 8. MCP Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `mcp.server_status` | MCP server status change | sessionId, serverName, status, error |
| `mcp.elicitation` | MCP requesting user input | sessionId, serverName, message, mode |

### 9. File Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `file.changed` | File modified by Claude | sessionId, filePath, event (change/add/unlink) |
| `file.persisted` | File write confirmed | sessionId, filename, fileId |
| `cwd.changed` | Working directory changed | sessionId, oldCwd, newCwd |

### 10. Stream Events (Raw token streaming)

| Event | Description | Key Fields |
|-------|-------------|------------|
| `stream.delta` | Token-by-token text | sessionId, text, uuid |
| `stream.thinking_delta` | Thinking token stream | sessionId, text, uuid |
| `stream.tool_use_delta` | Tool input streaming | sessionId, toolUseId, json |

## Client Subscription Protocol

### Subscribe
```json
{
  "type": "subscribe",
  "topics": ["session.*", "tool.*"],
  "sessionId": "optional-filter-to-one-session",
  "options": {
    "includeStreamEvents": false,
    "includeRawJsonl": false
  }
}
```

### Unsubscribe
```json
{
  "type": "unsubscribe",
  "topics": ["stream.*"]
}
```

### Request Snapshot
```json
{
  "type": "get_snapshot"
}
```

### Request Session History
```json
{
  "type": "get_session_history",
  "sessionId": "...",
  "since": "2026-04-02T00:00:00Z",
  "limit": 100
}
```

### Request Agent Logs
```json
{
  "type": "subscribe_agent_log",
  "agentId": "...",
  "includeSnapshot": true
}
```

## Topic Patterns

Glob-style matching on event types:
- `*` — all events
- `session.*` — all session lifecycle events
- `tool.*` — all tool events
- `message.assistant.*` — assistant messages only
- `usage.*` — token/cost events

## Server → Client Envelope

Every event wrapped in a standard envelope:
```typescript
{
  type: string           // event type (e.g. "tool.started")
  timestamp: number      // ms epoch
  sessionId: string      // which session
  agentId?: string       // which agent (if applicable)
  data: object           // event-specific payload
}
```

## Comparison with busy-agents

| Feature | busy-agents | claw-socket |
|---------|-------------|-------------|
| Event types | 6 | 40+ |
| Subscriptions | 1 agent log at a time | Multiple topic patterns |
| Filtering | None | Topic glob + session filter |
| Raw streaming | JSONL lines | Structured typed events |
| Control protocol | None (read-only) | Request/response (snapshot, history) |
| Documentation | None | AsyncAPI 3.0 spec + docs UI |
| Session discovery | File watching only | File watching + hook integration |
