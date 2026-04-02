---
title: Code Formatting & Linting for Bun/TypeScript Projects
type: research
status: complete
date: 2026-04-02
tags: [formatting, linting, bun, typescript, biome, prettier, dprint, eslint]
---

# Code Formatting & Linting for Bun/TypeScript Projects

## 1. Does Bun Have a Built-in Formatter?

**No, not as of Bun 1.3.x (April 2026).** Despite Bun's docs listing `bun fmt` and `bun lint` as planned features, they are **not yet implemented** in the current stable release. Running `bun fmt` returns "Script not found". The feature has been tracked in [GitHub issue #2246](https://github.com/oven-sh/bun/issues/2246) since 2023 and remains open.

Unlike Deno (which ships `deno fmt` and `deno lint` built-in), Bun currently requires external tools for formatting and linting.

## 2. Popular Formatting Options (2025-2026)

### Prettier (incumbent)
- **Version:** 3.7+ (November 2025)
- **Speed:** Slowest of the three (~12s for 10k files)
- **Ecosystem:** Massive — supports JS/TS, CSS, HTML, JSON, Markdown, YAML, and many more
- **Maturity:** Rock solid, de facto standard
- **Config complexity:** Minimal, opinionated by design

### Biome (formerly Rome)
- **Version:** 2.3+ (January 2026)
- **Speed:** ~0.3s for 10k files (40x faster than Prettier)
- **Scope:** Formatter AND linter in a single binary
- **Lint rules:** 423+ rules, including type-aware linting (since v2.0, June 2025)
- **Architecture:** Single Rust binary, zero npm dependencies at runtime
- **Config:** One `biome.json` file for both formatting and linting

### dprint
- **Speed:** 10-100x faster than Prettier
- **Scope:** Formatter only (no linting)
- **Strengths:** Plugin architecture, supports many languages (Rust, TOML, Dockerfile, etc.)
- **Best for:** Multi-language codebases that only need formatting

### Other Notable Options
- **Oxlint** — Oxidation Compiler project's linter (very fast, Rust-based), but formatter not yet mature
- **ESLint + Prettier** — still the most common combo, but increasingly seen as heavyweight

## 3. Best Fit with Bun

**Biome is the best match for Bun projects:**
- Single `bun add -D @biomejs/biome` — one dependency, one binary
- Works via `bunx biome` or direct scripts in package.json
- No Node.js-specific tooling required
- Fastest option available
- Setup: `bun add -D -E @biomejs/biome && bunx @biomejs/biome init`

dprint is also a good fit if you only need formatting, but Biome's combined formatter+linter makes it more practical.

Prettier works fine with Bun but offers no special integration and is significantly slower.

## 4. Biome vs ESLint for Linting

| Aspect | Biome | ESLint |
|---|---|---|
| **Speed** | 10-56x faster | Baseline |
| **10k files lint** | ~0.8s | ~45s |
| **Rules** | 423+ (v2.3) | 1000+ with plugins |
| **Type-aware** | Yes (v2.0+, ~85% coverage vs typescript-eslint) | Yes (via typescript-eslint) |
| **Framework plugins** | Limited (React good, Vue/Angular lacking) | Extensive |
| **Config files** | 1 (biome.json) | 2-4 (.eslintrc, .prettierrc, etc.) |
| **Dependencies** | 1 package | 127+ packages typically |
| **Custom rules** | Plugins (v2.0+) | Mature plugin API |
| **Weekly downloads** | ~2M | ~79M |

**Bottom line:** Biome covers ~80% of what most JS/TS projects need. For React + TypeScript, it is a full ESLint replacement. For Vue/Angular or heavily customized setups, ESLint still wins.

## 5. Recommendation: Lightest-Weight Setup

### Winner: Biome alone

```bash
bun add -D -E @biomejs/biome
bunx @biomejs/biome init
```

**package.json scripts:**
```json
{
  "scripts": {
    "check": "biome check .",
    "check:fix": "biome check --write .",
    "format": "biome format --write .",
    "lint": "biome lint ."
  }
}
```

**Why this wins:**
- **1 dependency** (vs 10+ for ESLint + Prettier + plugins)
- **1 config file** (`biome.json`)
- **1 command** (`biome check`) does both formatting and linting
- **Sub-second** on typical project sizes
- **Zero configuration** works out of the box with sensible defaults
- Strong VS Code extension available

**Trade-off:** If you later need niche ESLint rules (e.g., `eslint-plugin-import` ordering, Angular-specific rules), you can add ESLint alongside Biome for just those rules. But for a Bun/TypeScript project starting fresh, Biome alone is the right call.
