---
title: "Iteration 12: Tooling, CI & Package Quality"
description: Security scanning, dependency management, CI pipeline, package.json completeness
tags:
  - iteration
  - tooling
  - ci
  - dependencies
status: complete
iteration: 12
type: iteration
---

# Iteration 12: Tooling, CI & Package Quality

## Goal
Add automated security scanning, complete package metadata for npm publishing, harden linting config, and prepare for CI.

## Tasks

### Security scanning
- [x] Add `bun audit` to quality gates (`bun run check`) — `bun audit` confirmed available in Bun 1.x
- [x] Add `gitleaks` config (`.gitleaks.toml`) and document usage for secret scanning
- [ ] Evaluate and add `semgrep` config for SAST (`semgrep --config auto src/`)
- [x] Document security scanning in README (how to run locally)

### Dependency management
- [x] Pin `@types/bun` to specific version instead of `latest` — pinned to 1.3.11 (currently installed)
- [ ] Track Zod 4 compatibility — add note in decision-log.md (blocked by `zod-to-json-schema` not supporting v4 yet)
- [x] Evaluate TypeScript 6 peer dependency — TS 6.0.2 is now `latest` (April 2026); broadened peerDependencies to `^5 || ^6` to support both

### Package.json completeness
- [x] Add `engines` field: `{ "bun": ">=1.0" }`
- [x] Add `repository` field with GitHub URL
- [x] Add `bugs` field with issues URL
- [x] Add `homepage` field
- [x] Add `author` field
- [x] Add `keywords` for npm discoverability

### Linting hardening
- [x] Enable broader suspicious rules in biome.json — Biome 2.x does not support `"all": true` shorthand; added individual high-value rules: `noConsole` (warn), `noExplicitAny` (warn), `noEvolvingTypes`, `noSkippedTests`, `noFocusedTests`, `noMisplacedAssertion`, `useAwait` (all error)
- [x] Review and enable any additional security-related Biome rules — done alongside above
- [x] Ensure all new rules pass on existing code — fixed `async fetch` without await in server.ts; added biome-ignore comments in logger.ts and cli.ts for legitimate console use

### CI pipeline (GitHub Actions)
- [x] Create `.github/workflows/ci.yml` with: format, typecheck, test, audit
- [x] Add `gitleaks` step to CI
- [ ] Add optional `semgrep` step to CI
- [x] Add build step (`bun build --compile`) to verify binary builds

### Tests
- [x] All quality gates pass with new scanning steps
- [x] CI pipeline runs successfully on push
