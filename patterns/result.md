# Result / Either Pattern

> Modern pattern. Not in GoF. Replaces the "throw + try/catch" convention with values that encode success or failure as part of the **type system**. Functional-programming-friendly; sometimes called *Either*, *Try*, or *Outcome*.

## Intent

Make failure a **first-class part of a function's return type**. Callers handle it explicitly instead of via untyped exceptions. Errors are values you can map, chain, and route — like data — not control-flow that bypasses the type checker.

## The Problem

```typescript
async function getUser(id: string): Promise<User> {
  const row = await db.users.findOne({ id });
  if (!row) throw new NotFoundError(`user ${id}`);
  if (row.banned) throw new BannedError();
  return toDomain(row);
}

// Caller has no idea what this can throw.
const user = await getUser(id);
```

**Problems:**

1. The signature lies — it claims to return `User` but in reality returns `User | throw NotFoundError | throw BannedError | throw NetworkError | …`.
2. The compiler doesn't force you to handle errors.
3. `catch (e)` blocks degrade to `e: unknown` — no type-safe pattern match.
4. Hard to compose: every step needs its own try/catch.
5. Stack traces are expensive when errors are expected (validation, not-found).

## The Solution

Return a tagged union: success carries data, failure carries a typed error. The type system enforces handling.

```typescript
// ── Canonical Result type ──────────────────────────────────
type Result<T, E> =
  | { ok: true;  value: T }
  | { ok: false; error: E };

const Ok  = <T>(value: T): Result<T, never> => ({ ok: true,  value });
const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

```typescript
// ── Domain errors as a closed union ────────────────────────
type GetUserError =
  | { kind: "not_found"; id: string }
  | { kind: "banned";    id: string; reason: string }
  | { kind: "db_error";  cause: unknown };

async function getUser(id: string): Promise<Result<User, GetUserError>> {
  let row: UserRow | null;
  try {
    row = await db.users.findOne({ id });
  } catch (cause) {
    return Err({ kind: "db_error", cause });
  }
  if (!row)           return Err({ kind: "not_found", id });
  if (row.banned)     return Err({ kind: "banned", id, reason: row.banReason });
  return Ok(toDomain(row));
}

// ── Caller MUST handle both branches ───────────────────────
const r = await getUser("u_1");
if (!r.ok) {
  switch (r.error.kind) {
    case "not_found": return res.status(404).end();
    case "banned":    return res.status(403).json({ reason: r.error.reason });
    case "db_error":  log.error(r.error.cause); return res.status(500).end();
  }
}
const user = r.value; // narrowed to User
```

The compiler refuses to forget a case in the switch. `r.value` is only accessible inside the `ok: true` branch.

## Combinators

In real code you'll chain many `Result`-returning steps. A small set of combinators avoids nested switches:

```typescript
const ResultOps = {
  map<T, U, E>(r: Result<T, E>, f: (t: T) => U): Result<U, E> {
    return r.ok ? Ok(f(r.value)) : r;
  },

  flatMap<T, U, E>(r: Result<T, E>, f: (t: T) => Result<U, E>): Result<U, E> {
    return r.ok ? f(r.value) : r;
  },

  mapErr<T, E, F>(r: Result<T, E>, f: (e: E) => F): Result<T, F> {
    return r.ok ? r : Err(f(r.error));
  },

  /** Convert a throwing function into a Result. */
  try<T>(fn: () => T): Result<T, unknown> {
    try { return Ok(fn()); }
    catch (e) { return Err(e); }
  },

  async tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, unknown>> {
    try { return Ok(await fn()); }
    catch (e) { return Err(e); }
  },

  /** Unwrap or throw — only at the boundary where exceptions are acceptable. */
  unwrap<T, E>(r: Result<T, E>): T {
    if (!r.ok) throw r.error;
    return r.value;
  },
};
```

## Railway-Oriented Programming

Chains read top-to-bottom like a pipeline; errors short-circuit:

```typescript
async function placeOrder(input: unknown): Promise<Result<OrderId, PlaceOrderError>> {
  const parsed = parseOrderInput(input);            // Result<Input, ValidationError>
  if (!parsed.ok) return parsed;

  const user = await getUser(parsed.value.userId);  // Result<User, GetUserError>
  if (!user.ok) return Err({ kind: "user_failed", cause: user.error });

  const priced = priceOrder(user.value, parsed.value); // Result<PricedOrder, PricingError>
  if (!priced.ok) return Err({ kind: "pricing", cause: priced.error });

  const charged = await charge(user.value, priced.value); // Result<Receipt, ChargeError>
  if (!charged.ok) return Err({ kind: "charge", cause: charged.error });

  const id = await store(priced.value, charged.value);    // string
  return Ok(id);
}
```

This is the "railway": two parallel tracks (success / failure), points (steps) that switch you to failure on any error. No try/catch in the orchestration layer.

## Modern TypeScript Twist

### Branded error tags

Make errors trivially discriminable:

```typescript
type Tagged<Tag extends string, Data> = { readonly _tag: Tag } & Data;

type ValidationError = Tagged<"ValidationError", { issues: Issue[] }>;
type NotFoundError   = Tagged<"NotFoundError",   { id: string }>;
type DbError         = Tagged<"DbError",         { cause: unknown }>;

type AppError = ValidationError | NotFoundError | DbError;
```

`_tag` discriminates safely; matchers stay exhaustive.

### `using` for resource cleanup

When a step needs a resource (DB transaction, file handle), `using` makes cleanup automatic regardless of which branch you return:

```typescript
async function transfer(from: string, to: string, amount: number): Promise<Result<void, TransferError>> {
  await using tx = await db.beginTx();

  const a = await debit(tx, from, amount);
  if (!a.ok) return a; // tx auto-rolls back on `await using`

  const b = await credit(tx, to, amount);
  if (!b.ok) return b;

  await tx.commit();
  return Ok(undefined);
}
```

(Requires a runtime that implements `Symbol.asyncDispose` — Node 22+, Bun, Deno. Standard in TypeScript 6.)

### Type-level guarantees

```typescript
// Force callers to handle Result — they can't accidentally ignore it.
function process(r: Result<User, never>): User {
  return r.value; // OK: TS knows there's no error branch.
}

// vs.
function processMaybe(r: Result<User, NotFoundError>): User {
  return r.value; // ❌ TS error: r.value doesn't exist on the error branch.
}
```

### Library options

Don't roll your own if you can avoid it. Mature options:

| Library | Style | When to pick |
| --- | --- | --- |
| **neverthrow** | Class-based `Result` with `.map/.andThen/.match` | Want methods + good ergonomics |
| **ts-results-es** | Pure tagged union | Want a tiny dependency |
| **fp-ts** | Full FP toolkit (`Either`, `TaskEither`, …) | Already doing FP-heavy code |
| **Effect** | Effect system (`Effect<R, E, A>`) | Want errors + resources + concurrency unified |

For most projects, **neverthrow** hits the right balance of ergonomics and weight.

## Result vs. Exceptions

| | Result | Exceptions |
| --- | --- | --- |
| Visibility in signature | Yes | No — TS signatures don't carry thrown types |
| Type-checked handling | Yes | No |
| Performance | Allocation only | Stack capture (expensive) |
| Stack traces | Lost (must capture explicitly) | Built-in |
| Composition | Combinators | Try/catch nests |
| Best for | Expected, domain-level failures | Programmer errors, unrecoverable bugs |

**Rule of thumb:** `Result` for expected outcomes ("user not found", "payment declined", "validation failed"). `throw` for programmer errors (null where it shouldn't be, assertion failures, OOM).

Never use exceptions for control flow. Never use `Result` for things only an operator can fix (file system gone, OOM).

## When to Use

**Use Result when:**

- Failure is part of the domain (not found, validation, conflict, declined).
- Multiple failure modes need different handling at the call site.
- You're building a typed boundary between layers (HTTP, RPC, service-to-service).
- You want forced exhaustiveness on error handling.

**Don't use Result when:**

- Failures are truly exceptional (corrupted file system, bug, panic).
- The error has only one branch and crashing is fine.
- You're in a hot path where the extra allocation matters (rare).

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| `unwrap()` everywhere defeats the point | Reserve unwrap for the outermost layer (HTTP handler, CLI main) |
| Generic `Error` as `E` loses information | Use a discriminated union for `E`; `{ kind, … }` |
| Mixing `throw` and `Result` confuses callers | Pick one per layer; convert at the boundary |
| Stack traces missing | Include `cause` in error variant; preserve when rethrowing |
| `Promise<Result<T, E>>` chains nest | Use `flatMap`/`andThen` or a library with `TaskEither` |

## Migration Strategy

1. **Choose a layer to convert.** Start at the domain layer (services) — not at the HTTP edge.
2. **Define a closed error union** for that layer.
3. **Adapt existing throws** at the seam: wrap `try { … } catch (e) { return Err(toDomain(e)); }`.
4. **Push outward.** Callers now switch on the union; remove their try/catch.
5. **Translate at the boundary** (HTTP handler, CLI) — Result back to exception or status code.

Don't convert everything at once. Result is most valuable in the middle of the system; the edges keep their idiomatic conventions (`throw` for HTTP middleware, `process.exit` for CLI).

## Related Patterns

- **Strategy** — different error-recovery strategies plug into the failure branch.
- **Chain of Responsibility** — chained handlers each return `Result`; first error short-circuits.
- **Decorator** — wrappers that translate `Result` shapes (e.g., logging, retry).
- **Circuit Breaker** — produces `Err({ kind: "open_circuit" })` instead of throwing.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("getUser", () => {
  it("returns Ok for an existing user", async () => {
    const db = fakeDb({ "u_1": { id: "u_1", banned: false } });
    const r = await getUser("u_1");
    expect(r).toEqual({ ok: true, value: expect.objectContaining({ id: "u_1" }) });
  });

  it("returns Err({ kind: 'not_found' }) when missing", async () => {
    const r = await getUser("nope");
    expect(r).toEqual({ ok: false, error: { kind: "not_found", id: "nope" } });
  });

  it("returns Err({ kind: 'banned' }) when banned", async () => {
    const r = await getUser("u_banned");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("banned");
  });
});
```

Tests assert against **values**, not against exceptions. No `expect().toThrow()` needed; no string matching on error messages. The compiler enforces that every test path is reachable.

## Summary

> *Exceptions are for the bug-shaped errors; values are for the domain-shaped ones.*

Use `Result<T, E>` for any failure your caller is expected to handle. Reserve `throw` for "I cannot continue". Combine with discriminated unions and exhaustive `switch` to make error handling type-safe and impossible to forget.
