# Functional Patterns

Patterns that come from the functional-programming tradition. They aren't in GoF — most predate it — but they're now mainstream in TypeScript, React, signals-based frameworks, and any team that takes correctness seriously.

## Table of Contents

1. [Pure functions](#pure-functions)
2. [Immutability](#immutability)
3. [Higher-order functions](#higher-order-functions)
4. [Currying & partial application](#currying--partial-application)
5. [Function composition](#function-composition)
6. [Pipelines](#pipelines)
7. [Algebraic data types (ADTs)](#algebraic-data-types-adts)
8. [`Option` / `Maybe`](#option--maybe)
9. [`Either` / `Result`](#either--result)
10. [Railway-Oriented Programming](#railway-oriented-programming)
11. [Folds & reducers](#folds--reducers)
12. [Lenses & immutable updates](#lenses--immutable-updates)
13. [Lazy evaluation](#lazy-evaluation)
14. [Effects & purity boundaries](#effects--purity-boundaries)
15. [When to go full FP](#when-to-go-full-fp)

---

## Pure functions

> Same input → same output. No side effects.

```typescript
// Pure
const add = (a: number, b: number) => a + b;

// Impure (clock; not same input → same output)
const stampedAdd = (a: number, b: number) => ({ result: a + b, at: new Date() });

// Impure (mutation)
const pushAndReturn = <T>(arr: T[], x: T) => { arr.push(x); return arr; };
```

**Why care:** pure functions are trivially testable, parallelisable, and memoisable. They're the building blocks of any reliable system. Put your hard logic in pure functions; isolate impurity at the edges.

---

## Immutability

Don't mutate; produce new values.

```typescript
// Mutating (bad)
function addItem(cart: Cart, item: Item) {
  cart.items.push(item);
  cart.total += item.price * item.qty;
  return cart;
}

// Immutable
function addItem(cart: Cart, item: Item): Cart {
  return {
    ...cart,
    items: [...cart.items, item],
    total: cart.total + item.price * item.qty,
  };
}
```

Use `readonly` and `ReadonlyArray<T>` to encode immutability in the type system:

```typescript
type Cart = {
  readonly items: ReadonlyArray<Item>;
  readonly total: number;
};
```

For nested immutability without spread-fatigue, reach for **Immer** (`produce(state, draft => { draft.x.y = 1 })`) or **immutable.js** for very deep / persistent structures.

---

## Higher-order functions

A function that takes or returns a function.

```typescript
// Take
function map<T, U>(arr: T[], fn: (t: T) => U): U[] { /* … */ return []; }

// Return
function multiplier(n: number) { return (x: number) => x * n; }
const double = multiplier(2);
const triple = multiplier(3);

// Both
function memoize<A, R>(fn: (a: A) => R): (a: A) => R {
  const cache = new Map<A, R>();
  return (a) => {
    if (cache.has(a)) return cache.get(a)!;
    const r = fn(a);
    cache.set(a, r);
    return r;
  };
}
```

`map`, `filter`, `reduce` — the classic three — are higher-order functions. So are React hooks, middleware factories, and most TypeScript decorators.

---

## Currying & partial application

Turn an `(a, b, c) => r` function into `a => b => c => r`. Lets you fix arguments one at a time.

```typescript
// Manual currying
const add3 = (a: number) => (b: number) => (c: number) => a + b + c;
const add5and10 = add3(5)(10); // (c) => c + 15

// Partial application (Function.bind)
const greet = (greeting: string, name: string) => `${greeting}, ${name}`;
const helloFor = greet.bind(null, "Hello"); // (name) => "Hello, " + name

// Type-safe partial — write it ad-hoc
const partial = <A, B, R>(fn: (a: A, b: B) => R, a: A) => (b: B) => fn(a, b);
```

Curry isn't always the right reach — it can hurt readability — but it shines for **dependency-fixing** (configure a function once, call it many times):

```typescript
const fetchAt = (baseUrl: string) => (path: string) => fetch(`${baseUrl}${path}`);
const api = fetchAt("https://api.example.com");

await api("/users");
await api("/orders");
```

This is the functional equivalent of constructor injection.

---

## Function composition

Combine small functions into bigger ones. `compose(f, g)(x) = f(g(x))`.

```typescript
const compose2 = <A, B, C>(f: (b: B) => C, g: (a: A) => B) => (a: A): C => f(g(a));

const exclaim   = (s: string) => `${s}!`;
const uppercase = (s: string) => s.toUpperCase();
const shout     = compose2(exclaim, uppercase);

shout("hello"); // "HELLO!"
```

In practice you want N-ary composition. Typing it generically is awkward; libraries solve it (`pipe`/`flow` in fp-ts, `lodash/fp`, Effect, Ramda).

```typescript
// fp-ts
import { pipe, flow } from "fp-ts/function";

const shout = flow(
  (s: string) => s.toUpperCase(),
  (s: string) => `${s}!`,
);
```

---

## Pipelines

Compose but with values flowing left-to-right (more readable for sequential operations).

```typescript
// Hand-rolled pipe
function pipe<A>(a: A): A;
function pipe<A, B>(a: A, ab: (a: A) => B): B;
function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D;
function pipe(a: unknown, ...fns: ((x: unknown) => unknown)[]): unknown {
  return fns.reduce((acc, fn) => fn(acc), a);
}

const result = pipe(
  "  hello  ",
  (s) => s.trim(),
  (s) => s.toUpperCase(),
  (s) => `${s}!`,
);
// "HELLO!"
```

TC39's [pipe operator proposal](https://github.com/tc39/proposal-pipeline-operator) (`|>`) would make this native syntax; it's been stage 2 for a while but stalled in 2024. For now, library `pipe` is the universal choice.

For async, use the same shape with `await`s, or libraries that compose `Promise`-returning functions.

---

## Algebraic data types (ADTs)

Sum types (unions: "is one of") + product types (records: "has both"). Together they express any data model.

```typescript
// Product
type Point = { x: number; y: number };

// Sum
type Shape =
  | { kind: "circle";    radius: number }
  | { kind: "rectangle"; w: number; h: number }
  | { kind: "triangle";  a: number; b: number; c: number };

// Sum of products with parametric type
type Tree<T> =
  | { kind: "leaf" }
  | { kind: "node"; value: T; left: Tree<T>; right: Tree<T> };
```

ADTs + exhaustive pattern matching is how you make illegal states unrepresentable. See [discriminated-union-state.md](../patterns/discriminated-union-state.md).

---

## `Option` / `Maybe`

A typed "maybe present" value. Better than `T | null` because you can map/chain.

```typescript
type Option<T> =
  | { _tag: "Some"; value: T }
  | { _tag: "None" };

const Some = <T>(value: T): Option<T> => ({ _tag: "Some", value });
const None: Option<never> = { _tag: "None" };

const map = <T, U>(o: Option<T>, fn: (t: T) => U): Option<U> =>
  o._tag === "Some" ? Some(fn(o.value)) : None;

const flatMap = <T, U>(o: Option<T>, fn: (t: T) => Option<U>): Option<U> =>
  o._tag === "Some" ? fn(o.value) : None;

const getOrElse = <T>(o: Option<T>, fallback: T): T =>
  o._tag === "Some" ? o.value : fallback;

// Use:
function findUser(id: string): Option<User> { /* … */ return None; }

const name = pipe(
  findUser("u_1"),
  (o) => map(o, (u) => u.name),
  (o) => getOrElse(o, "anonymous"),
);
```

In modern TS, `T | null` works fine with optional chaining (`?.`) and nullish coalescing (`??`). Use `Option` when you want the combinators (`map`, `flatMap`, sequencing).

---

## `Either` / `Result`

The two-channel version of Option: success or failure, both typed. See the full pattern at [result.md](../patterns/result.md). Functional name is `Either<L, R>` (Left = error, Right = value); domain name is `Result<T, E>`.

```typescript
type Result<T, E> =
  | { ok: true;  value: T }
  | { ok: false; error: E };
```

Combinators: `map`, `mapErr`, `flatMap`, `match`. The chain composes errors automatically.

---

## Railway-Oriented Programming

Two parallel tracks — success and failure. Each step is a switch (points): success continues on the success track; failure jumps to the failure track and stays there.

```
input  ─[parse]─[validate]─[charge]─[notify]─▶  ok
            │        │        │        │
            └────────┴────────┴────────┴────▶  err  (jumps once, never returns)
```

```typescript
import { ok, err, type Result } from "./result";

async function placeOrder(input: unknown): Promise<Result<OrderId, PlaceOrderError>> {
  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;

  const validated = validateBusiness(parsed.value);
  if (!validated.ok) return validated;

  const charged = await charge(validated.value);
  if (!charged.ok) return charged;

  return await persistOrder(charged.value);
}
```

Or with combinators:

```typescript
const placeOrder = (input: unknown) =>
  pipe(
    parseInput(input),
    (r) => Result.flatMap(r, validateBusiness),
    (r) => Result.flatMapAsync(r, charge),
    (r) => Result.flatMapAsync(r, persistOrder),
  );
```

This is the FP-idiomatic way to handle error sequences.

---

## Folds & reducers

A `fold` (a.k.a. `reduce`) collapses a structure into a value by combining elements with an accumulator. Native to arrays; generalisable to any recursive data.

```typescript
// Array fold (foldl / reduceLeft)
const sum = [1, 2, 3, 4].reduce((acc, x) => acc + x, 0);

// Tree fold
type Tree<T> = { kind: "leaf" } | { kind: "node"; value: T; left: Tree<T>; right: Tree<T> };

function fold<T, R>(tree: Tree<T>, leaf: R, node: (v: T, l: R, r: R) => R): R {
  if (tree.kind === "leaf") return leaf;
  return node(tree.value, fold(tree.left, leaf, node), fold(tree.right, leaf, node));
}

const count = fold<number, number>(tree, 0, (_, l, r) => 1 + l + r);
const total = fold<number, number>(tree, 0, (v, l, r) => v + l + r);
```

Reducers (the `(state, action) => state` shape) are folds over event streams. Event sourcing replays the event log as a fold. See [reducer.md](../patterns/reducer.md).

---

## Lenses & immutable updates

A **lens** is a `(getter, setter)` pair focused on a part of a structure. It lets you "modify" deeply-nested immutable data:

```typescript
type Lens<S, A> = {
  get(s: S): A;
  set(s: S, a: A): S;
};

const nameLens: Lens<User, string> = {
  get: (u) => u.name,
  set: (u, name) => ({ ...u, name }),
};

// Compose
function compose<S, A, B>(outer: Lens<S, A>, inner: Lens<A, B>): Lens<S, B> {
  return {
    get: (s) => inner.get(outer.get(s)),
    set: (s, b) => outer.set(s, inner.set(outer.get(s), b)),
  };
}
```

In practice, libraries (Immer, monocle-ts, optics-ts) own the lens machinery; you spend your time picking the path:

```typescript
import { produce } from "immer";

const next = produce(state, (draft) => {
  draft.user.address.city = "Paris";
});
// Immutable; only the changed branch is new.
```

Lenses pay off when you have very deep state or many parallel updates. For typical web app state, Immer is enough.

---

## Lazy evaluation

Defer computation until the result is needed. Generators and iterator helpers (see [iterator.md](../patterns/iterator.md)) give you this natively.

```typescript
function* primes(): Generator<number> {
  const yielded: number[] = [];
  for (let n = 2; ; n++) {
    if (yielded.every((p) => n % p !== 0)) {
      yielded.push(n);
      yield n;
    }
  }
}

// Take only what you need — generation stops automatically.
const first10 = primes().take(10).toArray();
```

In React, `useMemo` is a lazy compute (until deps change). In signals, `computed` is lazy by default (it runs only when read).

---

## Effects & purity boundaries

A pure function with effects baked in becomes impure. Pull effects out:

```typescript
// Impure
async function placeOrder(input: OrderInput) {
  const user = await db.users.findOne({ id: input.userId });
  const today = new Date();
  if (today.getDay() === 0 && user.role !== "admin") throw new Error("closed Sundays");
  await db.orders.insert({ /* … */ });
  await mailer.send(/* … */);
}

// Functional core + imperative shell
function decideOrder(user: User, input: OrderInput, today: Date): Decision { /* pure */ }

async function placeOrder(input: OrderInput) {
  const user = await db.users.findOne({ id: input.userId });
  const decision = decideOrder(user!, input, new Date());
  if (decision.kind === "reject") throw new Error(decision.reason);
  await db.orders.insert(decision.order);
  await mailer.send(decision.notification);
}
```

`decideOrder` is testable with no mocks. The shell is small and dominated by I/O.

For full effect tracking, **Effect-TS** encodes effects in the type (`Effect<R, E, A>`) and lets you defer execution:

```typescript
import { Effect, pipe } from "effect";

const program = pipe(
  Effect.tryPromise(() => db.users.findOne({ id })),
  Effect.flatMap((user) =>
    user
      ? Effect.succeed(user)
      : Effect.fail({ kind: "not_found" as const }),
  ),
  Effect.tap((user) => Effect.log(`got ${user.id}`)),
);

const result = await Effect.runPromise(program);
```

You decide when (and whether) to run the effect; combinators preserve the type. Strong choice for production-grade FP teams.

---

## When to go full FP

The patterns above are useful piecemeal. Going **full FP** means: ADTs, pure functions, persistent data structures, monads everywhere. Trade-offs:

| Pros | Cons |
| --- | --- |
| Composability is exceptional | Learning curve is real (a year, honestly) |
| Concurrency safety by default | Hiring is harder |
| Refactoring is dramatic but safe | Library ecosystem outside fp-ts/Effect is sparse |
| Bugs concentrate at the impurity boundary | Some idioms feel alien to mainstream JS devs |

The pragmatic middle:

1. **Default to immutability** at the data layer.
2. **Pure core, imperative shell** for application logic.
3. **`Result` and discriminated unions** for error handling.
4. **Pipelines** for sequenced transformations.
5. **Effects-TS or Async/await** at the boundary.

This gets 80% of the benefit without the cognitive tax.

---

## Reference Reading

- *Domain Modeling Made Functional* — Scott Wlaschin (F#, but the model applies to TS)
- *Grokking Simplicity* — Eric Normand (gentle intro to FP for OO devs)
- *Functional Programming in TypeScript* — Remo H. Jansen
- *Algebra-Driven Design* — Sandy Maguire
- **Libraries:** `fp-ts`, `effect`, `remeda`, `ts-pattern`, `Immer`

The patterns in this reference are toolkit-level — pick them up one at a time as the problem demands. The catalog under `/patterns/` shows the OO equivalents you'll meet in legacy codebases and how to map between them.

## Summary

Pure functions, immutability, ADTs, and pipelines compose into the smallest, most reliable code you can write in TypeScript. You don't have to go full FP; even sprinkling these techniques on top of an OO codebase pays for itself in the first month.
