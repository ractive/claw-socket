---
title: "Iteration 11: Security Hardening"
description: >-
  Connection limits, payload guards, error sanitization, CDN integrity, rate
  limiting
tags:
  - iteration
  - security
  - hardening
status: complete
iteration: 11
type: iteration
---

# Iteration 11: Security Hardening

## Goal
Harden the server against local DoS, information leakage, and supply chain risks. This iteration focuses on defense-in-depth for a local-only server (authentication is out of scope).

## Tasks

### Connection and payload limits
- [x] Add `maxConnections` limit (e.g., 100) — check `clients.size` before WS upgrade, return 503 if exceeded
- [x] Set `maxPayloadLength: 65536` (64KB) on WebSocket config — client messages are small subscribe/unsubscribe commands; Bun default is 16MB
- [x] Warn prominently in logs if `--host` / `CLAW_SOCKET_HOST` resolves to a non-loopback address

### Error sanitization
- [x] Replace Zod `result.error.issues` in WS error responses with generic message; log details at debug level
- [x] Sanitize `system.error` broadcast messages — send generic description to clients, full error to logs only
- [x] Strip or escape newlines in logger human-readable mode to prevent log injection

### CDN integrity for /docs
- [x] Pin `@asyncapi/react-component` to exact version (not `@latest`)
- [x] Add `integrity` (SRI hash) and `crossorigin="anonymous"` attributes to script/style tags
- [x] Add `Content-Security-Policy` header restricting `script-src` and `style-src` to the CDN origin + `'unsafe-inline'`

### Rate limiting
- [x] Rate-limit `replay` command per client (e.g., max 1 per second)
- [x] Rate-limit `get_session_history` per client (e.g., max 2 concurrent)
- [x] Add `unsubscribe_agent_log` message type (currently no way to unsubscribe; `rawLogSessions` grows unbounded)

### Hook installer safety
- [x] Add advisory file locking when reading/writing `~/.claude/settings.json` to prevent TOCTOU with concurrent Claude Code writes
- [x] Log warning when hook references unknown session ID

### Tests
- [x] Test maxConnections rejection (103rd connection gets 503)
- [x] Test oversized WS message rejection
- [x] Test that error responses don't contain Zod internals
- [x] Test unsubscribe_agent_log
- [x] All existing tests still pass
