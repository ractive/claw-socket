---
title: Claude Code Internals — Streamable Data
description: Comprehensive analysis of all data Claude Code exposes that can be streamed over WebSocket
tags: [research, claude-code, streaming, events]
status: complete
date: 2026-04-02
source: clear-code v2.1.88
---

# Claude Code Internals — Streamable Data

## Session Storage & Paths

- **Session transcripts**: `~/.claude/projects/<project-id>/<session-id>.jsonl`
- **Global history**: `~/.claude/history.jsonl`
- **Agent memory**: `~/.claude/agent-memory/` (user), `.claude/agent-memory/` (project)
- **Teams & tasks**: `~/.claude/teams/`, `~/.claude/tasks/`
- **Scheduled tasks**: `.claude/scheduled_tasks.json`

## Session Metadata

| Field | Type | Description |
|-------|------|-------------|
| sessionId | UUID | Unique identifier |
| summary | string | Display title (custom or auto) |
| lastModified | ms epoch | Last update time |
| fileSize | bytes | Transcript size |
| firstPrompt | string | First user message |
| gitBranch | string | Branch at session end |
| cwd | string | Working directory |
| model | string | Model used |
| permission_mode | enum | default/acceptEdits/bypassPermissions/plan/dontAsk |
| claude_code_version | string | Build version |
| cost_usd | number | Total session cost |
| num_turns | number | API round-trips |
| fast_mode_state | enum | off/cooldown/on |
| createdAt | ms epoch | Session start time |
| tag | string | User-set session tag |

## Core Message Types (SDKMessage union — 22+ types)

### 1. User Messages (`type: 'user'`)
- `message` — API user message content
- `parent_tool_use_id` — links to parent tool (for subagent context)
- `isSynthetic` — system-generated vs human
- `priority` — now/next/later
- `timestamp`, `uuid`, `session_id`

### 2. Assistant Messages (`type: 'assistant'`)
- `message` — content blocks: text, tool_use, thinking
- `parent_tool_use_id`
- `error` — auth_failed, billing_error, rate_limit, server_error, max_output_tokens
- `uuid`, `session_id`

### 3. Result Messages (`type: 'result'`)
- `subtype` — success, error_during_execution, error_max_turns, error_max_budget_usd
- `duration_ms`, `duration_api_ms`
- `num_turns`, `total_cost_usd`
- `usage` — input_tokens, output_tokens, cache_read/creation_tokens
- `modelUsage` — per-model breakdown
- `permission_denials` — array of {tool_name, tool_use_id, tool_input}
- `stop_reason`, `structured_output`

### 4. System Messages (`type: 'system'`) — 9+ subtypes

| Subtype | Key Data |
|---------|----------|
| **init** | agents, tools, MCP servers, models, permission_mode, skills, plugins, cwd, version |
| **status** | Permission mode / session status changes |
| **api_retry** | attempt, max_retries, retry_delay_ms, error_status |
| **compact_boundary** | trigger (manual/auto), pre_tokens, preserved_segment |
| **hook_started** | hook_id, hook_name, hook_event |
| **hook_progress** | hook_id, stdout, stderr |
| **hook_response** | hook_id, output, exit_code, outcome |
| **task_started** | task_id, description, task_type, workflow_name |
| **task_progress** | task_id, usage (tokens, tool_uses, duration_ms) |
| **task_notification** | task_id, status (completed/failed/stopped) |
| **files_persisted** | successes [{filename, file_id}], failures [{filename, error}] |
| **local_command_output** | slash command output |
| **session_state_changed** | state: idle/running/requires_action |
| **elicitation_complete** | MCP user input completed |

### 5. Rate Limit Events (`type: 'rate_limit_event'`)
- `status` — allowed, allowed_warning, rejected
- `resetsAt`, `rateLimitType`, `utilization`
- `overageStatus`, `overageResetsAt`

### 6. Stream Events (`type: 'stream_event'`)
- Raw `RawMessageStreamEvent` from Anthropic SDK
- Real-time token-by-token streaming

### 7. Tool Progress (`type: 'tool_progress'`)
- `tool_use_id`, `tool_name`, `elapsed_time_seconds`
- Ephemeral — not persisted to JSONL

### 8. Tool Use Summary (`type: 'tool_use_summary'`)
- `summary` — e.g. "Read 2 files, wrote 1 file"
- `preceding_tool_use_ids`

### 9. Auth Status (`type: 'auth_status'`)
- `isAuthenticating`, `output`, `error`

### 10. Streamlined variants
- `streamlined_text` — compact text output
- `streamlined_tool_use_summary` — compact tool summary

### 11. Prompt Suggestions (`type: 'prompt_suggestion'`)
- `suggestion` — predicted next user prompt

## Hook Events (26 total)

| Event | Key Data |
|-------|----------|
| PreToolUse | tool_name, tool_input, tool_use_id |
| PostToolUse | tool_name, tool_input, tool_response, tool_use_id |
| PostToolUseFailure | tool_name, error, is_interrupt |
| PermissionRequest | tool_name, permission_suggestions |
| PermissionDenied | tool_name, reason |
| Notification | message, title, notification_type |
| UserPromptSubmit | prompt text |
| SessionStart | source (startup/resume/clear/compact), agent_type, model |
| SessionEnd | reason (clear/resume/logout/etc.) |
| Stop | stop_hook_active, last_assistant_message |
| SubagentStart | agent_id, agent_type, agent_transcript_path |
| SubagentStop | agent_id, agent_transcript_path |
| PreCompact/PostCompact | trigger, compact_summary |
| TeammateIdle | teammate_name, team_name |
| TaskCreated/TaskCompleted | task_id, task_subject, teammate_name |
| Elicitation/ElicitationResult | mcp_server_name, mode, schema |
| ConfigChange | source, file_path |
| InstructionsLoaded | file_path, memory_type, load_reason |
| WorktreeCreate/WorktreeRemove | name, worktree_path |
| CwdChanged | old_cwd, new_cwd |
| FileChanged | file_path, event (change/add/unlink) |

## Control Protocol (20+ request types)

Bidirectional control over WS:
- `initialize` — SDK init, returns commands/agents/models/account
- `can_use_tool` — permission request for tool invocation
- `interrupt` — stop current turn
- `set_permission_mode` / `set_model` / `set_max_thinking_tokens`
- `get_context_usage` — detailed token breakdown by category
- `rewind_files` — revert changes since a message
- `mcp_status` / `mcp_message` / `mcp_set_servers` / `mcp_reconnect` / `mcp_toggle`
- `stop_task` — terminate background task
- `get_settings` — fetch effective settings from all layers

## Context Usage Breakdown

Available via `get_context_usage`:
- `categories` — [{name, tokens, color}]
- `totalTokens`, `maxTokens`, `percentage`
- `memoryFiles` — [{path, type, tokens}]
- `mcpTools` — [{name, serverName, tokens}]
- `agents`, `slashCommands`, `skills`
- `messageBreakdown` — tool call/result/attachment/message tokens
- `apiUsage` — input/output/cache tokens

## WebSocket Transport Details

- **Endpoint**: `/v1/sessions/ws/{sessionId}/subscribe`
- **Auth**: OAuth Bearer token
- **Format**: JSONL (one JSON per line)
- **Ping**: 30s interval
- **Keep-alive**: 5min data frame
- **Reconnect**: 2s base, exponential backoff, 5 attempts
- **Message buffer**: 1000 messages circular
- **UUID dedup**: 2000-cap recent UUIDs

## Activity Ring Buffer

Per session, last 10 activities:
```
type SessionActivity = {
  type: 'tool_start' | 'text' | 'result' | 'error'
  summary: string
  timestamp: number
}
```
