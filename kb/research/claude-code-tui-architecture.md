---
title: Claude Code TUI Update Architecture
description: How Claude Code's TUI receives real-time updates — the architecture we want to replicate
tags: [research, claude-code, tui, architecture, websocket]
status: complete
date: 2026-04-02
source: clear-code v2.1.88
---

# Claude Code TUI Update Architecture

## Core Finding

Claude Code's TUI uses **WebSocket** as its real-time backbone — the same approach we're building.

## Data Flow

```
Remote Agent (CCR) sends SDK messages
    │
    ▼  WebSocket (NDJSON)
SessionsWebSocket
    │  - WS connection management
    │  - NDJSON parsing
    │  - Reconnect with exponential backoff
    │  - Fires onMessage callback
    ▼
RemoteSessionManager
    │  - Routes messages (SDK vs control)
    │  - Manages permission requests
    │  - Calls domain callbacks
    ▼
useRemoteSession Hook (React)
    │  - Converts SDKMessage → REPL messages
    │  - Echo filtering (dedup)
    │  - setState triggers re-render
    ▼
React Components (useSyncExternalStore)
    │  - MessageList, LoadingSpinner, ToolUseConfirmDialog
    ▼
Ink Framework (Terminal UI)
    - Layout (Yoga), render to screen buffer, write diffs
```

## Key Architecture Patterns

### 1. Callback-Based Event Subscriptions

Transport layer exposes simple callbacks — no tight coupling to UI:

```typescript
type SessionsWebSocketCallbacks = {
  onMessage: (message: SessionsMessage) => void
  onClose?: () => void
  onError?: (error: Error) => void
  onConnected?: () => void
  onReconnecting?: () => void
}
```

### 2. Message Adaptation Layer

`sdkMessageAdapter.ts` converts backend SDKMessage → frontend-friendly types. The TUI never deals with raw SDK shapes.

### 3. Custom Store Pattern (not Redux)

Simple subscribe + notify pattern:

```typescript
type Store<T> = {
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: Listener) => () => void
}
```

React components use `useSyncExternalStore` to subscribe.

### 4. Per-Task Message Routing

Each subagent/task gets its own:
- RemoteSessionManager instance
- WebSocket connection
- useRemoteSession hook instance
- Task-specific state in `AppState.tasks`

### 5. Resilience

- **Reconnect**: Exponential backoff (2s base, up to 5 attempts)
- **Permanent close**: Code 4003 (unauthorized) stops reconnect
- **Session not found**: Code 4001 retries (up to 3, handles compaction)
- **Response timeout**: 60s then reconnect
- **Echo filtering**: BoundedUUIDSet (2000-cap) prevents dupes

### 6. Ring Buffers

- Activity history: max 10 per session
- Message buffer: 1000 messages for replay on reconnect
- UUID dedup: 2000-cap bounded sets

## WebSocket Transport Details

- **Endpoint**: `wss://api.anthropic.com/v1/sessions/ws/{sessionId}/subscribe`
- **Auth**: OAuth Bearer token in headers
- **Format**: NDJSON (newline-delimited JSON)
- **Ping/pong**: 30-second intervals
- **Keep-alive**: 5-minute data frames

## Relevance for claw-socket

Our architecture mirrors this closely:
- We use **WebSocket** as the transport (same as Claude Code TUI)
- We parse **NDJSON/JSONL** from session transcripts (same format)
- We need **callback-based routing** at the transport layer
- We need **message adaptation** to convert raw JSONL → structured events
- We need **reconnection resilience** for WS clients
- We should implement **ring buffers** for replay on reconnect
- We should support **per-session subscriptions** like their per-task routing

The main difference: Claude Code TUI connects to a remote CCR server via WS. We read local JSONL files + hooks and *serve* a WS to external clients. We're on the server side, they're on the client side.
