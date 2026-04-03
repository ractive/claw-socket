# claw-socket

Real-time WebSocket bridge that streams Claude Code agent events to any connected client.

claw-socket watches your Claude Code sessions and forwards tool calls, agent state changes, usage stats, and lifecycle events over a WebSocket connection. Connect a dashboard, build automations, or stream events to your own tooling.

## Quick start

```bash
# Install globally with Bun
bun install -g claw-socket

# Start the server (installs Claude Code hooks automatically)
claw-socket
```

The server starts on `ws://localhost:3838` by default.

## CLI flags

```
Usage: claw-socket [options]

Options:
  --port <number>      WebSocket server port (default: 3838, env: CLAW_SOCKET_PORT)
  --host <string>      Hostname to bind (default: localhost, env: CLAW_SOCKET_HOST)
  --verbose            Enable verbose logging
  --no-hooks           Skip hook installation
  --install-hooks      Install hooks and exit
  --uninstall-hooks    Remove claw-socket hooks from Claude settings and exit
  --help               Show help
  --version            Show version
```

## WebSocket protocol

Connect to `ws://localhost:3838`. The server immediately sends a snapshot of all active sessions and agents.

### Client messages

**Subscribe to event topics**

```json
{ "type": "subscribe", "topics": ["tool.*", "session.*"] }
```

Glob patterns are supported (`*` matches within a segment). An optional `sessionId` field scopes events to a single session.

**Unsubscribe**

```json
{ "type": "unsubscribe", "topics": ["tool.*"] }
```

**Request snapshot**

```json
{ "type": "get_snapshot" }
```

**Get session history**

```json
{ "type": "get_session_history", "sessionId": "abc123", "limit": 100 }
```

**Request replay from a sequence number**

Each broadcast event carries a `seq` integer. Use this to reconnect without missing events:

```json
{ "type": "replay", "lastSeq": 42 }
```

The server replays all buffered events with `seq > lastSeq` that match your current subscriptions.

**Get usage stats**

```json
{ "type": "get_usage", "sessionId": "abc123" }
```

### Event envelope

All server-to-client events share this structure:

```json
{
  "type": "tool.use",
  "timestamp": 1712345678000,
  "sessionId": "abc123",
  "seq": 17,
  "data": { }
}
```

### Common event types

| Type | Description |
|------|-------------|
| `session.discovered` | New Claude session started |
| `session.removed` | Session ended |
| `tool.use` | Tool invoked |
| `tool.result` | Tool completed |
| `agent.state_changed` | Agent state updated |
| `usage.updated` | Token/cost usage updated |
| `system.error` | Recoverable server error |

## Example client (JavaScript)

```javascript
const ws = new WebSocket("ws://localhost:3838");
let lastSeq = -1;

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "subscribe",
    topics: ["tool.*", "session.*"]
  }));
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.seq != null) lastSeq = msg.seq;

  if (msg.type === "snapshot") {
    console.log("Active sessions:", msg.sessions.length);
  } else if (msg.type === "tool.use") {
    console.log("Tool used:", msg.data.toolName);
  }
};

// On reconnect, replay missed events
function reconnect(ws) {
  ws.send(JSON.stringify({ type: "subscribe", topics: ["tool.*", "session.*"] }));
  if (lastSeq >= 0) {
    ws.send(JSON.stringify({ type: "replay", lastSeq }));
  }
}
```

## HTTP endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/health` | GET | Server health check |
| `/hook` | POST | Claude Code hook receiver — returns `202 {status:"accepted"}` |
| `/asyncapi.json` | GET | AsyncAPI spec (JSON) |
| `/docs` | GET | AsyncAPI browser UI (requires generated docs, see below) |

## Docs generation

`/docs` serves pre-generated static HTML. Run the following after cloning or whenever the spec changes:

```bash
# 1. Export the AsyncAPI spec
bun run export-spec

# 2. Generate the HTML docs page (served at /docs)
asyncapi generate fromTemplate asyncapi.json @asyncapi/html-template@3.5.4 \
  --param singleFile=true -o public --force-write

# 3. Generate the markdown reference (written to kb/docs/api-reference.md)
asyncapi generate fromTemplate asyncapi.json @asyncapi/markdown-template@2.0.0 \
  --param outFilename=api-reference.md -o kb/docs --force-write

# 4. Patch sidebar layout bug in html-template output
bun run patch-docs
```

Install the AsyncAPI CLI if needed: `npm install -g @asyncapi/cli` (or substitute `asyncapi` with `bunx @asyncapi/cli`).

> **Note:** Step 4 patches a layout bug in `@asyncapi/html-template` where the fixed sidebar overflows its container. It's idempotent — safe to run multiple times.

## Security Scanning

[Gitleaks](https://github.com/gitleaks/gitleaks) is used to detect secrets accidentally committed to the repository. CI runs this automatically on every push and pull request.

To run locally:

```bash
gitleaks detect
```

Configuration lives in `.gitleaks.toml` at the project root.

## Development

```bash
# Run tests
bun test

# Type check
bun run typecheck

# Format + lint + typecheck + test
bun run check

# Build standalone binary
bun run build

# Run in watch mode
bun run dev

# Install / uninstall Claude Code hooks manually
bun run hooks:install
bun run hooks:uninstall
```
