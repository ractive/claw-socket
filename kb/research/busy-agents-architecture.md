---
title: busy-agents Architecture Reference
description: >-
  Analysis of the busy-agents project for inspiration on WS server design and
  event types
tags:
  - research
  - busy-agents
  - architecture
  - reference
status: complete
date: 2026-04-02
source: /Users/james/devel/busy-agents/
type: research
---

# busy-agents Architecture Reference

Real-time monitoring system for Claude Code agent sessions with a pixel-art game UI.

## Architecture Overview

```
Claude Code Sessions
    │
    ├─ Session metadata: ~/.claude/sessions/{pid}.json
    │   → [session-discovery] watches directory (chokidar)
    │   → SessionInfo {pid, sessionId, cwd, startedAt}
    │
    ├─ Agent JSONL: ~/.claude/projects/{projectKey}/{sessionId}/subagents/agent-*.jsonl
    │   → [jsonl-parser] tail-reads incrementally (byte offsets)
    │   → AgentState {status, tools, tokens}
    │
    ├─ HTTP Hooks: POST http://localhost:7890/hook
    │   → [hook-server] processes Claude Code hook events
    │   → PreToolUse, PostToolUse, SubagentStop, SessionStart/End, etc.
    │
    └─ All state → [StateStore] (EventEmitter)
        │
        ├─ [ws-server] ws://localhost:7891
        │   → snapshot on connect
        │   → agent_updated, agent_removed, session_added, session_removed
        │   → agent log subscription (subscribe_agent_log / unsubscribe_agent_log)
        │
        └─ [hook-server] http://localhost:7890
            → Serves frontend (Phaser.js game + table view)
            → Debug endpoints: /agents, /sessions
```

## Data Models

### AgentState
```typescript
{
  agentId: string
  agentType: string           // from .meta.json
  sessionId: string
  status: "working" | "tool_running" | "idle" | "offline"
  currentTool?: string
  currentToolInput?: string   // truncated 500 chars
  startedAt: number
  lastActivityAt: number
  toolCount: number
  tokenCount: number
  cwd: string
  name?: string
  teamName?: string
  toolHistory: ToolHistoryEntry[]  // ring buffer, max 10
}
```

### SessionInfo
```typescript
{
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  projectKey: string          // cwd with "/" → "-"
  subagentDir: string         // path to agent JSONL logs
}
```

### ToolHistoryEntry
```typescript
{
  toolName: string
  inputSummary: string        // truncated 500 chars
  durationMs: number          // 0 = in-flight
  success: boolean
  startedAt: number
}
```

## WebSocket Protocol

### Server → Client
| Message Type | Payload | When |
|---|---|---|
| `snapshot` | `{agents: AgentState[], sessions: SessionInfo[]}` | On connect |
| `agent_updated` | `{agent: AgentState}` | Any agent state change |
| `agent_removed` | `{agentId: string}` | Agent deleted |
| `session_added` | `{session: SessionInfo}` | New session discovered |
| `session_removed` | `{sessionId: string}` | Session ended |
| `agent_log_snapshot` | `{agentId, lines: AgentLogLine[]}` | On subscribe (last ~20 lines) |
| `agent_log_line` | `{agentId, line, timestamp}` | Real-time JSONL line |

### Client → Server
| Message Type | Payload | Effect |
|---|---|---|
| `subscribe_agent_log` | `{agentId: string}` | Start log stream |
| `unsubscribe_agent_log` | — | Stop log stream |

## Session Detection Mechanism

1. Claude Code writes `~/.claude/sessions/{pid}.json` on start
2. Chokidar watches directory (non-recursive, depth: 0)
3. Validates PID alive via `process.kill(pid, 0)`
4. Liveness check: every 10s
5. Grace period: 8s after removal before agents deleted

## JSONL Parsing

- Watches `subagentDir` for `agent-*.jsonl` files
- Reads incrementally (byte offset tracking)
- Parses: assistant entries → token counting + tool detection
- Tool use blocks → `tool_running` status
- Tool result/user blocks → completes duration, back to `working`
- Staleness: 30s no activity → `idle`

## Key Design Decisions

- **Two ports**: HTTP (7890) for hooks + static files, WS (7891) for real-time
- **EventEmitter state store**: Central pub/sub for all state changes
- **Ring buffers**: 10 tool history entries, 20 log lines per agent
- **Master agent**: Synthesized ID `master-{sessionId}` for non-subagent hooks
- **Graceful shutdown**: 8s grace period prevents UI flicker on quick restarts

## Differences for claw-socket

We should improve on:
- **Richer event types**: busy-agents only has 6 WS message types; Claude Code exposes 22+ message types
- **Session transcript streaming**: busy-agents only streams raw JSONL lines; we should parse and structure them
- **Control protocol**: busy-agents is read-only; we could expose control commands
- **Multiple subscriptions**: busy-agents allows one agent log subscription at a time; we should support multiple
- **Filtering**: No server-side filtering in busy-agents; we should support event type filters
- **API documentation**: No formal spec; we'll use AsyncAPI
