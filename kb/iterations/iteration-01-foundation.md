---
title: "Iteration 01: Foundation"
description: Project setup, core types, basic WS server, session discovery
tags:
  - iteration
  - foundation
status: complete
iteration: 1
---

# Iteration 01: Foundation

## Goal
Get a working Bun WebSocket server that discovers Claude Code sessions and streams basic lifecycle events.

## Tasks

- [x] Initialize Bun project (`bun init`, tsconfig, .gitignore, package.json scripts)
- [x] Define core Zod schemas for all event envelope + session lifecycle events
- [x] Implement session discovery (watch `~/.claude/sessions/`, validate PIDs)
- [x] Implement basic WebSocket server with `Bun.serve()`
- [x] Send snapshot on client connect (active sessions list)
- [x] Broadcast `session.discovered` and `session.removed` events
- [x] Add liveness checker (periodic PID validation)
- [x] Basic client subscription protocol (subscribe/unsubscribe with topic patterns)
- [x] Unit tests for session discovery and event schemas
