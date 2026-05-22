# Software Best Design Patterns

2026-edition design-patterns reference for modern TypeScript (6.x, strict mode, native ESM).

This skill covers:
- All 23 GoF patterns
- Enterprise patterns (Repository, Unit of Work, Service Layer, DTO, Identity Map, Lazy Load)
- Modern TypeScript patterns (Result, Discriminated Union State, Branded Types, Type-State, DI, Hooks, Signals, Reducer, Middleware)
- Resilience patterns (Circuit Breaker, Retry + Backoff, Saga, Outbox, Idempotency)
- Cross-cutting references (principles, anti-patterns, testing, architecture styles)

## What are skills?

Skills are reusable capabilities for AI agents. They provide procedural knowledge that helps agents accomplish specific tasks more effectively, similar to plugins or extensions.

## Getting started

Install this skill with the skills CLI:

```bash
npx skills add gastonmorixe/software-best-design-patterns
```

Generic example from the skills docs:

```bash
npx skills add vercel-labs/agent-skills
```

The skills CLI that powers the leaderboard is open source:

- https://github.com/vercel-labs/skills

## How to discover and use this skill

1. Start with the decision trees and symptom table in [`SKILL.md`](./SKILL.md).
2. Open the recommended file under [`patterns/`](./patterns).
3. Use [`references/`](./references) for principles, anti-patterns, architecture, and testing guidance.
4. Apply the implementation checklist before merging.

## Quick lookup CLI

Use `scripts/find-pattern.ts` to find the right pattern file quickly:

```bash
./scripts/find-pattern.ts list
./scripts/find-pattern.ts search "growing switch"
./scripts/find-pattern.ts show strategy
./scripts/find-pattern.ts category modern
./scripts/find-pattern.ts symptoms
```

Alternatives:

```bash
node --experimental-strip-types scripts/find-pattern.ts list
bun scripts/find-pattern.ts list
deno run --allow-read scripts/find-pattern.ts list
```

## How skills are ranked

The skills leaderboard ranks skills using anonymous telemetry from the skills CLI. It tracks installed skills in aggregate to help surface useful and popular capabilities.

Telemetry is anonymous and only tracks which skills are installed.

## Browse skills

Browse the leaderboard and discover new skills:

- https://skills.sh

## Badge

Add an install count badge to your README:

```html
<a href="https://skills.sh/owner/repo"><img src="https://skills.sh/b/owner/repo"></a>
```

Replace `owner/repo` with your GitHub source. For this repository:

```html
<a href="https://skills.sh/gastonmorixe/software-best-design-patterns"><img src="https://skills.sh/b/gastonmorixe/software-best-design-patterns"></a>
```

## Security

Skills are routinely audited for malicious content. To report security issues, visit:

- https://security.vercel.com

## Repository structure

- `SKILL.md`: full skill guide and catalog
- `patterns/`: pattern reference files
- `references/`: principles, anti-patterns, architecture, and testing docs
- `scripts/find-pattern.ts`: pattern search/lookup helper
