# Modern TypeScript (2026 Edition)

How to express classic design patterns idiomatically in **TypeScript 6.0** (released March 2026 — the last JS-based compiler before the Go-powered TypeScript 7 rewrite). Covers the TS 6 default changes, `satisfies`, `const` type parameters, `NoInfer`, `using`, Stage-3 decorators, template literal types, branded types, the ES2025 standard library, and Temporal.

> **Reference baseline:** TypeScript 6.0 (Mar 2026), Node 22 LTS / Node 24+ / Bun / Deno, native ESM, `target: es2025`, `strict: true` (now the default).

## What changed from TS 5 to TS 6

TypeScript 6.0 is the **transition release** preparing the ecosystem for TypeScript 7 (the native Go port). It's API-compatible with 5.9 but ships nine default changes and removes a lot of legacy options. The deltas worth knowing:

### New defaults (you no longer need to set these)

| Option | Old default | New default in TS 6 |
| --- | --- | --- |
| `strict` | `false` | **`true`** |
| `module` | `"commonjs"` (under `target: es5`) or none | **`"esnext"`** |
| `target` | `"es3"` | **current-year ES** (today: `"es2025"`) |
| `noUncheckedSideEffectImports` | `false` | **`true`** |
| `libReplacement` | `true` | **`false`** (faster `--watch`) |
| `rootDir` | inferred from inputs | **`.`** (tsconfig dir) |
| `types` | every package in `node_modules/@types` | **`[]`** (explicit) |

### Removed / deprecated

- `target: es5` — deprecated. Lowest target is ES2015. Use a separate bundler if you genuinely need ES5 output.
- `--downlevelIteration` — deprecated (only mattered for ES5).
- `--moduleResolution node` / `node10` — deprecated. Use `nodenext` (Node apps) or `bundler` (bundled / Bun apps).
- `--moduleResolution classic` — **removed**.
- `module: amd`, `umd`, `systemjs`, `none` — **removed**.
- `--baseUrl` — deprecated. Inline the prefix into `paths`.
- `--esModuleInterop false` and `--allowSyntheticDefaultImports false` — no longer allowed. Both are now always on.
- `--alwaysStrict false` — no longer allowed. All code is JS strict mode.
- `outFile` — **removed**. Use a bundler.
- `module Foo { }` namespace syntax — **error**. Use `namespace Foo { }`.
- `asserts { type: "json" }` on imports — **error**. Use `with { type: "json" }`.
- `tsc foo.ts` in a folder containing `tsconfig.json` — **error**. Use `--ignoreConfig` if intentional.

### Genuinely new in TS 6

- **Looser inference for `this`-less methods** — TypeScript no longer skips method-syntax callbacks during generic inference if they don't actually use `this`. Patterns relying on method-shaped strategies/visitors now type-check without arrow rewrites.
- **Subpath imports with `#/`** — Node now allows `imports: { "#/*": "./dist/*" }`, and TS supports it under `nodenext` / `bundler`.
- **Combining `--moduleResolution bundler` with `--module commonjs`** — finally allowed; useful for libs that ship CJS but use bundler-style imports.
- **`--stableTypeOrdering`** — opt-in flag that matches TS 7's deterministic type ordering. Use it transitionally; don't ship with it permanently (≈25% slower).
- **`es2025` target/lib** — adds types for `RegExp.escape`, `Promise.try`, `Iterator.from`, set methods, `Map.getOrInsert` / `getOrInsertComputed`.
- **`Temporal` types** — the stage-4 date/time replacement is in `lib.esnext.temporal.d.ts`. Available via `lib: ["esnext"]` or `lib: ["esnext.temporal"]`.
- **`dom.iterable` and `dom.asynciterable` folded into `dom`** — drop the explicit entries from `lib`.

## Table of Contents

1. [Compiler config baseline (TS 6)](#compiler-config-baseline-ts-6)
2. [Discriminated unions everywhere](#discriminated-unions-everywhere)
3. [`satisfies` — type-check without widening](#satisfies--type-check-without-widening)
4. [`const` type parameters](#const-type-parameters)
5. [`NoInfer<T>` — control inference direction](#noinfert--control-inference-direction)
6. [`using` and explicit resource management](#using-and-explicit-resource-management)
7. [Stage-3 decorators](#stage-3-decorators)
8. [Template literal types](#template-literal-types)
9. [Branded / nominal types](#branded--nominal-types)
10. [Iterator helpers (ES2025)](#iterator-helpers-es2025)
11. [Set methods (ES2025)](#set-methods-es2025)
12. [Map upsert methods (ES2025)](#map-upsert-methods-es2025)
13. [`Temporal` for dates and times](#temporal-for-dates-and-times)
14. [Schema parsing at boundaries](#schema-parsing-at-boundaries)
15. [Type-level utilities you should know](#type-level-utilities-you-should-know)
16. [Pattern → modern TS expression](#pattern--modern-ts-expression)

---

## Compiler config baseline (TS 6)

The TS 6 defaults are good. With strict on, ESM on, and `target: es2025`, the only flags you *must* set are the ones that say "I really mean it" and the ones that lock down indexed access / optional properties.

```jsonc
// tsconfig.json — TypeScript 6.0 baseline
{
  "compilerOptions": {
    // ── Targets — all defaults under TS 6, shown for clarity ──
    "target": "es2025",
    "module": "esnext",
    "moduleResolution": "bundler",   // or "nodenext" for Node apps
    "lib": ["es2025", "dom"],        // dom.iterable & dom.asynciterable folded in

    // ── Strictness (strict: true is the default now) ──
    "strict": true,
    "noUncheckedIndexedAccess": true,    // arr[i] : T | undefined  — bug-catcher
    "exactOptionalPropertyTypes": true,  // `?: T` ≠ `: T | undefined`

    // ── Quality-of-life ──
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,        // `import type` stays as type
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,  // `import "./x.ts"` works

    // ── Explicit (TS 6 makes you choose) ──
    "rootDir": "./src",
    "types": ["node"]                    // add "bun" / "vitest" / etc. as needed
  },
  "include": ["src"]
}
```

If you migrate from a 5.x tsconfig: delete `esModuleInterop`, `allowSyntheticDefaultImports`, `alwaysStrict`, `baseUrl`, `downlevelIteration`, and any `dom.iterable` / `dom.asynciterable` entries.

> **Tip:** `"ignoreDeprecations": "6.0"` mutes the deprecation warnings, but TypeScript 7 will *remove* every deprecated option — don't lean on this past the migration window.

---

## Discriminated unions everywhere

If you remember one thing from this reference, it's this: **state lives in a tagged union, not in independent booleans/nulls**.

```typescript
// Bad: 16 logically possible combinations, only 4 valid
type Req = { loading: boolean; data?: User; error?: Error; retries: number };

// Good: 4 states, each carrying only its valid fields
type Req =
  | { status: "idle" }
  | { status: "loading"; startedAt: number; retries: number }
  | { status: "success"; data: User; fetchedAt: number }
  | { status: "error";   error: Error; retries: number };
```

Combined with `switch` exhaustiveness, the compiler enforces that you handle every case. See [discriminated-union-state.md](../patterns/discriminated-union-state.md) for the full pattern.

### `assertNever` for exhaustiveness

```typescript
function assertNever(x: never): never {
  throw new Error(`unhandled: ${JSON.stringify(x)}`);
}

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":    return Math.PI * s.radius ** 2;
    case "rectangle": return s.w * s.h;
    default:          return assertNever(s); // fails to compile if missing case
  }
}
```

---

## `satisfies` — type-check without widening

`satisfies` checks that a value matches a type **without changing the inferred type of the value**. Classic conflict: you want the literal type for downstream inference *and* shape-checking against a contract.

```typescript
type Colors = "red" | "green" | "blue";
type Config = Partial<Record<Colors, string | number>>;

// Without satisfies — type widens to Config; literal keys/values lost
const a: Config = { red: "#f00", green: 0x00ff00 };
// a.red.length;  // ❌ string | number, may not have length

// With satisfies — type is { red: string; green: number }, shape-checked against Config
const b = { red: "#f00", green: 0x00ff00 } satisfies Config;
b.red.length;       // ✅ string
b.green.toFixed(0); // ✅ number
```

Use `satisfies` for configuration, registries, fixtures, and anywhere you want narrow types on the *value* and shape-check against a *contract*.

```typescript
// Strategy registry — keys stay literal, values stay narrow.
const formatters = {
  json: (x: unknown) => JSON.stringify(x),
  yaml: (x: unknown) => /* … */ "",
  toml: (x: unknown) => /* … */ "",
} satisfies Record<string, (x: unknown) => string>;

type FormatName = keyof typeof formatters;  // "json" | "yaml" | "toml"
```

---

## `const` type parameters

A `const` generic captures the **literal** value of an argument instead of widening:

```typescript
// Without const: T widens to string[]
function tag<T extends readonly string[]>(items: T) { return items; }
const a = tag(["a", "b"]); // T = string[]

// With const: T is the readonly tuple of literals
function tag<const T extends readonly string[]>(items: T) { return items; }
const b = tag(["a", "b"]); // T = readonly ["a", "b"]
```

Useful for:

- DSL-style APIs where literal types matter (route definitions, action tags).
- Type-state markers (`from("users")` should remember `"users"`).
- Builders where each call should produce a tighter type.

```typescript
function defineRoutes<const T extends readonly { path: string; handler: Handler }[]>(routes: T): T {
  return routes;
}

const routes = defineRoutes([
  { path: "/users",     handler: usersHandler },
  { path: "/users/:id", handler: userHandler  },
]);

type RoutePaths = typeof routes[number]["path"]; // "/users" | "/users/:id"
```

---

## `NoInfer<T>` — control inference direction

`NoInfer<T>` prevents one parameter from influencing inference of a generic.

```typescript
// Without NoInfer: TS infers S from BOTH `state` and `transitions`, often picking too-wide
function makeMachine<S extends string>(state: S, transitions: Record<S, S>): S {
  return state;
}
makeMachine("open", { open: "closed", closed: "open" });
// works — but S widens to "open" | "closed" because the transitions object pollutes inference

// With NoInfer: only the first arg drives inference
function makeMachine<S extends string>(state: S, transitions: Record<NoInfer<S>, S>): S {
  return state;
}
makeMachine("open", { open: "closed" });
// ❌ Property "closed" is missing — TS knows S is just "open"
```

Use for APIs where one parameter should "set the type" and others should "be checked against it" — builders, reducer-style helpers, query factories.

> **TS 6 bonus:** `this`-less methods now participate in generic inference. Patterns that previously required arrow rewrites can use method syntax cleanly:
>
> ```typescript
> callIt({
>   produce(x: number) { return x * 2; },
>   consume(y) { return y.toFixed(); },   // y inferred as number in TS 6
> });
> ```

---

## `using` and explicit resource management

Disposable resources clean themselves up at scope exit. Replaces every `try/finally { close() }` pattern.

```typescript
class FileHandle implements Disposable {
  constructor(private fd: number) {}
  read(): string { /* … */ return ""; }
  [Symbol.dispose](): void { fs.closeSync(this.fd); }
}

function readConfig(path: string) {
  using fh = new FileHandle(fs.openSync(path, "r"));
  return JSON.parse(fh.read());
  // fh[Symbol.dispose]() called automatically here
}
```

Async version with `AsyncDisposable`:

```typescript
class DbTx implements AsyncDisposable {
  constructor(private conn: Connection, private committed = false) {}
  async commit() { this.committed = true; await this.conn.query("COMMIT"); }
  async [Symbol.asyncDispose]() {
    if (!this.committed) await this.conn.query("ROLLBACK");
  }
}

async function transfer(from: string, to: string, amount: number) {
  await using tx = await db.beginTx();
  await tx.query("UPDATE accounts SET balance = balance - $1 WHERE id = $2", [amount, from]);
  await tx.query("UPDATE accounts SET balance = balance + $1 WHERE id = $2", [amount, to]);
  await tx.commit();
  // If anything throws, [Symbol.asyncDispose] rolls back.
}
```

Use for:

- DB transactions, file handles, locks, spans, timers, subscriptions.
- Pairing with [`Result`](../patterns/result.md): cleanup happens regardless of return branch.

Native in Node 22+, Bun, Deno. Available in browsers; check caniuse before relying on it client-side.

---

## Stage-3 decorators

TypeScript ships Stage-3 decorators with fully-inferred decorator types. No `--experimentalDecorators` needed.

```typescript
function logged<This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) {
  const name = String(context.name);
  return function (this: This, ...args: Args): Return {
    console.log(`→ ${name}(${args.map(String).join(", ")})`);
    const result = target.call(this, ...args);
    console.log(`← ${name}`);
    return result;
  };
}

class Calculator {
  @logged
  add(a: number, b: number) { return a + b; }
}
```

Caveat: frameworks like NestJS and TypeORM still target the legacy experimental decorators. Check before mixing.

---

## Template literal types

Type-level string manipulation. Powers route typing, event-name typing, branded ID schemes.

```typescript
type Method = "GET" | "POST" | "PUT" | "DELETE";
type Path   = `/users` | `/users/${string}` | `/orders` | `/orders/${string}`;
type Route  = `${Method} ${Path}`;

function handle<R extends Route>(route: R, fn: () => void) { /* … */ }
handle("POST /orders", () => {});        // ✅
// handle("FETCH /users", () => {});    // ❌ "FETCH" not a Method
```

### Extracting from templates

```typescript
type Params<T> =
  T extends `${string}:${infer P}/${infer Rest}`
    ? { [K in P | keyof Params<`/${Rest}`>]: string }
    : T extends `${string}:${infer P}`
    ? { [K in P]: string }
    : {};

type R = Params<"/users/:userId/orders/:orderId">;
// { userId: string; orderId: string }
```

Frameworks like Hono and Elysia use this extensively to type endpoints from their string definitions.

---

## Branded / nominal types

TypeScript is structural. To get nominal-style identity, intersect with a phantom marker.

```typescript
declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

type UserId  = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;
type Cents   = Brand<number, "Cents">;

function chargeUser(id: UserId, amount: Cents) { /* … */ }
chargeUser("u_1" as UserId, 1000 as Cents);          // ✅
chargeUser("u_1" as OrderId, 1000 as Cents);          // ❌
```

For more, see [branded-types.md](../patterns/branded-types.md).

---

## Iterator helpers (ES2025)

Native methods on iterators — no library needed. Stable across Node 22+, Bun, Deno, modern browsers; pulled into the `es2025` lib.

```typescript
function* naturals() { let i = 0; while (true) yield i++; }

const first10Squares = naturals()
  .map((n) => n * n)
  .take(10)
  .toArray();

// File walk + filter + take, lazily
async function* files(dir: string): AsyncGenerator<string> { /* … */ }

const tsFiles: string[] = await Array.fromAsync(
  files(".").filter((f) => f.endsWith(".ts")).take(100),
);
```

`Array.fromAsync` + iterator helpers replace most ad-hoc pagination and streaming code. See [iterator.md](../patterns/iterator.md).

---

## Set methods (ES2025)

Set operations no longer require libraries.

```typescript
const a = new Set(["read", "write", "delete"]);
const b = new Set(["read", "execute"]);

a.union(b);                // { read, write, delete, execute }
a.intersection(b);         // { read }
a.difference(b);           // { write, delete }
a.symmetricDifference(b);  // { write, delete, execute }
a.isSubsetOf(b);           // false
a.isSupersetOf(b);         // false
a.isDisjointFrom(b);       // false
```

Permission systems, capability checks, tag filters become one-liners.

---

## Map upsert methods (ES2025)

`Map.prototype.getOrInsert` and `getOrInsertComputed` replace the "check, set, return" dance:

```typescript
// Before
let v: V;
if (cache.has(k)) v = cache.get(k)!;
else { v = expensive(k); cache.set(k, v); }

// After
const v = cache.getOrInsertComputed(k, expensive);
```

Built-in `Memoize` decorators and flyweight registries get simpler. Available via `lib: ["es2025"]` (or `esnext` for cutting-edge runtimes).

---

## `Temporal` for dates and times

The stage-4 `Temporal` proposal replaces the legacy `Date` for nearly everything. TS 6 ships the types in `lib.esnext.temporal.d.ts`.

```typescript
const now = Temporal.Now.instant();
const tomorrow = now.add({ hours: 24 });

// Calendar-aware durations, time zones as first-class
const meeting = Temporal.ZonedDateTime
  .from("2026-06-01T09:00[America/New_York]")
  .add({ days: 30 });

// Round-trip:
JSON.stringify(meeting);  // "2026-07-01T09:00:00-04:00[America/New_York]"
```

Available natively in Node 22+ / Bun / Deno / Chrome 138+. For older targets, the official polyfill is `@js-temporal/polyfill`.

Where to use:

- Anywhere you'd use `Date` arithmetic and dread DST / leap-second / time-zone bugs.
- Cron-like schedules (`Temporal.PlainTime` + a calendar walk).
- Branded "calendar day" vs "instant" types (`PlainDate` ≠ `Instant`).

`Date` is now a legacy fallback, the way `var` is a legacy fallback for `let`.

---

## Schema parsing at boundaries

Untyped data crossing a boundary must be validated. The 2026 landscape:

| Library | Style | Notes |
| --- | --- | --- |
| **Zod 4** | Declarative builder | Largest ecosystem, rewritten internals for speed |
| **Valibot** | Tree-shakable pipeline | Smallest bundle |
| **ArkType** | TS-syntax DSL parsed at the type level | Best inference; growing community |
| **TypeBox** | JSON-Schema-first | Pick this when you also emit JSON Schema (e.g., Fastify) |
| **Standard Schema** | Cross-library interop spec | Hono / tRPC / TanStack accept any schema that implements it |

Pick one per project. Zod is the safe default. Anything that implements `Standard Schema` plays nicely with modern routers and form libraries.

```typescript
import { z } from "zod";

const UserInput = z.object({
  email:    z.string().email().brand<"Email">(),
  password: z.string().min(12),
  age:      z.number().int().min(13).optional(),
});

type UserInput = z.infer<typeof UserInput>; // email is branded

function signUp(input: unknown) {
  const parsed = UserInput.safeParse(input);
  if (!parsed.success) return Err({ kind: "validation", issues: parsed.error.issues });
  // parsed.data.email is `string & Brand<"Email">`
  return doSignUp(parsed.data);
}
```

Branded outputs let downstream code trust the type.

---

## Type-level utilities you should know

```typescript
// Built-in
type Foo = Partial<User>;            // all keys optional
type Bar = Required<User>;           // all keys required
type Pick1 = Pick<User, "id" | "name">;
type Omit1 = Omit<User, "password">;
type Read  = Readonly<User>;
type Rec   = Record<"a" | "b", number>;
type Param = Parameters<typeof someFn>;
type Ret   = ReturnType<typeof someFn>;
type Wait  = Awaited<Promise<User>>;  // User
type Inst  = InstanceType<typeof User>;
type NN    = NonNullable<User | null>;
type NoInferT = NoInfer<T>;

// Discriminated narrowing
type OnlyError<T> = Extract<T, { kind: "error" }>;
type NoErrors<T>  = Exclude<T, { kind: "error" }>;
```

### Custom utilities every project ends up writing

```typescript
type DeepReadonly<T> =
  T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type ValueOf<T> = T[keyof T];

type StrictExtract<T, U extends T> = Extract<T, U>;

type UnionToIntersection<U> =
  (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
```

Define these once in `src/types.ts`. They show up in every TypeScript codebase.

---

## Pattern → modern TS expression

Quick map from the GoF / catalog patterns to their idiomatic TS 6 form. Use this when you're about to reach for a classical implementation.

| Classical pattern | Modern TS idiom |
| --- | --- |
| **Strategy** | Function type, or interface with one method. Inject the function. |
| **Observer** | `Signal` / `Computed`, async generators, or `EventTarget`. |
| **Factory Method** | A plain function returning the product. |
| **Abstract Factory** | An object literal mapping keys to constructors (`satisfies` for shape checking). |
| **Builder** | Function with options object + `satisfies`. Or [type-state](../patterns/type-state.md). |
| **Prototype** | `structuredClone(template)`; spread for shallow. |
| **Singleton** | Module-scope constant. Or DI singleton-scope. |
| **Adapter** | Wrapper function or class that translates one shape to another. |
| **Bridge** | Two interfaces; composition via constructor injection. |
| **Composite** | Recursive interface with children; `Array.prototype.flatMap` for traversal. |
| **Decorator** | Higher-order function: `(fn) => (...) => fn(...)`. |
| **Facade** | A single exported function that hides a subsystem. |
| **Flyweight** | `Map<key, immutable>` with `WeakRef` for GC. Or `Map.getOrInsertComputed` (ES2025). |
| **Proxy** | `Proxy` builtin, or wrapper class with same interface. |
| **Command** | Discriminated union of action types; a reducer to dispatch them. |
| **Iterator** | `[Symbol.iterator]` / `[Symbol.asyncIterator]` generators + ES2025 iterator helpers. |
| **Mediator** | An event bus or a function that orchestrates. |
| **Memento** | `structuredClone(state)`; or keep state immutable. |
| **State** | [Discriminated union state](../patterns/discriminated-union-state.md), reducer over it. |
| **Template Method** | A higher-order function that takes "hook" callbacks. |
| **Visitor** | Discriminated union + exhaustive `switch`. Classical Visitor only across library boundaries. |
| **Chain of Responsibility** | Array of handlers + `find` / loop; or middleware composition. |
| **Repository** | Interface in domain; implementation per DB. |
| **Unit of Work** | DB transaction + `await using`. |
| **Identity Map** | `Map<id, entity>` per session. |
| **DTO** | Zod schema → `z.infer` → typed object. |

When the classical pattern doesn't appear in your TS code at all but the *intent* does, you're doing it right. The patterns are the underlying ideas; TS 6 syntax is shorter than the originals because the type system absorbed many of them.

---

## Style Conventions

A few stylistic choices that 2026-era TypeScript codebases converge on.

### Type-only imports

```typescript
import { type Logger } from "./logger";    // erased at compile
import type { User } from "./domain";       // pure type import
```

With `verbatimModuleSyntax`, this is required. Helps bundlers tree-shake.

### `as const` for literal-typed values

```typescript
const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = typeof LEVELS[number]; // "debug" | "info" | "warn" | "error"
```

### Discriminate by `kind` (preferred) / `type` / `_tag`

Pick one across the codebase. `kind` is most common; `type` collides with TS reserved meaning in object positions but works fine; `_tag` is fp-ts style.

### Prefer interfaces for public types, type aliases for internal

```typescript
// Public API
export interface User { /* … */ }   // extendable via declaration merging

// Internal helper
type UserRow = /* … */;
```

Both work; soft convention.

### No `Function`, no `Object`, no `{}`

The "obvious" wide types are anti-types. Use `(...args: never[]) => unknown` for arbitrary functions, `Record<string, unknown>` for arbitrary objects, etc.

---

## What about Effect?

[Effect](https://effect.website/) is a comprehensive functional ecosystem that subsumes:

- `Result` (`Either`)
- Resource management (`Scope`, `Layer`)
- Concurrency (`Fiber`)
- Dependency injection (`Context.Tag`)
- Retry / circuit breaker / timeout
- Streams

If your team is comfortable with FP and willing to commit, Effect is the most cohesive answer to "how do we handle errors, resources, and effects?" in TypeScript. It pays off most for complex async / distributed code.

Plain TypeScript with the patterns from this skill is still the default. Effect is a power tool.

---

## Looking ahead: TypeScript 7

TypeScript 7 (the native Go port, codenamed `tsgo`) is targeted for **late 2026 / early 2027** and aims for 10× faster type-checks. From a *pattern* perspective, nothing in this catalog changes — the type system stays the same. What changes:

- Every TS 6 deprecation is *removed*.
- Type ordering is deterministic (`--stableTypeOrdering` becomes the default).
- The plugin API is new; any TS plugins your tooling depends on will need a refresh.

If you adopt the TS 6 baseline above and clear every deprecation warning, the move to TS 7 is mostly a compiler swap.

---

## Summary

TypeScript 6 collapses two years of accumulated defaults into one release. With `strict`, `esnext`, and `es2025` baked in, the new floor of "modern TS" is higher than ever — and most of GoF dissolves into discriminated unions, `using`, `satisfies`, and ordinary functions.

Default to strict mode, parse at boundaries, brand your IDs, narrow with switches, dispose with `using`, prefer `Temporal` over `Date`, and let the compiler do as much of the work as it can.
