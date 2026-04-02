---
title: "Iteration 11: Security Hardening"
description: Connection limits, payload guards, error sanitization, CDN integrity, rate limiting
tags: [iteration, security, hardening]
status: done
iteration: 11
---

# Iteration 11: Security Hardening

## Goal
Harden the server against local DoS, information leakage, and supply chain risks. This iteration focuses on defense-in-depth for a local-only server (authentication is out of scope).

## Tasks

### Connection and payload limits
- [ ] Add `maxConnections` limit (e.g., 100) — check `clients.size` before WS upgrade, return 503 if exceeded
- [ ] Set `maxPayloadLength: 65536` (64KB) on WebSocket config — client messages are small subscribe/unsubscribe commands; Bun default is 16MB
- [ ] Warn prominently in logs if `--host` / `CLAW_SOCKET_HOST` resolves to a non-loopback address

### Error sanitization
- [ ] Replace Zod `result.error.issues` in WS error responses with generic message; log details at debug level
- [ ] Sanitize `system.error` broadcast messages — send generic description to clients, full error to logs only
- [ ] Strip or escape newlines in logger human-readable mode to prevent log injection

### CDN integrity for /docs
- [ ] Pin `@asyncapi/react-component` to exact version (not `@latest`)
- [ ] Add `integrity` (SRI hash) and `crossorigin="anonymous"` attributes to script/style tags
- [ ] Add `Content-Security-Policy` header restricting `script-src` and `style-src` to the CDN origin + `'unsafe-inline'`

### Rate limiting
- [ ] Rate-limit `replay` command per client (e.g., max 1 per second)
- [ ] Rate-limit `get_session_history` per client (e.g., max 2 concurrent)
- [ ] Add `unsubscribe_agent_log` message type (currently no way to unsubscribe; `rawLogSessions` grows unbounded)

### Hook installer safety
- [ ] Add advisory file locking when reading/writing `~/.claude/settings.json` to prevent TOCTOU with concurrent Claude Code writes
- [ ] Log warning when hook references unknown session ID

### Tests
- [ ] Test maxConnections rejection (103rd connection gets 503)
- [ ] Test oversized WS message rejection
- [ ] Test that error responses don't contain Zod internals
- [ ] Test unsubscribe_agent_log
- [ ] All existing tests still pass
