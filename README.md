# software-best-design-patterns

A **2026-edition design-patterns catalog for TypeScript 6** — packaged as an [Agent Skill][skills] you can drop into Claude Code, Codex, [minimal-agent][ma], or any tool that follows the Agent Skills spec, and equally usable as a human-readable reference.

It is a deliberate update of *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides — 1994) and *Patterns of Enterprise Application Architecture* (Fowler — 2002) for the way TypeScript is actually written today: strict by default, discriminated unions over inheritance, `Result` types over thrown errors, signals over coarse observers, hexagonal over layered, and so on.

> **Why?** The original GoF book is still the shared vocabulary of software design, but its Smalltalk-and-C++-era examples no longer match how TS teams build systems in 2026. This skill keeps every classical pattern's *intent*, modernises every example to TypeScript 6, and adds the patterns the original book couldn't have known about (Result, Hooks, Signals, Reducer, Outbox, Saga, Idempotency, Circuit Breaker, Type-State, …).

[skills]: https://github.com/anthropics/skills
[ma]: https://github.com/h4ckf0r0day/minimal-agent

## At a glance

| | |
| --- | --- |
| **Patterns covered** | 42 — all 23 GoF + 6 PoEAA + 9 modern TS-native + 5 resilience |
| **Reference docs** | 6 — principles, anti-patterns, modern TypeScript, functional patterns, architectural styles, testing |
| **Language baseline** | TypeScript 6.0 (Mar 2026); native ESM; `target: es2025`; `strict: true` default |
| **Runtime baseline** | Node 22 LTS / Node 24+, Bun, Deno |
| **License** | MIT |

## What's in the catalog

### Creational (5)
[abstract-factory](patterns/abstract-factory.md) · [builder](patterns/builder.md) · [factory](patterns/factory.md) · [prototype](patterns/prototype.md) · [singleton](patterns/singleton.md)

### Structural (7)
[adapter](patterns/adapter.md) · [bridge](patterns/bridge.md) · [composite](patterns/composite.md) · [decorator](patterns/decorator.md) · [facade](patterns/facade.md) · [flyweight](patterns/flyweight.md) · [proxy](patterns/proxy.md)

### Behavioral (10)
[chain-of-responsibility](patterns/chain-of-responsibility.md) · [command](patterns/command.md) · [iterator](patterns/iterator.md) · [mediator](patterns/mediator.md) · [memento](patterns/memento.md) · [observer](patterns/observer.md) · [state](patterns/state.md) · [strategy](patterns/strategy.md) · [template-method](patterns/template-method.md) · [visitor](patterns/visitor.md)

### Enterprise / PoEAA (6)
[dto](patterns/dto.md) · [identity-map](patterns/identity-map.md) · [lazy-load](patterns/lazy-load.md) · [repository](patterns/repository.md) · [service-layer](patterns/service-layer.md) · [unit-of-work](patterns/unit-of-work.md)

### Modern (TypeScript-native) (9)
[branded-types](patterns/branded-types.md) · [dependency-injection](patterns/dependency-injection.md) · [discriminated-union-state](patterns/discriminated-union-state.md) · [hooks](patterns/hooks.md) · [middleware](patterns/middleware.md) · [reducer](patterns/reducer.md) · [result](patterns/result.md) · [signals](patterns/signals.md) · [type-state](patterns/type-state.md)

### Resilience / Distributed (5)
[circuit-breaker](patterns/circuit-breaker.md) · [idempotency](patterns/idempotency.md) · [outbox](patterns/outbox.md) · [retry-backoff](patterns/retry-backoff.md) · [saga](patterns/saga.md)

### References
[principles](references/principles.md) — SOLID + extended (Tell-Don't-Ask, Law of Demeter, Hollywood, Functional Core)
[anti-patterns](references/anti-patterns.md) — smells → remedies, with a comprehensive symptom-to-pattern table
[modern-typescript](references/modern-typescript.md) — TS 6 defaults, `satisfies`, `const` params, `NoInfer`, `using`, Stage-3 decorators, ES2025, Temporal
[functional-patterns](references/functional-patterns.md) — ADTs, `Result`, pipelines, lenses, Railway-Oriented Programming
[architectural-styles](references/architectural-styles.md) — Layered, Hexagonal, Clean, Modular Monolith, Microservices, CQRS, Event Sourcing, DDD tactical
[testing-patterns](references/testing-patterns.md) — test doubles, fakes vs mocks, London vs Detroit, property-based, contract testing, the 2026 stack (Vitest, Playwright, MSW, fast-check)

## How to use it

### As a human

Just read the catalog. Three entry points depending on what you came here for:

1. **You have a code smell.** Open [SKILL.md](SKILL.md) → *How to choose a pattern* → *By symptom*. Click through to the pattern.
2. **You want the catalog.** Open [SKILL.md](SKILL.md) → *Pattern catalog*. Every pattern is a self-contained file with *Intent*, *Problem*, *Solution*, *Modern TypeScript Twist*, *When to Use*, *When NOT to Use*, and *Testing*.
3. **You want a CLI lookup.** From the repo root:

   ```sh
   ./scripts/find-pattern.ts search "growing switch"
   ./scripts/find-pattern.ts show strategy
   ./scripts/find-pattern.ts category modern
   ```

   The CLI itself is a small worked example of the modern style this skill teaches — `as const satisfies`, discriminated narrowing, `readonly` everywhere, no `any`.

### As an Agent Skill

This repo follows the [Agent Skills][skills] spec (`SKILL.md` + `patterns/` + `references/` + `scripts/`). Once installed, agents discover it via the `SKILL.md` frontmatter `description`, which is rich in symptom-keyword triggers ("growing switch", "dual-write", "stringly-typed IDs", "throwing for expected errors", etc.).

#### Install for [Claude Code][cc]

```sh
git clone https://github.com/gastonmorixe/software-best-design-patterns.git ~/.claude/skills/software-best-design-patterns
```

#### Install for [minimal-agent][ma] / general "Agents" skill loader

```sh
git clone https://github.com/gastonmorixe/software-best-design-patterns.git ~/.agents/skills/software-best-design-patterns
```

Or, if you want the skill kept in a separate working tree:

```sh
git clone https://github.com/gastonmorixe/software-best-design-patterns.git ~/Projects/software-best-design-patterns
ln -s ~/Projects/software-best-design-patterns ~/.agents/skills/software-best-design-patterns
```

The skill is discovered automatically on the next session.

[cc]: https://github.com/anthropics/claude-code

#### Install for Codex / OpenAI Codex CLI

Place the directory under whatever path your Codex setup scans for skills (typically `~/.codex/skills/` or a project-local `.codex/skills/`). The `SKILL.md` follows the standard spec, so any conforming loader will pick it up.

#### Use as a single Markdown reference

The skill is also useful without an agent — just open the files. Each pattern file is structured the same way and reads cleanly as documentation:

```
patterns/<name>.md
├── Intent
├── The Problem (with "before" code)
├── The Solution (with "after" code)
├── Structure (ASCII diagram)
├── Modern TypeScript Twist
├── Real-World Applications
├── When to Use / When NOT to Use
├── Pitfalls
├── Related Patterns
└── Testing
```

## Repository layout

```
software-best-design-patterns/
├── README.md                  ← this file (humans + repo browsers)
├── SKILL.md                   ← Agent Skill entry point (router)
├── patterns/                  ← 42 pattern files
├── references/                ← 6 cross-cutting reference docs
└── scripts/
    └── find-pattern.ts        ← Node 22+ / Bun / Deno CLI
```

`SKILL.md` is the file the agent reads first; `README.md` is the file the human reads first; both link to the same pattern and reference files.

## Design choices

- **TypeScript 6, not TypeScript 5.** The skill assumes the TS 6.0 defaults (`strict`, `module: esnext`, `target: es2025`). The [modern-typescript reference](references/modern-typescript.md) opens with a complete "what changed from TS 5" table.
- **Discriminated unions over class hierarchies.** Where GoF would have written an interface + 5 concrete classes, this skill usually shows the union + `switch` instead, because that's how TS 6 codebases are actually written. The OO version is shown when it remains relevant (Composite, Decorator at runtime, Bridge).
- **Result over thrown errors** for expected failure paths. Exceptions are reserved for programmer-error / unrecoverable cases. See [result.md](patterns/result.md).
- **Branded types** for IDs and validated primitives — recovers nominal-style identity without runtime overhead. See [branded-types.md](patterns/branded-types.md).
- **Hexagonal architecture as the default suggestion** for non-trivial services. See [architectural-styles.md](references/architectural-styles.md).
- **TypeScript-first, no apologies.** Every example is in idiomatic TS 6. Cross-language asides only appear where they're genuinely useful for context (Rust for type-state, F# for ADT modelling).

## Contributing

Issues and PRs welcome. A few guidelines so the corpus stays consistent:

1. **Every pattern file follows the same skeleton** (see the structure block above). Keep the headings.
2. **No code without types.** Every snippet should pass `tsc --strict`. Mention runtime requirements (Node 22+, ES2025) when relevant.
3. **No `any`, no unsafe `as` casts** outside the smallest constructor-style helpers (parsers, branded-type minters).
4. **Modern TypeScript Twist is the section that justifies the file's existence.** If the modern idiom collapses the classical pattern into one line, say so — and show the line.
5. **Cross-link** related patterns at the bottom. The catalog's value is in the graph, not the individual nodes.
6. **One pattern per PR.** Keeps review feasible.

## License

MIT — see [LICENSE](LICENSE) (or the equivalent open license carried in the repo). The catalog text is original; the pattern names and original intents come from prior art (GoF, PoEAA) which is universally cited as canonical software-engineering vocabulary.

## Credits & sources

- **Gang of Four** — Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides (1994). The 23 classical patterns and their canonical structure.
- **Patterns of Enterprise Application Architecture** — Martin Fowler (2002). Repository, Unit of Work, Service Layer, DTO, Identity Map, Lazy Load.
- **Refactoring** — Martin Fowler (2nd ed.). The smells catalogue.
- **Release It!** — Michael Nygard (2nd ed.). Resilience patterns: circuit breaker, bulkhead, fail-fast.
- **Domain-Driven Design** — Eric Evans (2003). Tactical patterns: Entity, Value Object, Aggregate, Domain Event.
- **Functional and Reactive Domain Modeling** — Debasish Ghosh. The functional half of the catalog.
- **TypeScript** — Microsoft (typescriptlang.org). TS 6.0 release notes and the modern compiler baseline.
- **Agent Skills** — Anthropic's [skills spec][skills]; this repo follows it.

The opinions about which patterns to keep, demote, or modernise are mine. Disagreements are welcome — open an issue.

## Maintainer

**Gaston Morixe** — [@gastonmorixe](https://github.com/gastonmorixe)

If this skill helps you, ⭐ the repo. If it doesn't, open an issue and tell me what would.
