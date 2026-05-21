# Modern TypeScript (2026 Edition)

How to express classic design patterns idiomatically in TypeScript 5.x. Covers `satisfies`, `const` type parameters, `NoInfer`, `using`, decorators, template literal types, branded types, and what changed between the 2014 "TypeScript-for-Java-devs" style and the 2026 mainstream.

> Reference baseline: TypeScript 5.9 (Aug 2025), Node 22+, native ESM, `"strict": true`.

## Table of Contents

1. [Compiler config baseline](#compiler-config-baseline)
2. [Discriminated unions everywhere](#discriminated-unions-everywhere)
3. [`satisfies` — type-check without widening](#satisfies--type-check-without-widening)
4. [`const` type parameters](#const-type-parameters)
5. [`NoInfer<T>` — control inference direction](#noinfer-t--control-inference-direction)
6. [`using` and explicit resource management](#using-and-explicit-resource-management)
7. [Stage-3 decorators](#stage-3-decorators)
8. [Template literal types](#template-literal-types)
9. [Branded / nominal types](#branded--nominal-types)
10. [Iterator helpers (ES2025)](#iterator-helpers-es2025)
11. [Set methods (ES2025)](#set-methods-es2025)
12. [Schema parsing at boundaries](#schema-parsing-at-boundaries)
13. [Type-level utilities you should know](#type-level-utilities-you-should-know)
14. [Pattern → modern TS expression](#pattern--modern-ts-expression)

---

## Compiler config baseline

Start here; loosen only with a comment justifying each relaxation.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",                  // or higher; aligns with Node 20+ / modern browsers
    "module": "ESNext",
    "moduleResolution": "bundler",       // 5.0+; correct for modern bundlers & native ESM
    "lib": ["ES2024", "DOM"],            // bump as runtimes advance

    "strict": true,                       // the non-negotiable baseline
    "noUncheckedIndexedAccess": true,    // arr[i] : T | undefined
    "exactOptionalPropertyTypes": true,  // `?: T` differs from `: T | undefined`
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,

    "verbatimModuleSyntax": true,        // import type stays as type
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,

    "resolveJsonModule": true,
    "allowImportingTsExtensions": true   // for `import "./x.ts"` in dev
  }
}
```

Every flag here pays for itself within a week of strict adoption. The ones most commonly skipped (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) are the ones that catch the bugs you didn't know you had.

---

## Discriminated unions everywhere

If you remember one thing from this reference, it's this: **state lives in a tagged union, not in independent booleans/nulls**.

```typescript
// Bad: 16 logically possible combinations, 4 valid
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

`satisfies` (TS 4.9+) lets you check that a value matches a type **without changing the inferred type of the value**. Classic conflict: you want the literal type for downstream inference *and* shape-checking.

```typescript
type Colors = "red" | "green" | "blue";
type Config = Partial<Record<Colors, string | number>>;

// Without satisfies — type is Config; literal keys/values lost
const a: Config = { red: "#f00", green: 0x00ff00 };
// a.red.length;  // ❌ error — string | number, may not have length

// With satisfies — type is { red: string; green: number }, satisfies Config
const b = { red: "#f00", green: 0x00ff00 } satisfies Config;
b.red.length;  // ✅ string
b.green.toFixed(0); // ✅ number
```

Use `satisfies` for configuration, registries, fixtures, and anywhere you want narrow types for the *value* and shape-check against a *contract*.

```typescript
// Strategy registry — keys stay literal, values stay narrow.
const formatters = {
  json: (x: unknown) => JSON.stringify(x),
  yaml: (x: unknown) => /* … */ "",
  toml: (x: unknown) => /* … */ "",
} satisfies Record<string, (x: unknown) => string>;

type FormatName = keyof typeof formatters;  // "json" | "yaml" | "toml" — usable as a union
```

---

## `const` type parameters

TS 5.0 lets a generic parameter capture the **literal** value instead of widening:

```typescript
// Without const: T is widened to string[]
function tag<T extends readonly string[]>(items: T) { return items; }
const a = tag(["a", "b"]); // T = string[]

// With const: T is the tuple of literals
function tag<const T extends readonly string[]>(items: T) { return items; }
const b = tag(["a", "b"]); // T = readonly ["a", "b"]
```

Useful for:

- DSL-like APIs where literal types matter (route definitions, action types).
- Type-state markers (`from("table")` should remember `"table"`).
- Builders where each call should produce a tighter type.

```typescript
function defineRoutes<const T extends readonly { path: string; handler: Handler }[]>(routes: T): T {
  return routes;
}

const routes = defineRoutes([
  { path: "/users",       handler: usersHandler },
  { path: "/users/:id",   handler: userHandler },
] as const);

type RoutePaths = typeof routes[number]["path"]; // "/users" | "/users/:id"
```

---

## `NoInfer<T>` — control inference direction

TS 5.4. Prevents one parameter from influencing inference of a generic.

```typescript
// Without NoInfer: TS infers T from BOTH `state` and `transitions`, often picking too-wide
function makeMachine<S extends string>(state: S, transitions: Record<S, S>): /* … */ S { return state; }

makeMachine("open", { open: "closed", closed: "open" });
// works, but T inferred from both args — sometimes wrong order

// With NoInfer: only the first arg drives inference
function makeMachine<S extends string>(
  state: S,
  transitions: Record<NoInfer<S>, S>,
): S { return state; }

makeMachine("open", { open: "closed" });
// ❌ Property 'closed' is missing — TS knows S is "open" | "closed" but transitions[closed] is missing
```

Use for APIs where one parameter should "set the type" and others should "be checked against it" — common in builders and reducer-style helpers.

---

## `using` and explicit resource management

TS 5.2 + Node 22 / Bun / Deno. Disposable resources clean themselves up at scope exit. Replaces try/finally for handles.

```typescript
class FileHandle implements Disposable {
  constructor(private fd: number) {}
  read(): string { /* … */ return ""; }
  [Symbol.dispose](): void { fs.closeSync(this.fd); }
}

function readConfig(path: string) {
  using fh = new FileHandle(fs.openSync(path, "r"));
  return JSON.parse(fh.read());
  // fh.[Symbol.dispose]() called automatically here
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
- Replacing every `try { } finally { close(); }` pattern.
- Pairing with `Result`: cleanup happens regardless of return branch.

---

## Stage-3 decorators

TS 5.0+ ships Stage-3 decorators (different from the old experimental ones). No more `--experimentalDecorators` for new code.

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

Decorator types are properly inferred — no `any` parameters. Useful for cross-cutting concerns (logging, caching, validation, metrics) when you want the syntax sugar.

Caveat: framework decorators (NestJS, TypeORM) often still target the *experimental* version. Check before mixing.

---

## Template literal types

Type-level string manipulation. Powers route-typing, event-name typing, branded ID schemes, etc.

```typescript
type Method = "GET" | "POST" | "PUT" | "DELETE";
type Path = `/users` | `/users/${string}` | `/orders` | `/orders/${string}`;
type Route = `${Method} ${Path}`;

// "GET /users", "POST /orders", etc. are valid; "FETCH /users" is a type error.
function handle<R extends Route>(route: R, fn: () => void) { /* … */ }
handle("POST /orders", () => {});
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

Frameworks like tRPC, Hono, and Elysia use this extensively to type endpoints from their string definitions.

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
chargeUser("u_1" as UserId, 1000 as Cents);
chargeUser("u_1" as OrderId, 1000 as Cents); // ❌
```

For more, see [branded-types.md](../patterns/branded-types.md).

---

## Iterator helpers (ES2025)

Native methods on iterators — no library needed. Node 22+, Bun, Deno, Chrome 122+.

```typescript
function* naturals() { let i = 0; while (true) yield i++; }

const first10Squares = naturals()
  .map((n) => n * n)
  .take(10)
  .toArray();

// File walk + filter, lazily
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

a.union(b);              // { read, write, delete, execute }
a.intersection(b);       // { read }
a.difference(b);         // { write, delete }
a.symmetricDifference(b);// { write, delete, execute }
a.isSubsetOf(b);         // false
a.isSupersetOf(b);       // false
a.isDisjointFrom(b);     // false
```

Permission systems, capability checks, tag filters — all became one-liners.

---

## Schema parsing at boundaries

Untyped data crossing a boundary should be validated. Major options in 2026:

| Library | Style | Notes |
| --- | --- | --- |
| **Zod 4** | Declarative builder | Largest ecosystem, slowest in 4.0 — but 4.x has rewritten internals |
| **Valibot** | Pipeline-style | Smallest bundle, very fast |
| **ArkType** | TypeScript-syntax DSL | Parses TS-like syntax at type level |
| **TypeBox** | JSON-Schema-first | Best when you also need JSON Schema |

Pick one per project. Zod is the safe default; Valibot if bundle size matters; ArkType if you love type-level magic.

```typescript
import { z } from "zod";

const UserInput = z.object({
  email:    z.string().email().brand<"Email">(),
  password: z.string().min(12),
  age:      z.number().int().min(13).optional(),
});

type UserInput = z.infer<typeof UserInput>; // branded type for email

function signUp(input: unknown) {
  const parsed = UserInput.safeParse(input);
  if (!parsed.success) return Err({ kind: "validation", issues: parsed.error.issues });
  // parsed.data.email is `string & Brand<"Email">`
  return doSignUp(parsed.data);
}
```

Branded outputs let the rest of the code trust the type.

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

Quick map from the GoF / catalog patterns to their idiomatic TypeScript form. Use this when you're about to reach for a classical implementation.

| Classical pattern | Modern TS idiom |
| --- | --- |
| **Strategy** | Function type, or interface with one method. Inject the function. |
| **Observer** | `Signal`/`Computed`, or async generators, or `EventTarget`. |
| **Factory Method** | A plain function returning the product. |
| **Abstract Factory** | An object literal mapping keys to constructors (`satisfies` to check shape). |
| **Builder** | Function with options object + `satisfies`. Or [type-state](../patterns/type-state.md). |
| **Prototype** | `structuredClone(template)`; spread for shallow. |
| **Singleton** | Module-scope constant. Or DI singleton-scope. |
| **Adapter** | Wrapper function or class that translates one shape to another. |
| **Bridge** | Two interfaces; composition via constructor injection. |
| **Composite** | Recursive interface with children; `Array.prototype.flatMap` for traversal. |
| **Decorator** | Higher-order function: `(fn) => (...) => fn(...)`. |
| **Facade** | A single exported function that hides a subsystem. |
| **Flyweight** | `Map<key, immutable>` with `WeakRef` for GC. |
| **Proxy** | `Proxy` builtin, or wrapper class with same interface. |
| **Command** | Discriminated union of action types; a reducer to dispatch them. |
| **Iterator** | `[Symbol.iterator]` / `[Symbol.asyncIterator]` generators. |
| **Mediator** | An event bus or a function that orchestrates. |
| **Memento** | `structuredClone(state)`; or just keep state immutable. |
| **State** | [Discriminated union state](../patterns/discriminated-union-state.md), reducer over it. |
| **Template Method** | A higher-order function that takes "hook" callbacks. |
| **Visitor** | Discriminated union + exhaustive `switch`. Classical Visitor only across library boundaries. |
| **Chain of Responsibility** | Array of handlers + `find`/loop; or middleware composition. |
| **Repository** | Interface in domain; implementation per DB. |
| **Unit of Work** | DB transaction + `await using`. |
| **Identity Map** | `Map<id, entity>` per session. |
| **DTO** | Zod schema → `z.infer` → typed object. |

When the classical pattern doesn't appear in your TS code at all but the *intent* does, you're doing it right. The patterns are the underlying ideas; the syntax is shorter than the originals because TypeScript pushed many of them into the type system or the standard library.

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

Pick one across the codebase. `kind` is most common; `type` collides with TS's reserved meaning in object positions but works fine; `_tag` is fp-ts style.

### Prefer interfaces for public types, type aliases for internal

```typescript
// Public API
export interface User { /* … */ }   // extendable via declaration merging if needed

// Internal helper
type UserRow = /* … */;
```

Both work; this is a soft convention.

### No `Function`, no `Object`, no `{}`

The "obvious" wide types are anti-types. Use `(...args: never[]) => unknown` for arbitrary functions, `Record<string, unknown>` for arbitrary objects, etc.

---

## What about Effect-TS?

[Effect](https://effect.website/) is a comprehensive functional ecosystem that subsumes:

- `Result` (`Either`)
- Resource management (`Scope`, `Layer`)
- Concurrency (`Fiber`)
- Dependency injection (`Context.Tag`)
- Retry / circuit breaker / timeout
- Streams

If your team is comfortable with FP and willing to commit, Effect is the most cohesive answer to "how do we handle errors, resources, and effects?" in TypeScript. It's a steeper learning curve than the patterns in this skill, but it pays off for complex async / distributed code.

Plain TypeScript with the patterns from this skill is still the default. Effect is a power tool.

## Summary

Modern TypeScript subsumes about half of GoF in the type system. The other half stays useful but their idiomatic form is smaller — a function instead of a class, a discriminated union instead of a class hierarchy, a `using` instead of a `try/finally`.

Default to strict mode, parse at boundaries, brand your IDs, narrow with switches, dispose with `using`, and let the compiler do as much of the work as it can.
