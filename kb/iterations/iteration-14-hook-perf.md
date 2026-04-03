---
title: "Iteration 14: Hook Fire-and-Forget, Installer Fix & Broadcast Performance"
iteration: 14
status: completed
tags:
  - performance
  - reliability
  - hooks
---

# Iteration 14: Hook Fire-and-Forget, Installer Fix & Broadcast Performance

Three related problems: Claude blocks on http hooks (and shows errors when the server is down), the hook installer writes an invalid settings structure, and the broadcast loop is O(n×m) with no topic indexing.

---

## Problem 1 — Hook installer writes the wrong settings structure

`src/hook-installer.ts` currently writes a namespaced key that Claude Code doesn't understand:

```json
{
  "hooks": {
    "claw-socket": {
      "PostToolUse": [{"type": "http", "url": "..."}]
    }
  }
}
```

Claude Code expects event names directly under `hooks`, with each entry as `{matcher, hooks[]}`:

```json
{
  "hooks": {
    "PostToolUse": [
      {"matcher": "", "hooks": [{"type": "http", "url": "..."}], "_tag": "claw-socket"}
    ]
  }
}
```

Additionally, `src/schemas/hook.ts` lists `CwdChanged`, `FileChanged`, `PermissionDenied`, and `TaskCreated` as valid `HookEventType` values, but Claude Code's settings schema does not accept these as hook registration keys — they cause "Invalid key in record" errors.

### Fix — installer writes flat, tagged entries

- Each claw-socket hook is written as a tagged entry directly under the event key: `{matcher: "", hooks: [...], _tag: "claw-socket"}`
- Install: for each valid event, if a `_tag: "claw-socket"` entry already exists replace it in-place (e.g. port changed); otherwise push a new entry — always up-to-date, never duplicated
- Uninstall: for each event, filter out entries where `_tag === "claw-socket"`; delete the event key if the array becomes empty
- Separate the `HookEventTypeSchema` (all events claw-socket can *receive*) from the set of events it *registers* for — `CwdChanged`, `FileChanged`, `PermissionDenied`, `TaskCreated` stay in the receive schema but are excluded from the install list

---

## Problem 2 — http hooks block Claude and error when server is down

The `{"type": "http"}` hook type blocks Claude until the HTTP response completes. If the server is not running:

```
⏺ Ran 1 stop hook
  ⎿  Stop hook error: HTTP 400 from http://localhost:3838/hook
```

The `async` field only exists on **command** hooks. Fix: use async curl command hooks instead.

```json
{
  "matcher": "",
  "hooks": [{
    "type": "command",
    "command": "curl -sf --max-time 2 -X POST http://localhost:3838/hook -H 'Content-Type: application/json' -d @- >/dev/null 2>&1",
    "async": true
  }],
  "_tag": "claw-socket"
}
```

- `async: true` — Claude does not wait for the response at all (fire-and-forget)
- `-sf` — silent, no stderr on HTTP errors
- `--max-time 2` — hard cap if curl hangs
- `>/dev/null 2>&1` — swallow all output, no visible error when server is down
- `curl` reads the hook payload from stdin (`-d @-`), which is how Claude Code passes it

The installer generates this command string using the configured port.

---

## Problem 3 — Missing uninstall CLI flag and no package.json convenience scripts

`uninstallHook()` exists in `hook-installer.ts` but has no CLI surface. There are no package.json scripts for one-liner install/uninstall.

### Fix

Add `--uninstall-hooks` flag to `cli.ts`:

```
--uninstall-hooks    Remove claw-socket hooks from Claude settings and exit
```

Add to `package.json`:

```json
"hooks:install":   "bun run src/index.ts --install-hooks",
"hooks:uninstall": "bun run src/index.ts --uninstall-hooks"
```

---

## Problem 4 — Broadcast loop is O(n × m)

`broadcast()` in `server.ts` iterates all WebSocket clients, then for each client iterates all subscription patterns. With many clients this grows linearly; with wildcard patterns it degrades further.

### Fix — topic index (O(1) routing)

Build a `Map<string, Set<ServerWebSocket>>` maintained alongside `clients`:

- `"*"` bucket → wildcard subscribers
- `"hook.*"` prefix bucket → prefix-pattern subscribers
- `"agent.started"` exact bucket → exact-match subscribers

On `subscribe`: insert client into bucket(s) for each pattern.
On `unsubscribe`/`disconnect`: remove client from all buckets.
On `broadcast(event)`: union of exact bucket + matching prefix buckets + wildcard bucket → only those clients receive the message. No full client iteration.

### Fix B — respond 202 before processing

Return the HTTP response immediately, then process via `queueMicrotask`:

```typescript
const body = await req.json();
queueMicrotask(() => {
  const events = processHookEvent(body);
  for (const e of events) {
    sessionWatcher.handleExternalEvent(e);
    broadcast(e);
  }
});
return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
```

The curl hook reads the response to know it was accepted, then discards it (with `async: true`, Claude doesn't wait either way). The `eventsEmitted` field is removed from the response.

---

## Acceptance criteria

### Installer fix
- [ ] `installHook()` writes entries directly under event keys with `_tag: "claw-socket"`
- [ ] Re-running install updates existing entries in-place (e.g. port change) — no duplicates
- [ ] `uninstallHook()` removes only `_tag: "claw-socket"` entries, leaves others untouched
- [ ] `CwdChanged`, `FileChanged`, `PermissionDenied`, `TaskCreated` excluded from install list
- [ ] Existing `HookEventTypeSchema` unchanged (still accepts these for inbound parsing)

### Fire-and-forget
- [ ] Installer writes async curl command hooks, not http hooks
- [ ] No Claude hook error messages when claw-socket is not running
- [ ] Hook registration roundtrip tested: install → check settings → uninstall → check settings

### CLI / package.json
- [ ] `--uninstall-hooks` flag added to CLI, exits after uninstalling
- [ ] `bun run hooks:install` and `bun run hooks:uninstall` work from the project root
- [ ] Help text updated

### Broadcast performance
- [ ] Topic index implemented in `server.ts`
- [ ] `broadcast()` no longer iterates `clients` set directly
- [ ] Index kept consistent across subscribe/unsubscribe/disconnect
- [ ] 202 response before processing
- [ ] All tests pass (`bun run check`)
- [ ] AsyncAPI spec updated: hook endpoint response is 202, body is `{status: "accepted"}`
