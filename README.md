# Software Best Design Patterns

2026-edition design-patterns reference for modern TypeScript (5.x, strict mode, native ESM).

This skill covers:
- All 23 GoF patterns
- Enterprise patterns (Repository, Unit of Work, Service Layer, DTO, Identity Map, Lazy Load)
- Modern TypeScript patterns (Result, Discriminated Union State, Branded Types, Type-State, DI, Hooks, Signals, Reducer, Middleware)
- Resilience patterns (Circuit Breaker, Retry + Backoff, Saga, Outbox, Idempotency)
- Cross-cutting references (principles, anti-patterns, testing, architecture styles)

## Installation (skills.sh)

Install this skill with `skills.sh`:

```bash
skills.sh install gastonmorixe/software-best-design-patterns
```

If you are running from a local clone and have a local installer script:

```bash
./skills.sh install
```

## How to use

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

## Repository structure

- `SKILL.md`: full skill guide and catalog
- `patterns/`: pattern reference files
- `references/`: principles, anti-patterns, architecture, and testing docs
- `scripts/find-pattern.ts`: pattern search/lookup helper
