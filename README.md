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
| `/hook` | POST | Claude Code hook receiver |
| `/asyncapi.json` | GET | AsyncAPI spec |
| `/docs` | GET | AsyncAPI browser UI |

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
```
