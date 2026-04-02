---
title: "Iteration 06: AsyncAPI Spec & Documentation UI"
description: Generate AsyncAPI 3.0 spec from Zod schemas, serve interactive docs
tags:
  - iteration
  - asyncapi
  - documentation
status: done
iteration: 6
---

# Iteration 06: AsyncAPI Spec & Documentation UI

## Goal
Auto-generate AsyncAPI 3.0 spec from our Zod schemas and serve an interactive documentation page.

## Tasks

- [x] Build Zod → AsyncAPI 3.0 generator (channels, operations, messages from Zod schemas)
- [x] Generate JSON Schema from Zod for each event payload
- [x] Define AsyncAPI server/channel/operation structure
- [x] WebSocket protocol bindings in spec
- [x] Serve AsyncAPI spec at `GET /asyncapi.json`
- [x] Integrate `@asyncapi/react-component` (or standalone bundle) for docs UI
- [x] Serve docs UI at `GET /docs`
- [x] Include example payloads for each event type
- [x] Connection guide in docs (how to subscribe, topic patterns)
- [x] Tests for spec generation
