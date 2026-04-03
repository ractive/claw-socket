# Runtime bun

Always use bun instead of npm, yarn, pnpm and bunx instead of npx.

# Documentation

Keep all documentation in `./kb/` as `*.md` markdown files with YAML frontmatter (text, numbers, checkboxes, dates, lists). Use it as your second brain:
- Research outcomes → `research/`
- Design decisions → `decision-log.md`
- Iteration plans → `iterations/iteration-NN-slug.md` (one file per iteration, markdown task lists for steps/tasks/ACs)

Organize in subfolders. Use `[[wikilinks]]` for cross-references. Keep Obsidian-compatible.

# Quality gates

Run these in order before pushing or creating a PR. Stop at the first failure and fix it.

1. **Format + lint**: `bunx biome check --write src/ test/` — auto-fixes formatting and lint issues
2. **Typecheck**: `bun run typecheck` — `tsc --noEmit`, all errors must be resolved
3. **Tests**: `bun test` — all tests must pass

Shortcut: `bun run check` runs all three in sequence.

# AsyncAPI spec maintenance

After adding or changing any event type, hook mapping, client command, or server response:
update `src/asyncapi-generator.ts`. The spec is driven by a channel/message registry —
add new entries to the relevant `ChannelDef` or create a new one and register it in `CHANNEL_REGISTRY`.
Run `bun test test/asyncapi-generator.test.ts` to verify coverage.
