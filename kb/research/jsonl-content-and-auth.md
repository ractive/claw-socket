---
title: JSONL Content Coverage & OAuth Token Access
description: What's in the JSONL files (and what's missing), plus how to access OAuth tokens for CCR
tags: [research, jsonl, oauth, ccr, auth]
status: complete
date: 2026-04-02
source: clear-code v2.1.88
---

# JSONL Content Coverage & OAuth Token Access

## What's Written to JSONL

Only **transcript messages** are persisted:

| Type | Written? | Notes |
|------|----------|-------|
| `user` | Yes | All user messages |
| `assistant` | Yes | Complete assistant responses (text, tool_use, thinking blocks) |
| `attachment` | Yes | File attachments |
| `system` (all subtypes) | Yes | init, status, compact_boundary, hook_*, task_*, files_persisted, etc. |
| File history snapshots | Yes | |
| Content replacements | Yes | |
| Context collapse entries | Yes | |

## What's NOT Written (Ephemeral Only)

| Type | Why Not |
|------|---------|
| `stream_event` (token deltas) | TUI rendering only — the complete assistant message is written instead |
| `tool_progress` | High-frequency (1/sec), UI-only state. Explicitly excluded to avoid chain forks (#14373, #23537) |
| Legacy `progress` messages | Deprecated, not part of Entry type |

## Assessment: Is JSONL Enough?

**For most use cases: YES.** The JSONL contains:
- Every conversation turn (user + assistant)
- Every tool call and result
- Session init (model, version, tools, agents, MCP servers)
- All system events (hooks, tasks, compaction, state changes)
- Result messages with cost/usage/duration

**What we miss without stream_event:**
- Token-by-token streaming (we only see complete messages)
- Real-time "typing" indicator

**What we miss without tool_progress:**
- Live elapsed-time updates during tool execution

**Mitigation**: HTTP hooks give us real-time PreToolUse/PostToolUse events, filling the gap for tool timing. For streaming deltas, we'd need CCR access.

## OAuth Token Access

### Where Tokens Live

| Location | Platform | Format |
|----------|----------|--------|
| macOS Keychain | macOS | Encrypted, access-controlled |
| `~/.claude/.credentials.json` | All (fallback) | Plaintext JSON, mode 0o600 |
| `CLAUDE_CODE_OAUTH_TOKEN` env var | Any | Plaintext in environment |
| `/home/claude/.claude/remote/.oauth_token` | CCR containers only | Plaintext file |

### Token Structure

```typescript
{
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null    // ms epoch
  scopes: string[]
  subscriptionType: string | null
  rateLimitTier: string | null
}
```

### Reading the Token (macOS)

1. Read service name: `cat ~/.claude/.credentials.service_name`
2. Read from Keychain: `security find-generic-password -a $USER -w -s <service_name>`
3. Parse JSON, extract `claudeAiOauth.accessToken`

Or if Keychain failed and fallback is in use:
- Read `~/.claude/.credentials.json` → `.claudeAiOauth.accessToken`

### Can We Connect to CCR?

**Technically yes** — we can read the OAuth token and connect to:
```
wss://api.anthropic.com/v1/sessions/ws/{sessionId}/subscribe?organization_uuid=...
```

With header: `Authorization: Bearer <accessToken>`

**But**: We'd need the sessionId for the remote session, which is internal to the CCR flow. And this only applies to remote/cloud sessions, not local ones.

### Refresh Mechanism

- Tokens auto-refresh when expired
- Cross-process: mtime check on `.credentials.json` invalidates cache
- `refreshOAuthToken()` writes new tokens back to secure storage
