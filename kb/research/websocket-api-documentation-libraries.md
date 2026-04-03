---
title: WebSocket API Documentation Libraries Research
date: 2026-04-02
status: complete
tags:
  - asyncapi
  - websocket
  - documentation
  - bun
  - typescript
type: research
---

# WebSocket API Documentation Libraries for Bun/TypeScript

## 1. AsyncAPI Specification (The Standard)

AsyncAPI is the **de facto standard** for documenting event-driven/async APIs, analogous to OpenAPI for REST. Currently at **v3.0.0**.

### Structure
```yaml
asyncapi: 3.0.0
info:
  title: My WebSocket API
  version: 1.0.0
servers:
  production:
    host: example.com
    protocol: ws
channels:
  userEvents:
    address: /users/{userId}
    messages:
      userSignedUp:
        payload:
          type: object
          properties:
            name: { type: string }
operations:
  onUserSignUp:
    action: receive
    channel:
      $ref: '#/channels/userEvents'
```

### Key Concepts
- **Channels**: Named communication pathways (like REST endpoints)
- **Operations**: `send` or `receive` actions on channels
- **Messages**: Payload + headers definitions using JSON Schema
- **Bindings**: Protocol-specific details (ws, mqtt, kafka, etc.)
- **Components**: Reusable definitions (like OpenAPI components)

### Pros
- Industry standard, large ecosystem
- Protocol-agnostic (ws, mqtt, kafka, amqp)
- JSON Schema-based payload validation
- Active community, backed by Linux Foundation

### Cons
- Tooling maturity varies (some tools lag behind v3.0)
- No native Bun support in generators
- Maintainer shortage reported for some core tools
- Learning curve if coming from OpenAPI

---

## 2. AsyncAPI Ecosystem Tools

### Documentation UIs

#### AsyncAPI Studio (studio.asyncapi.com)
- **What**: Visual editor + preview for AsyncAPI documents
- **Tech**: React + TypeScript
- **Pros**: Official tool, supports v3.0, live preview, visual editor
- **Cons**: Web-only, no embeddable server-side version

#### AsyncAPI React Component (`@asyncapi/react-component`)
- **What**: React component for rendering AsyncAPI docs in-browser
- **Tech**: React, also available as Web Component and standalone bundle
- **Pros**: Embed in any app, real-time rendering, framework-agnostic via Web Component
- **Cons**: React dependency (unless using standalone bundle)
- **Usage**: Can be embedded in a static HTML page or any framework

#### AsyncAPI HTML Template (`@asyncapi/html-template`)
- **What**: Generates static HTML documentation from AsyncAPI specs
- **Tech**: Uses React component under the hood
- **Pros**: Static output, no runtime dependency, CI/CD friendly
- **Cons**: Generated once, not interactive

### Code Generators

#### AsyncAPI Generator (`@asyncapi/generator`)
- **What**: Generate code/docs from AsyncAPI specs
- **Stars**: 1,000+
- **Version**: 3.2.0 (Feb 2026)
- **Templates**: 13 official (Node.js, Java, Python, TypeScript, Go, .NET, PHP, HTML, Markdown)
- **Pros**: Mature, extensible, many templates
- **Cons**: No Bun-native template yet, Node.js WebSocket template exists

#### AsyncAPI Modelina (`@asyncapi/modelina`)
- **What**: Generate data models from AsyncAPI specs
- **Languages**: TypeScript, Java, Go, Python, C#, etc.
- **Pros**: Focused on type generation, customizable
- **Cons**: Models only, no server/client scaffolding

### Validators

#### AsyncAPI Parser (JS/Go)
- Parses and validates AsyncAPI documents
- Available for JavaScript and Go

#### Spectral
- Linter for API specs (supports AsyncAPI v2.x)
- TypeScript-based, extensible rules

---

## 3. Zod Sockets (`zod-sockets`) - Best TypeScript-First Option

### What
Socket.IO solution with Zod-based I/O validation that auto-generates AsyncAPI 3.0 specs.

### Key Features
- TypeScript-first with full type inference
- Zod schema validation for all events (input/output)
- **Auto-generates AsyncAPI 3.0 specification**
- Generates client-side type contracts
- Builder pattern for event definitions

### API Example
```typescript
const onPing = actionsFactory.build({
  event: "ping",
  input: z.tuple([]).rest(z.unknown()),
  output: z.tuple([z.literal("pong")]).rest(z.unknown()),
  handler: async ({ input }) => ["pong", ...input] as const,
});
```

### Pros
- Define once, get types + validation + docs
- AsyncAPI 3.0 generation built-in
- Active maintenance (810 commits, 117 stars)
- Familiar Zod-based API

### Cons
- Socket.IO dependency (not raw WebSocket)
- **No confirmed Bun support** (Node.js focused)
- Smaller community than AsyncAPI core tools
- Socket.IO adds overhead vs raw WebSocket

---

## 4. Bun-Native WebSocket Options

### Bun Built-in WebSocket Server
```typescript
Bun.serve({
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("Upgrade failed", { status: 500 });
  },
  websocket: {
    message(ws, message) { },
    open(ws) { },
    close(ws, code, message) { },
    drain(ws) { }
  }
});
```

#### Features
- Zero dependencies, native Zig performance
- Built-in pub/sub (`ws.subscribe(topic)`, `ws.publish(topic, msg)`)
- TypeScript types via `ServerWebSocket<T>` with typed `data` property
- Handlers declared per-server (not per-socket) for efficiency
- Supports string, ArrayBuffer, TypedArray messages
- Backpressure handling via return codes

### ElysiaJS WebSocket (`elysia`)
- **What**: Bun-native framework with WebSocket support
- **Schema validation**: Full Zod/TypeBox validation for messages, query, params, headers
- **TypeScript**: Full type inference from schemas
- **Docs**: Has OpenAPI plugin for REST, but WebSocket docs are limited
- **Pros**: Bun-native, fast, good DX, schema validation built-in
- **Cons**: No AsyncAPI generation, WebSocket docs gap

### Socket.IO with Bun Engine
- Socket.IO now has a dedicated Bun engine
- Performance-optimized for Bun's native HTTP
- Enables using zod-sockets with Bun (potentially)

---

## 5. Recommendation Matrix

| Approach | Type Safety | Auto Docs | Bun Native | Maturity | Effort |
|----------|-------------|-----------|------------|----------|--------|
| Bun raw WS + manual AsyncAPI | Manual | Manual YAML | Yes | High | High |
| Elysia WS + manual AsyncAPI | Good (TypeBox) | No auto-gen | Yes | Medium | Medium |
| zod-sockets | Excellent (Zod) | AsyncAPI 3.0 | No (Socket.IO) | Medium | Low |
| Custom Bun WS + AsyncAPI gen | Custom | Generated | Yes | DIY | High |

## 6. Suggested Strategy for Claw-Socket

**Option A: Bun-native + AsyncAPI manual spec**
- Use Bun's built-in WebSocket server for performance
- Write AsyncAPI 3.0 spec manually (or generate from TypeScript types)
- Use `@asyncapi/react-component` or `@asyncapi/html-template` for docs UI
- Use `@asyncapi/modelina` to generate client types from spec

**Option B: Build a thin abstraction**
- Create a Zod-schema-based message definition layer on top of Bun WebSocket
- Auto-generate AsyncAPI spec from those Zod schemas (similar to what zod-sockets does)
- Serve docs via AsyncAPI React component
- This gives: Bun performance + type safety + auto documentation

**Option C: Elysia framework**
- Use Elysia for both REST and WebSocket
- Get TypeBox schema validation for free
- Manually maintain AsyncAPI spec for WebSocket docs
- Good if also need REST API alongside WebSocket

---

## Sources
- [AsyncAPI Specification v3.0.0](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
- [AsyncAPI Tools](https://www.asyncapi.com/tools)
- [AsyncAPI Generator](https://github.com/asyncapi/generator)
- [AsyncAPI React Component](https://github.com/asyncapi/asyncapi-react)
- [AsyncAPI HTML Template](https://github.com/asyncapi/html-template)
- [Zod Sockets](https://github.com/RobinTail/zod-sockets)
- [Bun WebSocket Docs](https://bun.com/docs/runtime/http/websockets)
- [ElysiaJS WebSocket](https://elysiajs.com/patterns/websocket)
- [AsyncAPI Studio](https://studio.asyncapi.com/)
- [AsyncAPI Modelina](https://modelina.org/)
- [Nordic APIs: AsyncAPI Documentation Generators](https://nordicapis.com/8-asyncapi-documentation-generators/)
