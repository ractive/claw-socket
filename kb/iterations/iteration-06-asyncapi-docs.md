---
title: "Iteration 06: AsyncAPI Spec & Documentation UI"
description: Generate AsyncAPI 3.0 spec from Zod schemas, serve interactive docs
tags: [iteration, asyncapi, documentation]
status: planned
iteration: 6
---

# Iteration 06: AsyncAPI Spec & Documentation UI

## Goal
Auto-generate AsyncAPI 3.0 spec from our Zod schemas and serve an interactive documentation page.

## Tasks

- [ ] Build Zod → AsyncAPI 3.0 generator (channels, operations, messages from Zod schemas)
- [ ] Generate JSON Schema from Zod for each event payload
- [ ] Define AsyncAPI server/channel/operation structure
- [ ] WebSocket protocol bindings in spec
- [ ] Serve AsyncAPI spec at `GET /asyncapi.json`
- [ ] Integrate `@asyncapi/react-component` (or standalone bundle) for docs UI
- [ ] Serve docs UI at `GET /docs`
- [ ] Include example payloads for each event type
- [ ] Connection guide in docs (how to subscribe, topic patterns)
- [ ] Tests for spec generation
