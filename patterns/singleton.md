# Singleton Pattern

> **Warning.** Singleton is the most-abused pattern in the GoF book. Read the [When NOT to use](#when-not-to-use-and-this-is-most-of-the-time) section before you write `getInstance()`. In 2026 TypeScript the right answer is almost always **dependency injection**, not Singleton.

## Intent

Ensure a class has **one and only one instance** and provide a global access point to it.

## The Problem (as the book frames it)

Some resources are conceptually unique:

- A connection pool
- A logger
- A configuration object
- A clock

If two of them exist, things break: two pools double-open connections, two configs disagree.

## The Naive Solution

```typescript
class Logger {
  private static instance: Logger | null = null;
  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) Logger.instance = new Logger();
    return Logger.instance;
  }

  info(msg: string): void { console.log(`[INFO] ${msg}`); }
}

// Anywhere:
Logger.getInstance().info("ready");
```

It works. It's also where most maintainability disasters begin.

## Why Singletons Hurt

1. **Hidden dependencies.** A function calling `Logger.getInstance()` doesn't declare in its signature that it needs a logger. Reading the signature lies about what the code does.
2. **Untestable.** Replacing the singleton in tests requires module mocking, monkey-patching, or DI-in-disguise (`Logger.setInstance(fake)`), all of which leak between tests.
3. **Hidden coupling.** Every file that imports the singleton is coupled to its concrete class, defeating Dependency Inversion.
4. **Lifecycle problems.** When does a singleton get torn down? In serverless or hot-reload environments, "global state" leaks across requests/builds.
5. **Concurrency.** In Node worker threads / Bun isolates / Deno workers each isolate has its own singleton — usually surprising the author.
6. **Hot reloading.** With ESM and Vite/Webpack HMR, module re-evaluation can produce two "singletons" coexisting until the page reloads.

## The Modern Replacement: Dependency Injection

Treat "there is exactly one of these in this process" as a **composition-root concern**, not a class concern.

```typescript
// ── 1. Define an interface, not a singleton class ────────────
interface Logger {
  info(msg: string): void;
  error(msg: string, cause?: unknown): void;
}

class ConsoleLogger implements Logger {
  info(msg: string)  { console.log(`[INFO]  ${msg}`); }
  error(m: string, c?: unknown) { console.error(`[ERROR] ${m}`, c); }
}

// ── 2. Pass the dependency in ────────────────────────────────
class OrderService {
  constructor(private readonly logger: Logger) {}
  async place(o: Order): Promise<void> {
    this.logger.info(`placing ${o.id}`);
    /* … */
  }
}

// ── 3. Create exactly one at the composition root ───────────
//      (e.g., src/main.ts, src/app.ts, your bootstrap file)
const logger = new ConsoleLogger();
const orders = new OrderService(logger);

// Tests:
const fake: Logger = { info: vi.fn(), error: vi.fn() };
new OrderService(fake);
```

Same uniqueness guarantee, none of the pain.

## If You Truly Need a Singleton

Reach for it only when **all** of these hold:

- The resource is genuinely global (a clock, an OS file handle, a hardware port).
- Construction is expensive and idempotent.
- You're willing to accept the testability cost.
- You're not in a runtime where modules reload (most server runtimes are fine; HMR clients are not).

Then prefer the **module-level constant** form. ES modules are already evaluated once per realm:

```typescript
// src/infra/clock.ts
export const clock = {
  now: () => new Date(),
  monotonicMs: () => performance.now(),
} as const;

// Anywhere:
import { clock } from "./infra/clock";
clock.now();
```

That's the entire pattern. No `getInstance`, no static field, no double-checked locking. The module system guarantees a single evaluation per realm.

### Lazy module singleton

When initialisation must defer until first use (e.g., requires env vars that aren't loaded at import time):

```typescript
// src/infra/db.ts
import { Pool } from "pg";

let _pool: Pool | null = null;

export function db(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
    });
  }
  return _pool;
}

export async function closeDb(): Promise<void> {
  await _pool?.end();
  _pool = null;
}
```

The closure replaces a static field, and `closeDb()` makes lifecycle explicit — critical for tests.

### Class-based singleton (last resort)

If you must wrap a class:

```typescript
class MetricsCollector {
  // #-private; not even reflection can touch it
  static #instance: MetricsCollector | null = null;

  // Private constructor blocks `new MetricsCollector()`
  private constructor(private readonly opts: MetricsOpts) {}

  static get(opts: MetricsOpts): MetricsCollector {
    return (MetricsCollector.#instance ??= new MetricsCollector(opts));
  }

  /** Test-only seam. Never call from production code. */
  static _resetForTests(): void {
    MetricsCollector.#instance = null;
  }
}
```

Notes:

- Use `#instance` (ECMAScript private) rather than `private static instance`. The former is truly hidden; the latter is just a TS compile-time check.
- Provide a `_resetForTests()` seam. If your singleton has no way to be reset, tests will fight you forever.
- Document that the singleton is owned by the composition root.

## Per-Realm Pitfall (Node Workers, Bun, Deno)

Each worker thread / isolate evaluates modules independently, so a "singleton" is one **per realm**, not one per process:

```typescript
// main.ts
import { Worker } from "node:worker_threads";
import { counter } from "./counter";
counter.value++;
new Worker("./worker.js");

// worker.js
import { counter } from "./counter";
console.log(counter.value); // 0, not 1
```

If you need cross-worker uniqueness, the right tool is **shared memory** (`SharedArrayBuffer`) or **IPC**, not Singleton.

## When to Use (and this is most of the time)

**Use Singleton when:**

- You're modelling a literal hardware resource (single port, single GPIO pin).
- You're stuck integrating with a framework that demands `getInstance`.
- All else fails and you've considered DI honestly.

## When NOT to Use (and this is most of the time)

**Don't use Singleton when:**

- The "singleton" is really application configuration → pass it in.
- It's used to dodge dependency injection → fix the DI.
- It holds mutable state shared across tests → guaranteed flakiness.
- The codebase already has a DI container → register a singleton-scoped binding.
- "Logger" — every framework has a structured logger you can inject (pino, winston, console with a wrapper).

## Anti-Patterns Built on Singleton

| Anti-pattern | Symptom | Fix |
| --- | --- | --- |
| **Service Locator** | Code calls `Container.get<T>()` from inside business logic | Constructor-inject the dependency instead |
| **Static Service** | Class with only static methods that hold state | Make it instance-based; inject |
| **God Singleton** | `App.getInstance()` exposes the whole world | Split into focused interfaces |
| **Singleton-as-Cache** | `getInstance()` becomes a hidden cache with no eviction | Use an explicit cache abstraction with TTL |

## Testing

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetricsCollector } from "./metrics";

describe("MetricsCollector singleton", () => {
  beforeEach(() => MetricsCollector._resetForTests());

  it("returns the same instance", () => {
    const a = MetricsCollector.get({ flushMs: 1000 });
    const b = MetricsCollector.get({ flushMs: 1000 });
    expect(a).toBe(b);
  });

  it("ignores opts after first call", () => {
    const a = MetricsCollector.get({ flushMs: 1000 });
    const b = MetricsCollector.get({ flushMs: 9999 }); // silently ignored
    expect(a).toBe(b);
  });
});
```

The fact that "ignores opts after first call" is a test you have to write at all is the smell that says: **prefer DI**.

## Related Patterns

- **Dependency Injection** — the modern replacement; what you should reach for first.
- **Abstract Factory** — factories are often single instances; their methods are not the singletons.
- **Monostate** — every instance shares the same state via static fields. Equivalent to Singleton with worse ergonomics.
- **Flyweight** — manages many shared instances by key; Singleton is the degenerate Flyweight with key `*`.

## Summary

> *Singleton is a global variable wearing a tie.* — Misko Hevery (paraphrased)

If you find yourself reaching for Singleton, write **DI** instead. If you must have one, prefer **module-scoped constants**. Treat the class form as a code smell that needs justification in a comment.
