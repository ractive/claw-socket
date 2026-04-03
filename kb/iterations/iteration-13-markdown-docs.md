---
title: "Iteration 13: Proper AsyncAPI Docs (HTML + Markdown)"
iteration: 13
status: completed
tags:
  - docs
  - dx
---

# Iteration 13: Proper AsyncAPI Docs (HTML + Markdown)

Replace the CDN-loaded `/docs` page with proper generated docs using the standard AsyncAPI CLI workflow. Two outputs: a self-contained HTML page (served from `/docs`) and a markdown reference (in `kb/docs/`).

## Motivation

The current `/docs` page loads `@asyncapi/react-component` from `unpkg.com` with hardcoded SRI hashes — stale version, likely broken rendering, CDN dependency. The standard tool for this is `@asyncapi/cli` with the official templates.

## Standard workflow (from AsyncAPI docs)

```bash
# 1. Export the spec from the running generator
bun run export-spec              # writes asyncapi.json to project root

# 2. Generate HTML docs (single self-contained file)
asyncapi generate fromTemplate asyncapi.json @asyncapi/html-template@3.5.4 \
  --param singleFile=true -o public --force-write

# 3. Generate markdown docs
asyncapi generate fromTemplate asyncapi.json @asyncapi/markdown-template@2.0.0 \
  --param outFilename=api-reference.md -o kb/docs --force-write

# 4. Patch sidebar layout bug in html-template output
bun run patch-docs
```

`asyncapi` = `bunx @asyncapi/cli` if not installed globally.

## Scope

- [x] Add `"export-spec"` script to `package.json`: runs `scripts/export-spec.ts` which calls `generateAsyncApiSpec()` and writes `asyncapi.json` to the project root
- [x] Add `asyncapi.json` to `.gitignore` (build artifact, regenerated from source)
- [x] Add `public/` to `.gitignore`
- [x] Update `GET /docs` in `src/http-handler.ts` to read and serve `public/index.html` from disk; return 503 with helpful message if not yet generated
- [x] Remove CDN HTML block, SRI constants, and CSP header from `src/http-handler.ts`
- [x] Commit generated `kb/docs/api-reference.md`
- [x] Document the three commands in `README.md` under "Docs generation"
- [x] Update tests (removed CSP assertions, added 503 branch coverage)
- [x] `bun run check` passes

## Notes

`scripts/export-spec.ts` post-processes the generated spec to strip `payload` from `messageTraits` before writing. The `@asyncapi/specs` 3.0 JSON schema has `additionalProperties: false` on messageTraits and excludes `payload`, causing the CLI generators to reject the spec. Each message carries its own full payload schema, so removing it from traits is safe.

`scripts/patch-docs.ts` injects a one-line CSS fix into `public/index.html` after generation. The `@asyncapi/html-template` inner fixed sidebar div expands beyond its `w-64` (256px) Tailwind container, overlapping the main content by ~66px. The fix constrains it to 256px. Idempotent — safe to re-run.

## Out of scope

- Wiring into `bun run build` — run manually as documented
- `/asyncapi.json` endpoint stays (useful for programmatic consumers)
- Custom styling

## Acceptance criteria

- [x] `bun run export-spec` writes a valid `asyncapi.json`
- [x] Running the two `asyncapi generate` commands produces `public/index.html` and `kb/docs/api-reference.md`
- [x] `GET /docs` serves the generated HTML; no external resource fetches
- [x] `GET /docs` returns a clear 503 if `public/index.html` has not been generated yet
- [x] No SRI hashes, no CDN URLs, no CSP header in `src/http-handler.ts`
- [x] `bun run check` passes
