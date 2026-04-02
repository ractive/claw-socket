---
title: "Iteration 08: Polish & Packaging"
description: CLI interface, binary build, graceful shutdown, reconnection, npm package
tags: [iteration, polish, packaging, cli]
status: planned
iteration: 8
---

# Iteration 08: Polish & Packaging

## Goal
Production-ready server with CLI, graceful shutdown, client reconnection support, and distributable package.

## Tasks

- [ ] CLI with flags (--port, --hook-port, --verbose, --no-hooks)
- [ ] Graceful shutdown (close WS connections, stop watchers, grace period)
- [ ] Client reconnection support (sequence numbers, replay buffer)
- [ ] Heartbeat / keep-alive pings
- [ ] Error handling & recovery (watcher failures, malformed JSONL)
- [ ] Logging (structured, configurable level)
- [ ] Build as standalone Bun binary (`bun build --compile`)
- [ ] npm package with `bin` entry
- [ ] Install script for hooks
- [ ] README with quickstart
- [ ] End-to-end integration tests
