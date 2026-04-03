---
title: "Iteration 15: File-Based Token Authentication"
iteration: 15
status: completed
tags:
  - security
  - auth
  - iteration
---

# Iteration 15: File-Based Token Authentication

## Motivation

claw-socket has origin validation, per-IP limits, and rate limiting, but no authentication. Any local process can connect to the WebSocket or POST to /hook. A file-based shared secret (`~/.claw-socket/token`) provides same-user-only auth with zero config, following the Jupyter Notebook pattern.

## Design

### Token lifecycle
- On first startup, generate a 32-byte random hex token
- Write to `~/.claw-socket/token` with `chmod 600` (user-only read/write)
- Create `~/.claw-socket/` directory if missing (mode 700)
- On subsequent startups, **reuse** the existing token (stable across restarts)
- `--rotate-token` CLI flag to force regeneration

### Where auth is enforced

| Endpoint | Auth required | How |
|---|---|---|
| WebSocket upgrade | Yes | `?token=xxx` query param |
| POST /hook | Yes | `Authorization: Bearer xxx` header |
| GET /health | No | Read-only, non-sensitive |
| GET /docs | No | Read-only, static HTML |
| GET /asyncapi.json | No | Read-only, static spec |

### Token delivery to hooks
Hook installer embeds dynamic token read in curl command:
```bash
curl -sf --max-time 2 -X POST http://localhost:PORT/hook \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(cat ~/.claw-socket/token)" \
  -d @- >/dev/null 2>&1
```

### CLI changes
- `--no-auth` — disable token auth (development/testing)
- `--rotate-token` — regenerate token and exit

## Tasks

### Token module (`src/auth.ts`) [4/4]
- [x] `ensureToken()` — read existing or create new token
- [x] `rotateToken()` — force regeneration
- [x] Directory creation with mode 700, file with mode 600
- [x] Cross-platform path: `~/.claw-socket/token`

### HTTP handler auth (`src/http-handler.ts`) [3/3]
- [x] Add `authToken: string | null` to `HttpHandlerDeps`
- [x] Check `?token=` query param on WebSocket upgrade (401 if wrong)
- [x] Check `Authorization: Bearer` header on POST /hook (401 if wrong)

### Server wiring (`src/server.ts`) [2/2]
- [x] Add `authToken` to `ServerOptions`
- [x] Pass through to `handleHttpRequest` deps

### Hook installer (`src/hook-installer.ts`) [1/1]
- [x] Add `Authorization: Bearer $(cat ~/.claw-socket/token)` header to curl command

### CLI (`src/cli.ts`) [3/3]
- [x] `--no-auth` flag
- [x] `--rotate-token` flag (rotate and exit)
- [x] Call `ensureToken()` on startup, log token path

### Tests [4/4]
- [x] `test/auth.test.ts` — token file I/O, permissions, reuse, rotation
- [x] Auth enforcement — WS upgrade without/wrong/correct token
- [x] Auth enforcement — POST /hook without/correct token
- [x] Existing tests pass with `authToken: null`

## Acceptance criteria [5/5]
- [x] Server generates token on first start, reuses on restart
- [x] WebSocket upgrade and POST /hook require valid token
- [x] Read-only endpoints (/health, /docs, /asyncapi.json) work without token
- [x] `--no-auth` disables all token checks
- [x] `bun run check` passes (format, typecheck, tests)
