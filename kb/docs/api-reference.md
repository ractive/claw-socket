# claw-socket 0.1.0 documentation

* License: MIT
* Default content type: [application/json](https://www.iana.org/assignments/media-types/application/json)
* Support: [claw-socket](https://github.com/ractive/claw-socket)

# claw-socket WebSocket API

Real-time event streaming for Claude Code sessions via WebSocket.

## Connecting

Connect to `ws://localhost:3838` (or your configured host/port). On connect,
the server immediately sends a `snapshot` message containing all current
sessions and agent states — no subscription required.

## Subscribing to Topics

Send a `subscribe` message with an array of topic patterns. Topics use dot
notation matching event `type` fields (e.g. `session.discovered`,
`tool.started`). Glob patterns are supported:

- `session.*` — all session events
- `message.*` — all message events
- `tool.*` — all tool events
- `stream.*` — all streaming delta events
- `agent.*` — all agent events
- `usage.*` — all usage/cost events
- `hook.*` — all hook events (covers all 24 Claude Code hook types)
- `mcp.*` — MCP server status and elicitation events
- `file.*` — file change notifications
- `cwd.*` — working directory change notifications
- `prompt.*` — prompt suggestion events
- `system.*` — internal server events

Include an optional `sessionId` to filter events to a single Claude session.

## Request / Response Commands

| Client sends             | Server responds with                           |
|--------------------------|------------------------------------------------|
| `get_snapshot`           | `snapshot`                                     |
| `get_session_list`       | `session_list`                                 |
| `get_session_history`    | `session_history`                              |
| `get_usage`              | `usage`                                        |
| `subscribe`              | `subscribed`                                   |
| `unsubscribe`            | `unsubscribed`                                 |
| `subscribe_agent_log`    | `subscribed_agent_log`, then `agent_log` lines |
| `unsubscribe_agent_log`  | `unsubscribed_agent_log`                       |
| `replay`                 | Buffered events with seq > lastSeq             |

## Replay / Reconnection

Every server event carries a monotonically increasing `seq` number. After
reconnecting, send a `replay` message with the last `seq` you received to
catch up on missed events from the server's ring buffer.

## Hook Integration

Claude Code hooks can POST to `POST /hook` to emit events in real-time.
Each hook type generates a `hook.<snake_case>` event. Tool-related hooks
also produce `hook.started` / `hook.completed` summary events, and some
hooks produce derived events in other namespaces (e.g. `mcp.*`, `file.*`,
`cwd.*`, `agent.*`).

## Table of Contents

* [Servers](#servers)
  * [localhost](#localhost-server)
* [Operations](#operations)
  * [SEND session/*](#send-session-operation)
  * [SEND message/*](#send-message-operation)
  * [SEND tool/*](#send-tool-operation)
  * [SEND stream/*](#send-stream-operation)
  * [SEND agent/*](#send-agent-operation)
  * [SEND usage/*](#send-usage-operation)
  * [SEND hook/*](#send-hook-operation)
  * [SEND mcp/*](#send-mcp-operation)
  * [SEND file/*](#send-file-operation)
  * [SEND cwd/*](#send-cwd-operation)
  * [SEND prompt/*](#send-prompt-operation)
  * [SEND system/*](#send-system-operation)
  * [REPLY /](#reply--operation)
  * [SEND /](#send--operation)

## Servers

### `localhost` Server

* URL: `ws://localhost:3838/`
* Protocol: `ws`

Default local server. Configure port via CLAW_SOCKET_PORT environment variable.


## Operations

### SEND `session/*` Operation

*Events tracking Claude Code session lifecycle. Published when sessions are discovered, started, change state, or are removed.*

* Operation ID: `send_session_events`

Events tracking Claude Code session lifecycle. Published when sessions are discovered, started, change state, or are removed.

Sending **one of** the following messages:

#### Message Session Discovered `session.discovered`

*A new Claude Code session file was found on disk.*

* Message ID: `session_discovered`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.pid | number | - | - | - | **required** |
| data.sessionId | string | - | - | - | **required** |
| data.cwd | string | - | - | - | **required** |
| data.startedAt | number | - | - | - | **required** |

> Examples of payload

_New session found_

```json
{
  "type": "session.discovered",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "pid": 12345,
    "sessionId": "abc123def456",
    "cwd": "/Users/alice/projects/myapp",
    "startedAt": 1699999995000
  }
}
```


#### Message Session Removed `session.removed`

*A Claude Code session ended or its file was removed.*

* Message ID: `session_removed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.sessionId | string | - | - | - | **required** |
| data.reason | string | - | allowed (`"process_exited"`, `"file_removed"`, `"manual"`) | - | **required** |

> Examples of payload

_Session ended_

```json
{
  "type": "session.removed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "sessionId": "abc123def456",
    "reason": "process_exited"
  }
}
```


#### Message Session Started `session.started`

*The Claude Code session initialized with model and tool configuration.*

* Message ID: `session_started`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.version | string | - | - | - | - |
| data.model | string | - | - | - | - |
| data.permissionMode | string | - | - | - | - |
| data.tools | array&lt;string&gt; | - | - | - | - |
| data.tools (single item) | string | - | - | - | - |
| data.agents | array&lt;string&gt; | - | - | - | - |
| data.agents (single item) | string | - | - | - | - |
| data.mcpServers | array&lt;string&gt; | - | - | - | - |
| data.mcpServers (single item) | string | - | - | - | - |
| data.cwd | string | - | - | - | - |

> Examples of payload

_Session initialized_

```json
{
  "type": "session.started",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "version": "1.0.0",
    "model": "claude-opus-4-5",
    "permissionMode": "default",
    "tools": [
      "Bash",
      "Read",
      "Write",
      "Edit"
    ],
    "cwd": "/Users/alice/projects/myapp"
  }
}
```


#### Message Session State Changed `session.state_changed`

*The session transitioned to a new state.*

* Message ID: `session_state_changed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.state | string | - | allowed (`"idle"`, `"running"`, `"requires_action"`) | - | **required** |

> Examples of payload

_Session now running_

```json
{
  "type": "session.state_changed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "state": "running"
  }
}
```



### SEND `message/*` Operation

*Events for conversation messages between user and Claude. Includes user prompts, assistant responses, and turn results.*

* Operation ID: `send_message_events`

Events for conversation messages between user and Claude. Includes user prompts, assistant responses, and turn results.

Sending **one of** the following messages:

#### Message User Message `message.user`

*A user prompt was submitted to Claude.*

* Message ID: `message_user`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.text | string | - | - | - | **required** |
| data.uuid | string | - | - | - | - |
| data.isSynthetic | boolean | - | - | - | - |

> Examples of payload

_User prompt_

```json
{
  "type": "message.user",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "text": "Can you help me refactor this TypeScript file?",
    "uuid": "msg-001"
  }
}
```


#### Message Assistant Message `message.assistant`

*Claude produced a response with content blocks.*

* Message ID: `message_assistant`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.contentBlocks | array&lt;oneOf&gt; | - | - | - | **required** |
| data.contentBlocks (single item) | oneOf | - | - | - | **additional properties are allowed** |
| data.contentBlocks.0 (oneOf item) | object | - | - | - | **additional properties are allowed** |
| data.contentBlocks.0.type | string | - | const (`"text"`) | - | **required**, **additional properties are allowed** |
| data.contentBlocks.0.text | string | - | - | - | **required** |
| data.contentBlocks.1 (oneOf item) | object | - | - | - | **additional properties are allowed** |
| data.contentBlocks.1.type | string | - | const (`"tool_use"`) | - | **required**, **additional properties are allowed** |
| data.contentBlocks.1.id | string | - | - | - | **required** |
| data.contentBlocks.1.name | string | - | - | - | **required** |
| data.contentBlocks.1.input | object | - | - | - | **required**, **additional properties are allowed** |
| data.contentBlocks.2 (oneOf item) | object | - | - | - | **additional properties are allowed** |
| data.contentBlocks.2.type | string | - | const (`"thinking"`) | - | **required**, **additional properties are allowed** |
| data.contentBlocks.2.thinking | string | - | - | - | **required** |
| data.uuid | string | - | - | - | - |
| data.model | string | - | - | - | - |

> Examples of payload

_Text response_

```json
{
  "type": "message.assistant",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "contentBlocks": [
      {
        "type": "text",
        "text": "Sure! I can help with that. Let me read the file first."
      },
      {
        "type": "tool_use",
        "id": "toolu_01",
        "name": "Read",
        "input": {
          "file_path": "/src/foo.ts"
        }
      }
    ],
    "model": "claude-opus-4-5"
  }
}
```


#### Message Message Result `message.result`

*A conversation turn completed with timing and cost data.*

* Message ID: `message_result`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.subtype | string | - | allowed (`"success"`, `"error_during_execution"`, `"error_max_turns"`, `"error_max_budget_usd"`) | - | - |
| data.durationMs | number | - | - | - | - |
| data.durationApiMs | number | - | - | - | - |
| data.numTurns | number | - | - | - | - |
| data.totalCostUsd | number | - | - | - | - |
| data.usage | object | - | - | - | **additional properties are allowed** |
| data.usage.input_tokens | number | - | - | - | - |
| data.usage.output_tokens | number | - | - | - | - |
| data.usage.cache_read_tokens | number | - | - | - | - |
| data.usage.cache_creation_tokens | number | - | - | - | - |

> Examples of payload

_Successful turn_

```json
{
  "type": "message.result",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "subtype": "success",
    "durationMs": 3241,
    "durationApiMs": 2800,
    "numTurns": 2,
    "totalCostUsd": 0.0142,
    "usage": {
      "input_tokens": 1200,
      "output_tokens": 450,
      "cache_read_tokens": 800
    }
  }
}
```



### SEND `tool/*` Operation

*Events for tool invocations made by Claude. Covers the full lifecycle: started, completed, and failed.*

* Operation ID: `send_tool_events`

Events for tool invocations made by Claude. Covers the full lifecycle: started, completed, and failed.

Sending **one of** the following messages:

#### Message Tool Started `tool.started`

*Claude began executing a tool.*

* Message ID: `tool_started`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.toolName | string | - | - | - | **required** |
| data.toolUseId | string | - | - | - | **required** |
| data.inputSummary | string | - | - | - | **required** |

> Examples of payload

_Bash tool started_

```json
{
  "type": "tool.started",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "toolName": "Bash",
    "toolUseId": "toolu_01",
    "inputSummary": "ls -la /src"
  }
}
```


#### Message Tool Completed `tool.completed`

*A tool finished successfully.*

* Message ID: `tool_completed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.toolName | string | - | - | - | **required** |
| data.toolUseId | string | - | - | - | **required** |
| data.durationMs | number | - | - | - | **required** |
| data.outputSummary | string | - | - | - | **required** |

> Examples of payload

_Tool success_

```json
{
  "type": "tool.completed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "toolName": "Bash",
    "toolUseId": "toolu_01",
    "durationMs": 312,
    "outputSummary": "src/\nindex.ts\nserver.ts\n"
  }
}
```


#### Message Tool Failed `tool.failed`

*A tool execution failed or was interrupted.*

* Message ID: `tool_failed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.toolName | string | - | - | - | **required** |
| data.toolUseId | string | - | - | - | **required** |
| data.error | string | - | - | - | **required** |
| data.isInterrupt | boolean | - | - | - | - |

> Examples of payload

_Command failed_

```json
{
  "type": "tool.failed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "toolName": "Bash",
    "toolUseId": "toolu_02",
    "error": "Command exited with code 127: command not found",
    "isInterrupt": false
  }
}
```



### SEND `stream/*` Operation

*Real-time streaming deltas for text, thinking, and tool use input as they are generated by Claude.*

* Operation ID: `send_stream_events`

Real-time streaming deltas for text, thinking, and tool use input as they are generated by Claude.

Sending **one of** the following messages:

#### Message Text Delta `stream.delta`

*A chunk of streamed text content.*

* Message ID: `stream_delta`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.index | integer | - | - | - | - |
| data.text | string | - | - | - | **required** |

> Examples of payload

_Text chunk_

```json
{
  "type": "stream.delta",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "index": 0,
    "text": "Sure, let me "
  }
}
```


#### Message Thinking Delta `stream.thinking_delta`

*A chunk of streamed thinking/reasoning content.*

* Message ID: `stream_thinking_delta`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.index | integer | - | - | - | - |
| data.thinking | string | - | - | - | **required** |

> Examples of payload

_Thinking chunk_

```json
{
  "type": "stream.thinking_delta",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "index": 0,
    "thinking": "I need to read the file first..."
  }
}
```


#### Message Tool Use Input Delta `stream.tool_use_delta`

*A chunk of streamed JSON input for a tool_use block.*

* Message ID: `stream_tool_use_delta`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.index | integer | - | - | - | - |
| data.partialJson | string | - | - | - | **required** |

> Examples of payload

_Tool input chunk_

```json
{
  "type": "stream.tool_use_delta",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "index": 1,
    "partialJson": "{\"file_path\":\"/src"
  }
}
```



### SEND `agent/*` Operation

*Events for Claude Code agent lifecycle and status changes. Subagents are tracked independently with their own agentId.*

* Operation ID: `send_agent_events`

Events for Claude Code agent lifecycle and status changes. Subagents are tracked independently with their own agentId.

Sending **one of** the following messages:

#### Message Agent Started `agent.started`

*An agent (or subagent) began a session.*

* Message ID: `agent_started`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.agentId | string | - | - | - | **required** |
| data.agentType | string | - | - | - | **required** |
| data.cwd | string | - | - | - | - |
| data.parentToolUseId | string | - | - | - | - |
| data.source | string | "hook" when originating from a SubagentStart hook | - | - | - |

> Examples of payload

_Subagent started_

```json
{
  "type": "agent.started",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "agentId": "agent-001",
    "agentType": "subagent",
    "cwd": "/Users/alice/projects/myapp",
    "parentToolUseId": "toolu_03"
  }
}
```


#### Message Agent Stopped `agent.stopped`

*An agent completed or was terminated.*

* Message ID: `agent_stopped`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.agentId | string | - | - | - | **required** |
| data.reason | string | - | - | - | - |
| data.source | string | - | - | - | - |

> Examples of payload

_Agent completed_

```json
{
  "type": "agent.stopped",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "agentId": "agent-001",
    "reason": "completed"
  }
}
```


#### Message Agent State Changed `agent.state_changed`

*One or more agents in a session changed status (working, tool_running, idle, offline).*

* Message ID: `agent_state_changed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.agents | array&lt;object&gt; | - | - | - | **required** |
| data.agents.agentId | string | - | - | - | **required** |
| data.agents.agentType | string | - | - | - | **required** |
| data.agents.sessionId | string | - | - | - | **required** |
| data.agents.status | string | - | allowed (`"working"`, `"tool_running"`, `"idle"`, `"offline"`) | - | **required** |
| data.agents.currentTool | string | - | - | - | - |
| data.agents.currentToolInput | string | - | - | - | - |
| data.agents.startedAt | number | - | - | - | **required** |
| data.agents.lastActivityAt | number | - | - | - | **required** |
| data.agents.toolCount | number | - | - | - | **required** |
| data.agents.tokenCount | number | - | - | - | **required** |
| data.agents.cwd | string | - | - | - | **required** |
| data.agents.name | string | - | - | - | - |
| data.agents.toolHistory | array&lt;object&gt; | - | - | - | **required** |
| data.agents.toolHistory (single item) | object | - | - | - | **additional properties are allowed** |

> Examples of payload

_Agent now working_

```json
{
  "type": "agent.state_changed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "agents": [
      {
        "agentId": "agent-001",
        "agentType": "primary",
        "sessionId": "abc123def456",
        "status": "working",
        "startedAt": 1699999990000,
        "lastActivityAt": 1700000000000,
        "toolCount": 5,
        "tokenCount": 3200,
        "cwd": "/Users/alice/projects/myapp",
        "toolHistory": []
      }
    ]
  }
}
```



### SEND `usage/*` Operation

*Token usage and cost tracking events, emitted per session and globally.*

* Operation ID: `send_usage_events`

Token usage and cost tracking events, emitted per session and globally.

Sending **one of** the following messages:

#### Message Usage Update `usage.update`

*Cumulative token and cost totals for a session were updated.*

* Message ID: `usage_update`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.inputTokens | number | - | - | - | - |
| data.outputTokens | number | - | - | - | - |
| data.cacheCreationInputTokens | number | - | - | - | - |
| data.cacheReadInputTokens | number | - | - | - | - |
| data.totalCostUsd | number | - | - | - | - |
| data.durationMs | number | - | - | - | - |
| data.numTurns | number | - | - | - | - |

> Examples of payload

_Usage totals_

```json
{
  "type": "usage.update",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "inputTokens": 5200,
    "outputTokens": 1800,
    "cacheCreationInputTokens": 1200,
    "cacheReadInputTokens": 2000,
    "totalCostUsd": 0.0842,
    "durationMs": 45000,
    "numTurns": 8
  }
}
```


#### Message Usage Rate Limit `usage.rate_limit`

*A rate limit was encountered during the session.*

* Message ID: `usage_rate_limit`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.allowed | boolean | - | - | - | - |
| data.type | string | - | - | - | - |
| data.message | string | - | - | - | - |
| data.retryAfter | number | - | - | - | - |

> Examples of payload

_Rate limit hit_

```json
{
  "type": "usage.rate_limit",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "allowed": false,
    "type": "requests_per_minute",
    "message": "Rate limited",
    "retryAfter": 60
  }
}
```


#### Message Usage Context `usage.context`

*Context window usage reported for a session.*

* Message ID: `usage_context`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.percentUsed | number | - | - | - | - |
| data.tokensUsed | number | - | - | - | - |
| data.tokensMax | number | - | - | - | - |
| data.categories | object | - | - | - | - |
| data.categories (additional properties) | number | - | - | - | - |

> Examples of payload

_Context usage_

```json
{
  "type": "usage.context",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "percentUsed": 22.5,
    "tokensUsed": 45000,
    "tokensMax": 200000
  }
}
```



### SEND `hook/*` Operation

*Events emitted from Claude Code hooks. Every hook POST to `/hook` produces a `hook.<snake_case_type>` event with the raw hook data. Tool-related hooks also produce `hook.started` / `hook.completed` summary events.*

* Operation ID: `send_hook_events`

Events emitted from Claude Code hooks. Every hook POST to `/hook` produces a `hook.<snake_case_type>` event with the raw hook data. Tool-related hooks also produce `hook.started` / `hook.completed` summary events.

Sending **one of** the following messages:

#### Message Hook: Pre Tool Use `hook.pre_tool_use`

*Claude Code fired a PreToolUse hook before invoking a tool.*

* Message ID: `hook_pre_tool_use`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.tool_name | string | - | - | - | - |
| data.tool_input | object | - | - | - | **additional properties are allowed** |
| data.toolName | string | - | - | - | - |
| data.toolUseId | string | - | - | - | - |
| data.inputSummary | string | - | - | - | - |

> Examples of payload

_Pre-tool hook_

```json
{
  "type": "hook.pre_tool_use",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "tool_name": "Bash",
    "tool_input": {
      "command": "npm test"
    },
    "toolName": "Bash",
    "toolUseId": "toolu_01",
    "inputSummary": "{\"command\":\"npm test\"}"
  }
}
```


#### Message Hook: Post Tool Use `hook.post_tool_use`

*Claude Code fired a PostToolUse hook after a tool completed successfully.*

* Message ID: `hook_post_tool_use`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.tool_name | string | - | - | - | - |
| data.tool_input | object | - | - | - | **additional properties are allowed** |
| data.tool_response | object | - | - | - | **additional properties are allowed** |
| data.toolName | string | - | - | - | - |
| data.toolUseId | string | - | - | - | - |
| data.outputSummary | string | - | - | - | - |

> Examples of payload

_Post-tool hook_

```json
{
  "type": "hook.post_tool_use",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "tool_name": "Bash",
    "tool_input": {
      "command": "npm test"
    },
    "tool_response": {
      "output": "All tests passed."
    },
    "toolName": "Bash"
  }
}
```


#### Message Hook: Post Tool Use Failure `hook.post_tool_use_failure`

*Claude Code fired a PostToolUseFailure hook after a tool failed.*

* Message ID: `hook_post_tool_use_failure`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.tool_name | string | - | - | - | - |
| data.tool_input | object | - | - | - | **additional properties are allowed** |
| data.error | string | - | - | - | - |
| data.toolName | string | - | - | - | - |
| data.isInterrupt | boolean | - | - | - | - |

> Examples of payload

_Tool failure hook_

```json
{
  "type": "hook.post_tool_use_failure",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "tool_name": "Bash",
    "tool_input": {
      "command": "rm -rf /"
    },
    "error": "Permission denied",
    "toolName": "Bash",
    "isInterrupt": false
  }
}
```


#### Message Hook Started `hook.started`

*Summary event: a hook began execution (emitted alongside PreToolUse).*

* Message ID: `hook_started`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.hookType | string | - | allowed (`"PreToolUse"`) | - | **required** |
| data.toolName | string | - | - | - | **required** |

> Examples of payload

_Hook started_

```json
{
  "type": "hook.started",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "hookType": "PreToolUse",
    "toolName": "Bash"
  }
}
```


#### Message Hook Completed `hook.completed`

*Summary event: a hook finished (emitted alongside PostToolUse / PostToolUseFailure).*

* Message ID: `hook_completed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.hookType | string | - | allowed (`"PostToolUse"`, `"PostToolUseFailure"`) | - | **required** |
| data.toolName | string | - | - | - | **required** |
| data.success | boolean | - | - | - | **required** |

> Examples of payload

_Hook completed_

```json
{
  "type": "hook.completed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "agentId": "agent-001",
  "data": {
    "hookType": "PostToolUse",
    "toolName": "Bash",
    "success": true
  }
}
```


#### Message Hook: Session Start `hook.session_start`

*Claude Code fired a SessionStart hook with initialization data.*

* Message ID: `hook_session_start`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.mcp_servers | array&lt;object&gt; | - | - | - | - |
| data.mcp_servers (single item) | object | - | - | - | **additional properties are allowed** |

> Examples of payload

_Session start hook_

```json
{
  "type": "hook.session_start",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "mcp_servers": [
      {
        "name": "my-server",
        "status": "connected"
      }
    ]
  }
}
```


#### Message Hook: Session End `hook.session_end`

*Claude Code fired a SessionEnd hook when the session terminated.*

* Message ID: `hook_session_end`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.reason | string | - | - | - | - |

> Examples of payload

_Session end hook_

```json
{
  "type": "hook.session_end",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "reason": "user_exit"
  }
}
```


#### Message Hook: Subagent Start `hook.subagent_start`

*Claude Code fired a SubagentStart hook when a subagent was spawned.*

* Message ID: `hook_subagent_start`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.agent_id | string | - | - | - | - |
| data.agent_type | string | - | - | - | - |
| data.cwd | string | - | - | - | - |

> Examples of payload

_Subagent start hook_

```json
{
  "type": "hook.subagent_start",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "agent_id": "agent-001",
    "agent_type": "subagent",
    "cwd": "/Users/alice/projects/myapp"
  }
}
```


#### Message Hook: Subagent Stop `hook.subagent_stop`

*Claude Code fired a SubagentStop hook when a subagent finished.*

* Message ID: `hook_subagent_stop`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.agent_id | string | - | - | - | - |

> Examples of payload

_Subagent stop hook_

```json
{
  "type": "hook.subagent_stop",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "agent_id": "agent-001"
  }
}
```


#### Message Hook: Stop `hook.stop`

*Claude Code fired a Stop hook.*

* Message ID: `hook_stop`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Stop hook_

```json
{
  "type": "hook.stop",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```


#### Message Hook: Permission Request `hook.permission_request`

*Claude Code fired a PermissionRequest hook when user approval is needed.*

* Message ID: `hook_permission_request`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.tool_name | string | - | - | - | - |
| data.tool_input | object | - | - | - | **additional properties are allowed** |

> Examples of payload

_Permission request_

```json
{
  "type": "hook.permission_request",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "tool_name": "Bash",
    "tool_input": {
      "command": "rm -rf /tmp/build"
    }
  }
}
```


#### Message Hook: Permission Denied `hook.permission_denied`

*Claude Code fired a PermissionDenied hook when the user denied a tool.*

* Message ID: `hook_permission_denied`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.tool_name | string | - | - | - | - |

> Examples of payload

_Permission denied_

```json
{
  "type": "hook.permission_denied",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "tool_name": "Bash"
  }
}
```


#### Message Hook: Notification `hook.notification`

*Claude Code fired a Notification hook.*

* Message ID: `hook_notification`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.message | string | - | - | - | - |

> Examples of payload

_Notification_

```json
{
  "type": "hook.notification",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "message": "Task completed"
  }
}
```


#### Message Hook: User Prompt Submit `hook.user_prompt_submit`

*Claude Code fired a UserPromptSubmit hook when the user submitted a prompt.*

* Message ID: `hook_user_prompt_submit`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.prompt | string | - | - | - | - |

> Examples of payload

_Prompt submitted_

```json
{
  "type": "hook.user_prompt_submit",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "prompt": "Fix the build"
  }
}
```


#### Message Hook: Pre Compact `hook.pre_compact`

*Claude Code fired a PreCompact hook before context compaction.*

* Message ID: `hook_pre_compact`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Pre-compact_

```json
{
  "type": "hook.pre_compact",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```


#### Message Hook: Post Compact `hook.post_compact`

*Claude Code fired a PostCompact hook after context compaction.*

* Message ID: `hook_post_compact`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Post-compact_

```json
{
  "type": "hook.post_compact",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```


#### Message Hook: Elicitation `hook.elicitation`

*Claude Code fired an Elicitation hook to request user input via MCP.*

* Message ID: `hook_elicitation`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.question | string | - | - | - | - |
| data.options | array&lt;object&gt; | - | - | - | - |
| data.options (single item) | object | - | - | - | **additional properties are allowed** |
| data.timeout | number | - | - | - | - |
| data.source | string | - | - | - | - |

> Examples of payload

_Elicitation_

```json
{
  "type": "hook.elicitation",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "question": "Which file?",
    "source": "my-mcp-server"
  }
}
```


#### Message Hook: Elicitation Result `hook.elicitation_result`

*Claude Code fired an ElicitationResult hook with the user's answer.*

* Message ID: `hook_elicitation_result`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.answer | string | - | - | - | - |
| data.source | string | - | - | - | - |

> Examples of payload

_Elicitation result_

```json
{
  "type": "hook.elicitation_result",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "answer": "src/index.ts",
    "source": "my-mcp-server"
  }
}
```


#### Message Hook: Config Change `hook.config_change`

*Claude Code fired a ConfigChange hook when configuration was modified.*

* Message ID: `hook_config_change`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Config change_

```json
{
  "type": "hook.config_change",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```


#### Message Hook: Instructions Loaded `hook.instructions_loaded`

*Claude Code fired an InstructionsLoaded hook.*

* Message ID: `hook_instructions_loaded`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Instructions loaded_

```json
{
  "type": "hook.instructions_loaded",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```


#### Message Hook: CWD Changed `hook.cwd_changed`

*Claude Code fired a CwdChanged hook when the working directory changed.*

* Message ID: `hook_cwd_changed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.cwd | string | - | - | - | - |
| data.new_cwd | string | - | - | - | - |
| data.old_cwd | string | - | - | - | - |

> Examples of payload

_CWD changed hook_

```json
{
  "type": "hook.cwd_changed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "cwd": "/Users/alice/projects/other"
  }
}
```


#### Message Hook: File Changed `hook.file_changed`

*Claude Code fired a FileChanged hook when a file was modified.*

* Message ID: `hook_file_changed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.path | string | - | - | - | - |
| data.change_type | string | - | - | - | - |

> Examples of payload

_File changed hook_

```json
{
  "type": "hook.file_changed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "path": "/src/index.ts",
    "change_type": "modified"
  }
}
```


#### Message Hook: Task Created `hook.task_created`

*Claude Code fired a TaskCreated hook.*

* Message ID: `hook_task_created`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Task created_

```json
{
  "type": "hook.task_created",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```


#### Message Hook: Task Completed `hook.task_completed`

*Claude Code fired a TaskCompleted hook.*

* Message ID: `hook_task_completed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Task completed_

```json
{
  "type": "hook.task_completed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```


#### Message Hook: Teammate Idle `hook.teammate_idle`

*Claude Code fired a TeammateIdle hook.*

* Message ID: `hook_teammate_idle`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Teammate idle_

```json
{
  "type": "hook.teammate_idle",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```


#### Message Hook: Worktree Create `hook.worktree_create`

*Claude Code fired a WorktreeCreate hook.*

* Message ID: `hook_worktree_create`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Worktree create_

```json
{
  "type": "hook.worktree_create",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```


#### Message Hook: Worktree Remove `hook.worktree_remove`

*Claude Code fired a WorktreeRemove hook.*

* Message ID: `hook_worktree_remove`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |

> Examples of payload

_Worktree remove_

```json
{
  "type": "hook.worktree_remove",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {}
}
```



### SEND `mcp/*` Operation

*Events related to MCP (Model Context Protocol) servers and elicitation. Derived from Claude Code hooks.*

* Operation ID: `send_mcp_events`

Events related to MCP (Model Context Protocol) servers and elicitation. Derived from Claude Code hooks.

Sending **one of** the following messages:

#### Message MCP Server Status `mcp.server_status`

*Status of an MCP server reported during session initialization.*

* Message ID: `mcp_server_status`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.serverName | string | - | - | - | **required** |
| data.status | string | - | - | - | **required** |
| data.url | string | - | - | - | - |
| data.tools | array&lt;string&gt; | - | - | - | - |
| data.tools (single item) | string | - | - | - | - |

> Examples of payload

_Server connected_

```json
{
  "type": "mcp.server_status",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "serverName": "my-mcp-server",
    "status": "connected",
    "tools": [
      "search",
      "fetch"
    ]
  }
}
```


#### Message MCP Elicitation `mcp.elicitation`

*An MCP server requested user input via an elicitation hook.*

* Message ID: `mcp_elicitation`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.question | string | - | - | - | **required** |
| data.options | array&lt;object&gt; | - | - | - | - |
| data.options (single item) | object | - | - | - | **additional properties are allowed** |
| data.timeout | number | - | - | - | - |
| data.source | string | - | - | - | - |

> Examples of payload

_Elicitation prompt_

```json
{
  "type": "mcp.elicitation",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "question": "Which database to use?",
    "options": [
      {
        "label": "PostgreSQL"
      },
      {
        "label": "SQLite"
      }
    ],
    "source": "db-server"
  }
}
```


#### Message MCP Elicitation Result `mcp.elicitation_result`

*The user responded to an MCP elicitation prompt.*

* Message ID: `mcp_elicitation_result`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.answer | string | - | - | - | - |
| data.source | string | - | - | - | - |

> Examples of payload

_User answered_

```json
{
  "type": "mcp.elicitation_result",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "answer": "PostgreSQL",
    "source": "db-server"
  }
}
```



### SEND `file/*` Operation

*File system change notifications derived from Claude Code FileChanged hooks.*

* Operation ID: `send_file_events`

File system change notifications derived from Claude Code FileChanged hooks.

#### Message File Changed `file.changed`

*A file was created, modified, or deleted during the session.*

* Message ID: `file_changed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.path | string | - | - | - | **required** |
| data.changeType | string | e.g. created, modified, deleted | - | - | - |

> Examples of payload

_File modified_

```json
{
  "type": "file.changed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "path": "/src/index.ts",
    "changeType": "modified"
  }
}
```



### SEND `cwd/*` Operation

*Working directory change notifications derived from Claude Code CwdChanged hooks.*

* Operation ID: `send_cwd_events`

Working directory change notifications derived from Claude Code CwdChanged hooks.

#### Message Working Directory Changed `cwd.changed`

*The session's working directory changed.*

* Message ID: `cwd_changed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.newCwd | string | - | - | - | **required** |
| data.oldCwd | string | - | - | - | - |

> Examples of payload

_CWD changed_

```json
{
  "type": "cwd.changed",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "newCwd": "/Users/alice/projects/other",
    "oldCwd": "/Users/alice/projects/myapp"
  }
}
```



### SEND `prompt/*` Operation

*Events related to AI-generated prompt suggestions.*

* Operation ID: `send_prompt_events`

Events related to AI-generated prompt suggestions.

#### Message Prompt Suggestion `prompt.suggestion`

*Claude generated suggested follow-up prompts.*

* Message ID: `prompt_suggestion`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.suggestions | array&lt;string&gt; | - | - | - | **required** |
| data.suggestions (single item) | string | - | - | - | - |

> Examples of payload

_Suggestions_

```json
{
  "type": "prompt.suggestion",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "suggestions": [
      "Run the tests",
      "Deploy to staging"
    ]
  }
}
```



### SEND `system/*` Operation

*Internal server events such as errors. Broadcast to all connected clients regardless of subscriptions.*

* Operation ID: `send_system_events`

Internal server events such as errors. Broadcast to all connected clients regardless of subscriptions.

#### Message System Error `system.error`

*An internal server error occurred.*

* Message ID: `system_error`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | - | - | **required** |
| timestamp | number | Unix epoch milliseconds | - | - | **required** |
| sessionId | string | - | - | - | **required** |
| agentId | string | Present for agent-scoped events | - | - | - |
| seq | integer | Monotonically increasing replay sequence number | - | >= 0 | **required** |
| data | object | - | - | - | **required**, **additional properties are allowed** |
| data.source | string | - | - | - | **required** |
| data.message | string | - | - | - | **required** |
| data.recoverable | boolean | - | - | - | **required** |

> Examples of payload

_Recoverable error_

```json
{
  "type": "system.error",
  "timestamp": 1700000000000,
  "sessionId": "abc123def456",
  "seq": 1,
  "data": {
    "source": "session_watcher",
    "message": "An internal error occurred; the server is continuing.",
    "recoverable": true
  }
}
```



### REPLY `/` Operation

*Messages the client sends to the server over the WebSocket connection to subscribe, query, and control event streams.*

* Operation ID: `clientCommands`

Messages the client sends to the server over the WebSocket connection to subscribe, query, and control event streams.

Request contains **one of** the following messages:

#### Message Subscribe `subscribe`

*Subscribe to one or more event topics. Supports exact names and glob patterns (e.g. `session.*`, `tool.*`).*

* Message ID: `subscribe`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"subscribe"`) | - | **required**, **additional properties are allowed** |
| topics | array&lt;string&gt; | - | - | non-empty | **required** |
| topics (single item) | string | - | - | - | - |
| sessionId | string | Optional session filter — only receive events for this session. | - | - | - |

> Examples of payload

_Subscribe to all tool events_

```json
{
  "type": "subscribe",
  "topics": [
    "tool.*"
  ],
  "sessionId": "abc123def456"
}
```


#### Message Unsubscribe `unsubscribe`

*Unsubscribe from one or more previously subscribed topics.*

* Message ID: `unsubscribe`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"unsubscribe"`) | - | **required**, **additional properties are allowed** |
| topics | array&lt;string&gt; | - | - | non-empty | **required** |
| topics (single item) | string | - | - | - | - |

> Examples of payload

_Unsubscribe from tool events_

```json
{
  "type": "unsubscribe",
  "topics": [
    "tool.*"
  ]
}
```


#### Message Get Snapshot `get_snapshot`

*Request the current snapshot of all sessions and agents. Server responds with a `snapshot` message.*

* Message ID: `get_snapshot`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"get_snapshot"`) | - | **required**, **additional properties are allowed** |

> Examples of payload

_Request snapshot_

```json
{
  "type": "get_snapshot"
}
```


#### Message Get Session List `get_session_list`

*Request the list of all known sessions. Server responds with a `session_list` message.*

* Message ID: `get_session_list`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"get_session_list"`) | - | **required**, **additional properties are allowed** |

> Examples of payload

_Request session list_

```json
{
  "type": "get_session_list"
}
```


#### Message Get Session History `get_session_history`

*Request parsed event history for a session. Server responds with a `session_history` message.*

* Message ID: `get_session_history`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"get_session_history"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | **required** |
| limit | integer | Maximum events to return (default: 1000) | - | >= 1 | - |

> Examples of payload

_Last 100 events_

```json
{
  "type": "get_session_history",
  "sessionId": "abc123def456",
  "limit": 100
}
```


#### Message Subscribe Agent Log `subscribe_agent_log`

*Subscribe to raw JSONL log lines for a session. The server will forward each line as an `agent_log` message.*

* Message ID: `subscribe_agent_log`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"subscribe_agent_log"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | **required** |

> Examples of payload

_Stream raw log_

```json
{
  "type": "subscribe_agent_log",
  "sessionId": "abc123def456"
}
```


#### Message Unsubscribe Agent Log `unsubscribe_agent_log`

*Unsubscribe from raw JSONL log lines. Omit sessionId to clear all agent log subscriptions.*

* Message ID: `unsubscribe_agent_log`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"unsubscribe_agent_log"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | If omitted, clears all agent log subscriptions. | - | - | - |

> Examples of payload

_Stop streaming log_

```json
{
  "type": "unsubscribe_agent_log",
  "sessionId": "abc123def456"
}
```


#### Message Get Usage `get_usage`

*Request usage totals. Omit sessionId for global totals. Server responds with a `usage` message.*

* Message ID: `get_usage`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"get_usage"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | If omitted, returns global totals across all sessions. | - | - | - |

> Examples of payload

_Global usage_

```json
{
  "type": "get_usage"
}
```


_Session usage_

```json
{
  "type": "get_usage",
  "sessionId": "abc123def456"
}
```


#### Message Replay `replay`

*Request replay of buffered events after a sequence number. Useful for reconnecting clients to catch up on missed events.*

* Message ID: `replay`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"replay"`) | - | **required**, **additional properties are allowed** |
| lastSeq | integer | Replay all buffered events with seq > lastSeq | - | >= 0 | **required** |

> Examples of payload

_Catch up from seq 42_

```json
{
  "type": "replay",
  "lastSeq": 42
}
```


#### Response information

* reply will be provided via this designated address: `/`
Replying with **one of** the following messages:

#### Message Snapshot `snapshot`

*Full state snapshot sent on connect and in response to get_snapshot.*

* Message ID: `snapshot`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"snapshot"`) | - | **required**, **additional properties are allowed** |
| sessions | array&lt;object&gt; | - | - | - | **required** |
| sessions.pid | number | - | - | - | **required** |
| sessions.sessionId | string | - | - | - | **required** |
| sessions.cwd | string | - | - | - | **required** |
| sessions.startedAt | number | - | - | - | **required** |
| sessions.discoveredAt | number | - | - | - | **required** |
| agents | array&lt;object&gt; | - | - | - | - |
| agents.agentId | string | - | - | - | **required** |
| agents.agentType | string | - | - | - | **required** |
| agents.sessionId | string | - | - | - | **required** |
| agents.status | string | - | allowed (`"working"`, `"tool_running"`, `"idle"`, `"offline"`) | - | **required** |
| agents.currentTool | string | - | - | - | - |
| agents.currentToolInput | string | - | - | - | - |
| agents.startedAt | number | - | - | - | **required** |
| agents.lastActivityAt | number | - | - | - | **required** |
| agents.toolCount | number | - | - | - | **required** |
| agents.tokenCount | number | - | - | - | **required** |
| agents.cwd | string | - | - | - | **required** |
| agents.name | string | - | - | - | - |
| agents.toolHistory | array&lt;object&gt; | - | - | - | **required** |
| agents.toolHistory.toolName | string | - | - | - | **required** |
| agents.toolHistory.inputSummary | string | - | - | - | **required** |
| agents.toolHistory.durationMs | number | - | - | - | **required** |
| agents.toolHistory.success | boolean | - | - | - | **required** |
| agents.toolHistory.startedAt | number | - | - | - | **required** |

> Examples of payload

_Initial snapshot_

```json
{
  "type": "snapshot",
  "sessions": [],
  "agents": []
}
```


#### Message Subscribed `subscribed`

*Acknowledgment after a successful subscribe command.*

* Message ID: `subscribed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"subscribed"`) | - | **required**, **additional properties are allowed** |
| topics | array&lt;string&gt; | - | - | - | **required** |
| topics (single item) | string | - | - | - | - |

> Examples of payload

_Subscribed ack_

```json
{
  "type": "subscribed",
  "topics": [
    "tool.*",
    "session.*"
  ]
}
```


#### Message Unsubscribed `unsubscribed`

*Acknowledgment after a successful unsubscribe command.*

* Message ID: `unsubscribed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"unsubscribed"`) | - | **required**, **additional properties are allowed** |
| topics | array&lt;string&gt; | - | - | - | **required** |
| topics (single item) | string | - | - | - | - |

> Examples of payload

_Unsubscribed ack_

```json
{
  "type": "unsubscribed",
  "topics": [
    "session.*"
  ]
}
```


#### Message Session List `session_list`

*List of all known sessions, in response to get_session_list.*

* Message ID: `session_list`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"session_list"`) | - | **required**, **additional properties are allowed** |
| sessions | array&lt;object&gt; | - | - | - | **required** |
| sessions.pid | number | - | - | - | **required** |
| sessions.sessionId | string | - | - | - | **required** |
| sessions.cwd | string | - | - | - | **required** |
| sessions.startedAt | number | - | - | - | **required** |
| sessions.discoveredAt | number | - | - | - | **required** |

> Examples of payload

_Session list_

```json
{
  "type": "session_list",
  "sessions": []
}
```


#### Message Session History `session_history`

*Parsed event history for a session, in response to get_session_history.*

* Message ID: `session_history`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"session_history"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | **required** |
| events | array&lt;object&gt; | - | - | - | **required** |
| events.type | string | - | - | - | **required** |
| events.timestamp | number | - | - | - | **required** |
| events.sessionId | string | - | - | - | **required** |
| events.agentId | string | - | - | - | - |
| events.data | object | - | - | - | **required** |
| events.data (additional properties) | any | - | - | - | - |
| events.seq | integer | - | - | >= 0 | - |

> Examples of payload

_Session history_

```json
{
  "type": "session_history",
  "sessionId": "abc123def456",
  "events": []
}
```


#### Message Usage `usage`

*Usage totals (session or global), in response to get_usage.*

* Message ID: `usage`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"usage"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | - |
| inputTokens | number | - | - | - | - |
| outputTokens | number | - | - | - | - |
| cacheCreationInputTokens | number | - | - | - | - |
| cacheReadInputTokens | number | - | - | - | - |
| totalCostUsd | number | - | - | - | - |
| durationMs | number | - | - | - | - |
| durationApiMs | number | - | - | - | - |
| numTurns | number | - | - | - | - |
| modelBreakdown | object | - | - | - | **additional properties are allowed** |
| lastUpdatedAt | number | - | - | - | - |

> Examples of payload

_Global usage_

```json
{
  "type": "usage",
  "inputTokens": 10000,
  "outputTokens": 3000,
  "totalCostUsd": 0.15
}
```


#### Message Subscribed Agent Log `subscribed_agent_log`

*Acknowledgment after subscribing to raw JSONL log lines.*

* Message ID: `subscribed_agent_log`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"subscribed_agent_log"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | **required** |

> Examples of payload

_Agent log subscribed_

```json
{
  "type": "subscribed_agent_log",
  "sessionId": "abc123def456"
}
```


#### Message Unsubscribed Agent Log `unsubscribed_agent_log`

*Acknowledgment after unsubscribing from raw JSONL log lines.*

* Message ID: `unsubscribed_agent_log`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"unsubscribed_agent_log"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | - |

> Examples of payload

_Agent log unsubscribed_

```json
{
  "type": "unsubscribed_agent_log",
  "sessionId": null
}
```


#### Message Agent Log Line `agent_log`

*A raw JSONL log line forwarded from a watched session.*

* Message ID: `agent_log`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"agent_log"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | **required** |
| line | string | - | - | - | **required** |

> Examples of payload

_Raw log line_

```json
{
  "type": "agent_log",
  "sessionId": "abc123def456",
  "line": "{\"type\":\"assistant\",\"message\":{\"content\":[...]}}"
}
```


#### Message Error `error`

*Error response to an invalid or failed client command.*

* Message ID: `error`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| error | string | - | - | - | **required** |
| message | string | - | - | - | - |

> Examples of payload

_Invalid JSON_

```json
{
  "error": "invalid JSON"
}
```


_Rate limited_

```json
{
  "error": "rate_limited",
  "message": "max 2 concurrent get_session_history requests"
}
```




### SEND `/` Operation

*Messages sent from the server to the client in response to client commands, or on initial connection.*

* Operation ID: `send_server_responses`

Messages sent from the server to the client in response to client commands, or on initial connection.

Sending **one of** the following messages:

#### Message Snapshot `snapshot`

*Full state snapshot sent on connect and in response to get_snapshot.*

* Message ID: `snapshot`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"snapshot"`) | - | **required**, **additional properties are allowed** |
| sessions | array&lt;object&gt; | - | - | - | **required** |
| sessions.pid | number | - | - | - | **required** |
| sessions.sessionId | string | - | - | - | **required** |
| sessions.cwd | string | - | - | - | **required** |
| sessions.startedAt | number | - | - | - | **required** |
| sessions.discoveredAt | number | - | - | - | **required** |
| agents | array&lt;object&gt; | - | - | - | - |
| agents.agentId | string | - | - | - | **required** |
| agents.agentType | string | - | - | - | **required** |
| agents.sessionId | string | - | - | - | **required** |
| agents.status | string | - | allowed (`"working"`, `"tool_running"`, `"idle"`, `"offline"`) | - | **required** |
| agents.currentTool | string | - | - | - | - |
| agents.currentToolInput | string | - | - | - | - |
| agents.startedAt | number | - | - | - | **required** |
| agents.lastActivityAt | number | - | - | - | **required** |
| agents.toolCount | number | - | - | - | **required** |
| agents.tokenCount | number | - | - | - | **required** |
| agents.cwd | string | - | - | - | **required** |
| agents.name | string | - | - | - | - |
| agents.toolHistory | array&lt;object&gt; | - | - | - | **required** |
| agents.toolHistory.toolName | string | - | - | - | **required** |
| agents.toolHistory.inputSummary | string | - | - | - | **required** |
| agents.toolHistory.durationMs | number | - | - | - | **required** |
| agents.toolHistory.success | boolean | - | - | - | **required** |
| agents.toolHistory.startedAt | number | - | - | - | **required** |

> Examples of payload

_Initial snapshot_

```json
{
  "type": "snapshot",
  "sessions": [],
  "agents": []
}
```


#### Message Subscribed `subscribed`

*Acknowledgment after a successful subscribe command.*

* Message ID: `subscribed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"subscribed"`) | - | **required**, **additional properties are allowed** |
| topics | array&lt;string&gt; | - | - | - | **required** |
| topics (single item) | string | - | - | - | - |

> Examples of payload

_Subscribed ack_

```json
{
  "type": "subscribed",
  "topics": [
    "tool.*",
    "session.*"
  ]
}
```


#### Message Unsubscribed `unsubscribed`

*Acknowledgment after a successful unsubscribe command.*

* Message ID: `unsubscribed`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"unsubscribed"`) | - | **required**, **additional properties are allowed** |
| topics | array&lt;string&gt; | - | - | - | **required** |
| topics (single item) | string | - | - | - | - |

> Examples of payload

_Unsubscribed ack_

```json
{
  "type": "unsubscribed",
  "topics": [
    "session.*"
  ]
}
```


#### Message Session List `session_list`

*List of all known sessions, in response to get_session_list.*

* Message ID: `session_list`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"session_list"`) | - | **required**, **additional properties are allowed** |
| sessions | array&lt;object&gt; | - | - | - | **required** |
| sessions.pid | number | - | - | - | **required** |
| sessions.sessionId | string | - | - | - | **required** |
| sessions.cwd | string | - | - | - | **required** |
| sessions.startedAt | number | - | - | - | **required** |
| sessions.discoveredAt | number | - | - | - | **required** |

> Examples of payload

_Session list_

```json
{
  "type": "session_list",
  "sessions": []
}
```


#### Message Session History `session_history`

*Parsed event history for a session, in response to get_session_history.*

* Message ID: `session_history`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"session_history"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | **required** |
| events | array&lt;object&gt; | - | - | - | **required** |
| events.type | string | - | - | - | **required** |
| events.timestamp | number | - | - | - | **required** |
| events.sessionId | string | - | - | - | **required** |
| events.agentId | string | - | - | - | - |
| events.data | object | - | - | - | **required** |
| events.data (additional properties) | any | - | - | - | - |
| events.seq | integer | - | - | >= 0 | - |

> Examples of payload

_Session history_

```json
{
  "type": "session_history",
  "sessionId": "abc123def456",
  "events": []
}
```


#### Message Usage `usage`

*Usage totals (session or global), in response to get_usage.*

* Message ID: `usage`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"usage"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | - |
| inputTokens | number | - | - | - | - |
| outputTokens | number | - | - | - | - |
| cacheCreationInputTokens | number | - | - | - | - |
| cacheReadInputTokens | number | - | - | - | - |
| totalCostUsd | number | - | - | - | - |
| durationMs | number | - | - | - | - |
| durationApiMs | number | - | - | - | - |
| numTurns | number | - | - | - | - |
| modelBreakdown | object | - | - | - | **additional properties are allowed** |
| lastUpdatedAt | number | - | - | - | - |

> Examples of payload

_Global usage_

```json
{
  "type": "usage",
  "inputTokens": 10000,
  "outputTokens": 3000,
  "totalCostUsd": 0.15
}
```


#### Message Subscribed Agent Log `subscribed_agent_log`

*Acknowledgment after subscribing to raw JSONL log lines.*

* Message ID: `subscribed_agent_log`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"subscribed_agent_log"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | **required** |

> Examples of payload

_Agent log subscribed_

```json
{
  "type": "subscribed_agent_log",
  "sessionId": "abc123def456"
}
```


#### Message Unsubscribed Agent Log `unsubscribed_agent_log`

*Acknowledgment after unsubscribing from raw JSONL log lines.*

* Message ID: `unsubscribed_agent_log`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"unsubscribed_agent_log"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | - |

> Examples of payload

_Agent log unsubscribed_

```json
{
  "type": "unsubscribed_agent_log",
  "sessionId": null
}
```


#### Message Agent Log Line `agent_log`

*A raw JSONL log line forwarded from a watched session.*

* Message ID: `agent_log`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| type | string | - | const (`"agent_log"`) | - | **required**, **additional properties are allowed** |
| sessionId | string | - | - | - | **required** |
| line | string | - | - | - | **required** |

> Examples of payload

_Raw log line_

```json
{
  "type": "agent_log",
  "sessionId": "abc123def456",
  "line": "{\"type\":\"assistant\",\"message\":{\"content\":[...]}}"
}
```


#### Message Error `error`

*Error response to an invalid or failed client command.*

* Message ID: `error`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | - | - | - | **additional properties are allowed** |
| error | string | - | - | - | **required** |
| message | string | - | - | - | - |

> Examples of payload

_Invalid JSON_

```json
{
  "error": "invalid JSON"
}
```


_Rate limited_

```json
{
  "error": "rate_limited",
  "message": "max 2 concurrent get_session_history requests"
}
```



