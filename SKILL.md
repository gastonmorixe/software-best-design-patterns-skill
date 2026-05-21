---
name: software-best-design-patterns
description: 2026-edition design-patterns reference for modern TypeScript. Covers all 23 Gang-of-Four patterns, PoEAA enterprise patterns (Repository, Unit of Work, Service Layer, DTO, Identity Map, Lazy Load), modern TS idioms (Result, Discriminated Union State, Branded Types, Type-State, Dependency Injection, Hooks, Signals, Reducer, Middleware), resilience (Circuit Breaker, Retry+Backoff, Saga, Outbox, Idempotency), plus references on SOLID, anti-patterns, TypeScript 5.x features, functional patterns, architectural styles (Hexagonal, Clean, CQRS, Event Sourcing, DDD tactical), and testing. Use when designing architecture, refactoring code, choosing a pattern, or when code exhibits symptoms like growing switch statements, deep inheritance, tight coupling, hard-to-test components, dual-write inconsistencies, throwing for expected errors, stringly-typed IDs, unbounded retry loops, or boolean state flags. Also for reviewing TypeScript code or picking architectural styles.
---

# Software Best Design Patterns

A 2026-edition update of the Gang-of-Four catalog, written for modern TypeScript (5.x, strict mode, native ESM). Covers all 23 classical patterns, the enterprise patterns from *Patterns of Enterprise Application Architecture*, the modern functional/reactive patterns that have become idiomatic (Result, Discriminated Union State, Branded Types, DI, Hooks, Signals, Reducer, Middleware, Type-State), and the resilience patterns that distributed systems require (Circuit Breaker, Retry, Saga, Outbox, Idempotency).

**Core philosophy.** Patterns are templates you adapt to your context, not blueprints to copy. They earn their weight when they genuinely simplify your design. Reaching for one to "look senior" is the most reliable way to make code worse.

## How to use this skill

1. **Skim the [decision trees](#how-to-choose-a-pattern)** for your symptom or problem class.
2. **Read the matching pattern file** in `patterns/` — each has *Intent*, *Problem*, *Solution*, *Modern TypeScript Twist*, *When to Use*, *When NOT to Use*, and *Testing*.
3. **Consult a `references/` doc** for cross-cutting concerns (principles, anti-patterns, modern TS, functional patterns, architectural styles, testing).
4. **Apply the [Implementation checklist](#implementation-checklist)** before merging.

Skip ahead if you already know the pattern's name — `Read` the file directly.

### Quick lookup (CLI)

`scripts/find-pattern.ts` gives deterministic name/symptom/category lookups without scanning all 42 pattern files. Runs on Node 22.7+ (with `--experimental-strip-types`), Node 23.6+ stable, Bun, or Deno.

```bash
./scripts/find-pattern.ts list                       # all patterns by category, with paths
./scripts/find-pattern.ts search "growing switch"    # ranked matches across name/intent/tags/symptoms
./scripts/find-pattern.ts show strategy              # one pattern's metadata + file path
./scripts/find-pattern.ts category modern            # list patterns in one category
./scripts/find-pattern.ts symptoms                   # all symptom → pattern mappings

# Alternatives if the shebang doesn't fire:
node --experimental-strip-types scripts/find-pattern.ts list
bun scripts/find-pattern.ts list
deno run --allow-read scripts/find-pattern.ts list
```

Use it to discover the right pattern file when a symptom rings a bell but you don't remember the name. Then `Read` the path it prints.

## Foundational principles

Every pattern in this skill is an expression of one of these. Master the principles and patterns follow naturally. Full discussion: [references/principles.md](references/principles.md).

| Principle | Meaning | Symptom of violation |
| --- | --- | --- |
| **Encapsulate what varies** | Isolate changing parts from stable parts | Changes ripple through codebase |
| **Program to interfaces** | Depend on abstractions, not concretions | Can't swap implementations |
| **Composition over inheritance** | Build behaviour by composing objects | Deep, rigid class hierarchies |
| **Single Responsibility (SRP)** | One reason to change per module | Classes that do many things |
| **Open–Closed (OCP)** | Open for extension, closed for modification | Adding a feature edits old code |
| **Liskov Substitution (LSP)** | Subtypes must be substitutable | Subclasses throw "not supported" |
| **Interface Segregation (ISP)** | Don't depend on methods you don't use | Mocks with 20 stub methods |
| **Dependency Inversion (DIP)** | High-level depends on abstractions | Domain imports vendor SDK |
| **Tell, don't ask** | Tell objects what to do, don't fetch their state | Callers read state to make decisions |
| **Law of Demeter** | Talk only to immediate friends | `a.b.c.d.e` chains |
| **YAGNI / KISS / DRY** | Don't add until needed; keep it simple; don't duplicate knowledge | Premature abstraction; wrong abstraction |
| **Functional core, imperative shell** | Pure logic inside, I/O at the edges | Logic woven with I/O is hard to test |

## How to choose a pattern

### By problem (what are you trying to do?)

```
CREATING OBJECTS
├── Multi-step / fluent construction ──────────► Builder
├── Complex / conditional creation ────────────► Factory Method
├── Family of related objects together ────────► Abstract Factory
├── Copy existing objects ─────────────────────► Prototype
├── Exactly one instance ──────────────────────► Singleton  (PREFER DI)
└── Many shared lightweight instances ────────► Flyweight

STRUCTURING / ADAPTING OBJECTS
├── Make incompatible interfaces work ────────► Adapter
├── Simplify complex subsystem ───────────────► Facade
├── Tree / part-whole hierarchy ──────────────► Composite
├── Add behavior dynamically ─────────────────► Decorator
├── Control access / lazy / remote ──────────► Proxy
├── Two orthogonal axes of variation ────────► Bridge
└── Convert one interface across boundaries ─► Adapter

BEHAVIOR / ALGORITHMS
├── Swap algorithms at runtime ────────────────► Strategy
├── Behavior changes with state ──────────────► State (or Discriminated Union State)
├── Algorithm skeleton with hooks ───────────► Template Method
├── Encapsulate requests as objects ─────────► Command
├── Undo / redo / time-travel ───────────────► Memento + Command
├── Add ops to closed hierarchy ─────────────► Visitor (TS prefer: Discriminated Union + switch)
├── One-to-many notification ────────────────► Observer (or Signals/Hooks)
├── Sequential handlers / pipeline ──────────► Chain of Responsibility / Middleware
├── Reduce N-to-N coupling ──────────────────► Mediator
└── Sequential traversal of collection ──────► Iterator

DATA ACCESS / PERSISTENCE
├── Abstract data source ────────────────────► Repository
├── Atomic multi-entity commit ──────────────► Unit of Work + DB transaction
├── Object identity per session ─────────────► Identity Map
├── Defer expensive loading ─────────────────► Lazy Load
└── Shape data for transfer ─────────────────► DTO + Zod/Valibot at boundary

ERRORS / CONTROL FLOW (modern)
├── Expected failure modes typed ────────────► Result
├── Multiple valid states ───────────────────► Discriminated Union State
├── Compile-time misuse prevention ──────────► Type-State
└── Distinct primitive-shaped identities ────► Branded Types

UI / FRONTEND
├── Reusable stateful logic ─────────────────► Hooks
├── Fine-grained reactive state ─────────────► Signals
├── Predictable transitions ─────────────────► Reducer
└── Cross-cutting request handling ──────────► Middleware

WIRING / COMPOSITION
└── Inject collaborators from outside ───────► Dependency Injection

DISTRIBUTED / RESILIENCE
├── Failing dependency cascades ─────────────► Circuit Breaker
├── Transient failures ──────────────────────► Retry + Backoff
├── Safe to retry mutating writes ───────────► Idempotency Key
├── Multi-service transaction ───────────────► Saga
└── DB write + event publish atomically ────► Outbox
```

### By symptom (what does the code look like?)

| Symptom | Likely fix |
| --- | --- |
| Growing `switch` / `if-else` chain on a type | [Strategy](patterns/strategy.md), [Discriminated Union State](patterns/discriminated-union-state.md), [Visitor](patterns/visitor.md) |
| Duplicate code across siblings | [Template Method](patterns/template-method.md), [Strategy](patterns/strategy.md) |
| One class does everything | [SRP](references/principles.md), [Service Layer](patterns/service-layer.md), [Facade](patterns/facade.md) |
| Domain imports vendor SDK | [DIP](references/principles.md), [Dependency Injection](patterns/dependency-injection.md), Ports & Adapters |
| Constructor takes 8+ params | Object params, [Builder](patterns/builder.md) |
| Adding feature edits 5 files | [OCP](references/principles.md), [Strategy](patterns/strategy.md), plugin/registry |
| Adding features bloats class | [Decorator](patterns/decorator.md), [Strategy](patterns/strategy.md), [Composition](references/principles.md) |
| Need undo/redo | [Command](patterns/command.md) + [Memento](patterns/memento.md) |
| Object behaviour depends on state | [State](patterns/state.md) or [Discriminated Union State](patterns/discriminated-union-state.md) |
| Throwing `Error` for expected failures | [Result](patterns/result.md) |
| `string` for IDs and emails | [Branded Types](patterns/branded-types.md) + schema parsing |
| `loading + data + error` booleans | [Discriminated Union State](patterns/discriminated-union-state.md) |
| Stateful component logic duplicated | [Hooks](patterns/hooks.md) |
| Cross-cutting concern repeated | [Middleware](patterns/middleware.md), [Decorator](patterns/decorator.md) |
| Retry loop blasts failing service | [Circuit Breaker](patterns/circuit-breaker.md) |
| Dual-write inconsistency (DB + broker) | [Outbox](patterns/outbox.md) |
| Cross-service workflow with rollback needs | [Saga](patterns/saga.md) |
| Singleton hell | [Dependency Injection](patterns/dependency-injection.md) |
| Untyped `any` at boundary | Schema parse (Zod/Valibot/ArkType) + [Branded Types](patterns/branded-types.md) |

For more symptoms, see [references/anti-patterns.md](references/anti-patterns.md).

### Domain logic: Transaction Script vs. Domain Model

| Factor | Transaction Script | Domain Model |
| --- | --- | --- |
| Logic complexity | Simple (< 500 lines) | Complex, many rules |
| Business rules | Few, straightforward | Many, interacting |
| Operations | CRUD-heavy | Rich behaviour |
| Team / timeline | Small team, quick delivery | Long-term maintenance |
| Testing | Integration tests | Unit tests on the domain |

**Rule of thumb:** Start with Transaction Script. Refactor to Domain Model when procedural code becomes hard to maintain. See [references/architectural-styles.md](references/architectural-styles.md).

## Pattern catalog

Each pattern has its own file with detailed examples, modern TypeScript idioms, real-world applications, pitfalls, related patterns, and testing patterns.

### Creational

| Pattern | One-liner | File |
| --- | --- | --- |
| **Factory** (Method / Simple / Abstract) | Encapsulate object creation | [factory.md](patterns/factory.md) |
| **Abstract Factory** | Family of related objects, swap as a unit | [abstract-factory.md](patterns/abstract-factory.md) |
| **Builder** | Step-by-step construction; fluent APIs | [builder.md](patterns/builder.md) |
| **Prototype** | Clone an existing instance instead of constructing | [prototype.md](patterns/prototype.md) |
| **Singleton** | One instance — **prefer DI** | [singleton.md](patterns/singleton.md) |

### Structural

| Pattern | One-liner | File |
| --- | --- | --- |
| **Adapter** | Convert one interface to another | [adapter.md](patterns/adapter.md) |
| **Bridge** | Decouple two orthogonal hierarchies via composition | [bridge.md](patterns/bridge.md) |
| **Composite** | Uniform tree of parts and wholes | [composite.md](patterns/composite.md) |
| **Decorator** | Add behaviour dynamically without subclassing | [decorator.md](patterns/decorator.md) |
| **Facade** | One simple surface over a complex subsystem | [facade.md](patterns/facade.md) |
| **Flyweight** | Share heavy intrinsic state across many instances | [flyweight.md](patterns/flyweight.md) |
| **Proxy** | Stand-in that controls access to the real thing | [proxy.md](patterns/proxy.md) |

### Behavioral

| Pattern | One-liner | File |
| --- | --- | --- |
| **Chain of Responsibility** | Pass request through handlers until one acts | [chain-of-responsibility.md](patterns/chain-of-responsibility.md) |
| **Command** | Encapsulate requests as objects | [command.md](patterns/command.md) |
| **Iterator** | Sequential access without exposing structure | [iterator.md](patterns/iterator.md) |
| **Mediator** | Centralise complex N-to-N communication | [mediator.md](patterns/mediator.md) |
| **Memento** | Snapshot internal state for restoration | [memento.md](patterns/memento.md) |
| **Observer** | Notify dependents of state changes | [observer.md](patterns/observer.md) |
| **State** | Behaviour changes with internal state | [state.md](patterns/state.md) |
| **Strategy** | Interchangeable algorithms behind one interface | [strategy.md](patterns/strategy.md) |
| **Template Method** | Algorithm skeleton with overridable hooks | [template-method.md](patterns/template-method.md) |
| **Visitor** | Add operations to a closed hierarchy | [visitor.md](patterns/visitor.md) |

### Enterprise / PoEAA

| Pattern | One-liner | File |
| --- | --- | --- |
| **Repository** | Collection-like data access | [repository.md](patterns/repository.md) |
| **Unit of Work** | Coordinate atomic changes across entities | [unit-of-work.md](patterns/unit-of-work.md) |
| **Identity Map** | Ensure object identity within a session | [identity-map.md](patterns/identity-map.md) |
| **Lazy Load** | Defer expensive loading | [lazy-load.md](patterns/lazy-load.md) |
| **Service Layer** | Define application boundary and orchestration | [service-layer.md](patterns/service-layer.md) |
| **DTO** | Shape data for transfer across boundaries | [dto.md](patterns/dto.md) |

### Modern (TypeScript-native)

These patterns aren't in the GoF book but are core idioms in 2026 TypeScript.

| Pattern | One-liner | File |
| --- | --- | --- |
| **Result / Either** | Failure as a typed value, not an exception | [result.md](patterns/result.md) |
| **Discriminated Union State** | Tagged unions for state — make illegal states unrepresentable | [discriminated-union-state.md](patterns/discriminated-union-state.md) |
| **Branded Types** | Nominal-style identity in a structural type system | [branded-types.md](patterns/branded-types.md) |
| **Type-State** | Encode state machines in the type system | [type-state.md](patterns/type-state.md) |
| **Dependency Injection** | Modern replacement for Singleton & Service Locator | [dependency-injection.md](patterns/dependency-injection.md) |
| **Middleware** | Onion-shaped composable request/response pipeline | [middleware.md](patterns/middleware.md) |
| **Reducer** | `(state, action) → state`; functional cousin of State | [reducer.md](patterns/reducer.md) |
| **Hooks** | Reusable stateful logic in components | [hooks.md](patterns/hooks.md) |
| **Signals** | Fine-grained reactive primitive | [signals.md](patterns/signals.md) |

### Resilience / distributed

| Pattern | One-liner | File |
| --- | --- | --- |
| **Circuit Breaker** | Stop hammering failing dependencies | [circuit-breaker.md](patterns/circuit-breaker.md) |
| **Retry + Backoff** | Handle transient failures with bounded, jittered retries | [retry-backoff.md](patterns/retry-backoff.md) |
| **Saga** | Coordinate cross-service workflows with compensation | [saga.md](patterns/saga.md) |
| **Outbox** | Atomic DB-change-plus-event publication | [outbox.md](patterns/outbox.md) |
| **Idempotency** | Make retries safe at the API and consumer boundaries | [idempotency.md](patterns/idempotency.md) |

## References (load when needed)

Cross-cutting documents that several patterns share. Don't read them up-front; consult when the situation calls.

| Reference | When to read |
| --- | --- |
| [references/principles.md](references/principles.md) | When a pattern doesn't fit and you need to reason from first principles — SOLID, composition, coupling, cohesion, YAGNI/KISS/DRY |
| [references/anti-patterns.md](references/anti-patterns.md) | When you spot a smell (God Object, Singleton abuse, Dual Write, Stringly-typed API, etc.) and need the matching remedy |
| [references/modern-typescript.md](references/modern-typescript.md) | When applying TS 5.x features to a pattern — `satisfies`, `const` type parameters, `NoInfer`, `using`, decorators, branded types, iterator helpers, set methods |
| [references/functional-patterns.md](references/functional-patterns.md) | When working with `Result`, ADTs, pipelines, immutability, lenses, or Railway-Oriented Programming |
| [references/architectural-styles.md](references/architectural-styles.md) | When choosing between layered, hexagonal, clean, modular monolith, microservices, CQRS, event sourcing, DDD tactical |
| [references/testing-patterns.md](references/testing-patterns.md) | When deciding on test doubles, fixtures, property-based tests, contract tests, or wiring Vitest / Playwright / MSW |

## Modern variations (what GoF would write today)

| Modern pattern | Based on | What changed |
| --- | --- | --- |
| **Hooks** (React, Vue, Solid, Svelte) | Observer + Strategy + Template Method | Composable stateful logic at function granularity |
| **Signals** (Solid, Vue, Svelte 5, Angular, Preact, TC39 proposal) | Observer | Automatic dependency tracking; surgical updates |
| **Middleware** | Decorator + Chain of Responsibility | Onion-shaped pipelines, native to every HTTP framework |
| **Reducer / Redux** | Command + State | Pure `(state, action) → state`, replayable history |
| **Event Sourcing** | Command + Memento | Persist events; state is a fold over the log |
| **CQRS** | Separation of concerns | Read model decoupled from write model |
| **Dependency Injection** | Strategy + Factory | Container creates and injects; constructor-injection is the default |
| **Hexagonal / Clean** | DIP applied at app scale | Domain at the centre, infrastructure as adapters |
| **Result types** | Tagged union | Errors are values, not exceptions |
| **Discriminated Unions** | State + Visitor | Type-checked state machines, exhaustive matching |

## Common mistakes

| Mistake | Symptom | Fix |
| --- | --- | --- |
| **Pattern overuse** | Simple things require navigating five classes | Use only when solving a real problem |
| **Wrong pattern** | Code feels forced or awkward | Re-examine the actual problem |
| **Inheritance abuse** | Deep hierarchies, fragile base class | Favor composition (Strategy, Decorator, Bridge) |
| **Singleton abuse** | Global state, hidden dependencies, hard to test | Dependency injection |
| **Premature abstraction** | Interfaces with one implementation | Wait for the second variant |
| **Throwing for control flow** | `try/catch` blocks scattered for expected outcomes | [Result type](patterns/result.md) |
| **Stringly-typed APIs** | IDs and emails as `string`; easy to mix up | [Branded types](patterns/branded-types.md) + schema parsing at boundaries |
| **Booleans for state** | `loading + error + data` flags | [Discriminated union state](patterns/discriminated-union-state.md) |
| **Dual writes** | DB save + broker publish without coordination | [Outbox pattern](patterns/outbox.md) |
| **Unbounded retries** | `while (true) try { … }` | [Retry + Backoff](patterns/retry-backoff.md) with `maxAttempts` |
| **Non-idempotent writes retried** | Duplicate charges, duplicate emails | [Idempotency keys](patterns/idempotency.md) |
| **Cross-service transactions** | Trying to wrap multiple services in one transaction | [Saga](patterns/saga.md) |
| **God Service Locator** | Components call `Container.get<T>()` from inside | Constructor injection |

More: [references/anti-patterns.md](references/anti-patterns.md).

## Pattern selection workflow

When you're about to add structure, run through this in order:

1. **Is there a real problem?**
   - Not "I anticipate needing this someday." YAGNI it.
   - Yes → continue.
2. **Is the simplest design enough?**
   - A function? A struct? A flat object?
   - If "no, because…", continue.
3. **Which principle is being violated by the current shape?**
   - SRP? OCP? DIP? Tell-don't-ask?
   - The principle picks the pattern.
4. **What's the smallest pattern that resolves the violation?**
   - Strategy beats Visitor for "one varying algorithm".
   - DI beats Singleton for "one shared collaborator".
5. **Does the team know it?**
   - If yes → apply.
   - If no → consider a smaller step (extract function; introduce interface) before the full pattern.
6. **Are you sure?**
   - Try writing the test first. If the test is awkward, the pattern is wrong.
7. **Add it. Then delete what the new shape made redundant.**

## Implementation checklist

Before merging code that introduces a pattern:

- [ ] The pattern solves a real, observed problem in this codebase (not anticipated).
- [ ] You considered the simpler alternatives.
- [ ] The trade-offs (extra classes / indirection / cognitive load) are acceptable.
- [ ] The team will recognise the pattern by name.
- [ ] Tests for the new code are not awkward to write.
- [ ] If the pattern crosses a network or process boundary, you've addressed:
  - Idempotency
  - Error handling (`Result` or typed exceptions)
  - Timeout / cancellation
  - Observability (logs / metrics / traces)
- [ ] If introducing a class hierarchy, you considered composition (Strategy / Decorator / Bridge).
- [ ] If introducing global state, you considered DI.
- [ ] Imports point in the right direction (domain doesn't import infrastructure).

## TypeScript baseline (assumed throughout)

This skill assumes:

- TypeScript **5.x** (5.9+ idioms; some examples use TC39 proposals where stable in Node 22+).
- `"strict": true` in `tsconfig.json`, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Native ESM (`"type": "module"`).
- Node 22+, Bun, Deno, or a modern browser runtime.
- A schema library (Zod / Valibot / ArkType) at trust boundaries.
- Vitest for unit and integration tests.

If you're stuck on TS < 5.0 or CommonJS, many of the modern idioms still apply with minor adjustments; pattern files note them where relevant.

## Reading order suggestions

For someone new to design patterns:

1. [references/principles.md](references/principles.md) — the bedrock.
2. [patterns/strategy.md](patterns/strategy.md), [patterns/factory.md](patterns/factory.md), [patterns/observer.md](patterns/observer.md), [patterns/decorator.md](patterns/decorator.md) — the four most-used GoF patterns.
3. [patterns/result.md](patterns/result.md), [patterns/discriminated-union-state.md](patterns/discriminated-union-state.md), [patterns/branded-types.md](patterns/branded-types.md), [patterns/dependency-injection.md](patterns/dependency-injection.md) — the four most-used modern TS patterns.
4. [references/anti-patterns.md](references/anti-patterns.md) — what to look out for in existing code.

For someone working on a distributed system:

1. [references/architectural-styles.md](references/architectural-styles.md) — pick a style.
2. [patterns/outbox.md](patterns/outbox.md), [patterns/idempotency.md](patterns/idempotency.md), [patterns/saga.md](patterns/saga.md) — the must-haves.
3. [patterns/circuit-breaker.md](patterns/circuit-breaker.md), [patterns/retry-backoff.md](patterns/retry-backoff.md) — the safety net.
4. [patterns/result.md](patterns/result.md), [patterns/middleware.md](patterns/middleware.md) — the connective tissue.

## Final word

> *Design patterns are the names we give to the shapes we keep recognising.*

A pattern's value is the **shared vocabulary** it gives a team and the **tested template** it provides for a known-shape problem. Knowing the catalog means you can describe a refactor in a sentence and others understand exactly what shape you're heading toward.

Patterns don't replace judgement. They are crystallised judgement — the captured experience of thousands of programmers who hit the same problems and converged on the same solutions. Use them when the situation matches; ignore them when it doesn't.

When in doubt, **write less code**.
