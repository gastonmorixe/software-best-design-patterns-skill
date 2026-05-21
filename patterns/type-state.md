# Type-State Pattern

> Modern pattern. Not in GoF. Encodes a state machine **in the type system** so illegal method calls are *compile-time* errors. Rust uses it extensively; TypeScript can replicate the safest parts with generics + branded types.

## Intent

Make impossible operations unrepresentable. If a method only makes sense in state `X`, it should only exist on a value tagged with state `X` — calling it from any other state is a type error.

## The Problem

A typical fluent builder lets you forget required configuration or call methods in nonsensical order:

```typescript
class QueryBuilder {
  private table?: string;
  private cols: string[] = [];
  private filters: string[] = [];

  from(t: string): this  { this.table = t; return this; }
  select(...c: string[]): this { this.cols.push(...c); return this; }
  where(c: string): this { this.filters.push(c); return this; }

  execute(): Promise<Row[]> {
    if (!this.table) throw new Error("forgot from()"); // runtime
    return db.run(/* … */);
  }
}

new QueryBuilder()
  .where("status = 'active'")  // ⚠ where() before from() — compiles, throws at runtime
  .execute();
```

The compiler can't see that `where()` requires a table to be set first.

## The Solution

Parameterise the type by its state. Methods that transition states return a new type; methods that aren't valid for the current state don't exist on the value's type.

```typescript
// ── State markers ──────────────────────────────────────────
type Empty       = { readonly _state: "empty" };
type WithFrom    = { readonly _state: "with-from" };
type WithSelect  = { readonly _state: "with-select" };
type WithWhere   = { readonly _state: "with-where" };

// Methods available per state (union the transitions)
type Ready = WithFrom | WithSelect | WithWhere;

// ── Builder generic over its state ─────────────────────────
class QueryBuilder<S> {
  constructor(
    private readonly table: string | null,
    private readonly cols: ReadonlyArray<string>,
    private readonly filters: ReadonlyArray<string>,
    // S is a phantom; carried via methods.
    private readonly _state?: S,
  ) {}

  static create(): QueryBuilder<Empty> {
    return new QueryBuilder<Empty>(null, [], []);
  }

  /** Allowed only in Empty state. */
  from(this: QueryBuilder<Empty>, t: string): QueryBuilder<WithFrom> {
    return new QueryBuilder<WithFrom>(t, this.cols, this.filters);
  }

  /** Allowed only after from() — i.e., once we have a table. */
  select(this: QueryBuilder<Ready>, ...c: string[]): QueryBuilder<WithSelect> {
    return new QueryBuilder<WithSelect>(this.table, [...this.cols, ...c], this.filters);
  }

  /** Allowed only after from() — needs a table. */
  where(this: QueryBuilder<Ready>, c: string): QueryBuilder<WithWhere> {
    return new QueryBuilder<WithWhere>(this.table, this.cols, [...this.filters, c]);
  }

  /** Only callable when we have at least a from(). */
  execute(this: QueryBuilder<Ready>): Promise<Row[]> {
    const sql = `SELECT ${this.cols.length ? this.cols.join(", ") : "*"}` +
                ` FROM ${this.table}` +
                (this.filters.length ? ` WHERE ${this.filters.join(" AND ")}` : "");
    return db.run(sql);
  }
}

// ── Use ───────────────────────────────────────────────────
const rows = await QueryBuilder
  .create()
  .from("users")
  .select("id", "name")
  .where("status = 'active'")
  .execute();                                  // ✅

QueryBuilder.create().execute();               // ❌ TS error: execute() not on QueryBuilder<Empty>
QueryBuilder.create().where("x = 1").execute();// ❌ TS error: where() not on QueryBuilder<Empty>
```

The `this:` parameter (TypeScript's polymorphic `this`) lets a method **require** the receiver to be in a specific state.

## Modern TypeScript Twist

### Multiple required transitions

For "you must call both `from()` AND `select()` before `execute()`", track each in the state type:

```typescript
type State = {
  hasFrom?:   true;
  hasSelect?: true;
};

type WithFrom         = State & { hasFrom: true };
type WithSelect       = State & { hasSelect: true };
type WithFromAndSelect= WithFrom & WithSelect;

class QueryBuilder<S extends State = {}> {
  // …

  from(this: QueryBuilder<S>, t: string): QueryBuilder<S & WithFrom> { /* … */ return null!; }
  select(this: QueryBuilder<S>, ...c: string[]): QueryBuilder<S & WithSelect> { /* … */ return null!; }

  // Only callable when both flags are set.
  execute(this: QueryBuilder<S & WithFromAndSelect>): Promise<Row[]> { /* … */ return null!; }
}

QueryBuilder.create<{}>().from("u").execute();             // ❌ missing select
QueryBuilder.create<{}>().select("id").execute();          // ❌ missing from
QueryBuilder.create<{}>().from("u").select("id").execute();// ✅
```

The intersection (`S & WithFrom & WithSelect`) accumulates state as you call methods. Order of calls no longer matters — only that all requirements are met.

### Discriminated unions for finite state machines

For a small fixed machine, discriminated unions are usually clearer:

```typescript
type Door =
  | { state: "closed";  open():   Door & { state: "open" } }
  | { state: "open";    close():  Door & { state: "closed" } }
  | { state: "locked";  unlock(): Door & { state: "closed" } };

const d: Door = { state: "closed", open() { return { state: "open",   close: function() { /* … */ return d; } }; } };

// d.close() — ❌ doesn't exist on { state: "closed" }
const open = d.open();
open.close();
```

This expresses the machine as data; `open.close()` is valid because the result of `open()` is typed as `{ state: "open"; close: …; }`.

### Builder with required parameters tracked in types

A common variant: track which fields have been set, gate `build()` on all of them being present.

```typescript
type Required<T> = { -readonly [K in keyof T]-?: T[K] };

class HttpRequestBuilder<S> {
  private readonly d: Partial<HttpRequest> = {};

  url(this: HttpRequestBuilder<S>, u: string):
    HttpRequestBuilder<S & { url: string }>
  { this.d.url = u; return this as any; }

  method(this: HttpRequestBuilder<S>, m: HttpMethod):
    HttpRequestBuilder<S & { method: HttpMethod }>
  { this.d.method = m; return this as any; }

  body(this: HttpRequestBuilder<S>, b: BodyInit):
    HttpRequestBuilder<S & { body: BodyInit }>
  { this.d.body = b; return this as any; }

  // build() requires both url and method (body optional).
  build(this: HttpRequestBuilder<S & { url: string; method: HttpMethod }>): HttpRequest {
    return this.d as HttpRequest;
  }
}

const ok = new HttpRequestBuilder<{}>().url("/u").method("POST").build();           // ✅
const _e = new HttpRequestBuilder<{}>().url("/u").build();                          // ❌ missing method
const _f = new HttpRequestBuilder<{}>().build();                                    // ❌ missing both
```

This is how the Builder pattern becomes safe at compile time.

### `as const` literal narrowing + branded states

For maximum safety, combine type-state with branded types so even "looks-like" states can't be forged:

```typescript
declare const __state: unique symbol;
type State<S extends string> = { readonly [__state]: S };

type DraftEmail = { to: string[]; subject: string; body: string } & State<"draft">;
type SentEmail  = { to: string[]; subject: string; body: string; sentAt: Date } & State<"sent">;

function send(d: DraftEmail): SentEmail {
  // … actual SMTP call …
  return { ...d, sentAt: new Date() } as unknown as SentEmail;
}

function open(s: SentEmail): SentEmail { /* … */ return s; }

// open(draftEmail) ❌ — draft cannot be opened.
// send(sentEmail)  ❌ — already sent.
```

The state lives in the type only; runtime values can't carry it. Once "sent", the value is structurally `SentEmail` and cannot be sent again.

## Real-World Applications

### 1. Connection lifecycle

```typescript
type Closed       = { _state: "closed" };
type Connecting   = { _state: "connecting" };
type Open         = { _state: "open" };

class Connection<S> {
  static create(): Connection<Closed> { return new Connection<Closed>(); }

  connect(this: Connection<Closed>): Promise<Connection<Open>> { /* … */ return null!; }
  send(this: Connection<Open>, data: Uint8Array): Promise<void> { /* … */ return null!; }
  close(this: Connection<Open>): Connection<Closed> { /* … */ return null!; }
}

// conn.send() on closed → ❌ TS error.
```

### 2. Transaction states

```typescript
type Open     = { _t: "open" };
type Committed= { _t: "committed" };
type RolledBack= { _t: "rolled-back" };

class Tx<S> {
  commit(this: Tx<Open>): Tx<Committed> { /* … */ return null!; }
  rollback(this: Tx<Open>): Tx<RolledBack> { /* … */ return null!; }
  insert(this: Tx<Open>, row: Row): void { /* … */ }
  // commit twice / use after commit → ❌
}
```

### 3. Form wizards

Each step requires the previous one to be filled in:

```typescript
type Step1 = { name: string };
type Step2 = Step1 & { email: string };
type Step3 = Step2 & { plan: "free" | "pro" };

function setName<S>(s: S, name: string): S & Step1 { /* … */ return null!; }
function setEmail<S extends Step1>(s: S, email: string): S & Step2 { /* … */ return null!; }
function setPlan<S extends Step2>(s: S, plan: "free" | "pro"): S & Step3 { /* … */ return null!; }
function submit(s: Step3): Promise<void> { /* … */ return null!; }

// submit(setEmail(setName({}, "Ada"), "ada@x.com")); // ❌ no plan
const draft = setPlan(setEmail(setName({}, "Ada"), "ada@x.com"), "pro");
await submit(draft); // ✅
```

The argument types enforce ordering.

### 4. Capability tokens

A capability is a token with a permission bit:

```typescript
type Can<T, P extends string> = T & { readonly __can: P };

function listFiles(c: Can<Session, "files:read">): Promise<File[]>   { /* … */ return null!; }
function deleteFile(c: Can<Session, "files:write">, id: string): Promise<void> { /* … */ return null!; }
function grantWrite(c: Can<Session, "admin">, s: Session): Can<Session, "files:write"> { /* … */ return null!; }
```

`deleteFile(session, id)` fails to compile unless `session` carries the write capability — handed out only by `grantWrite`.

## Type-State vs. Runtime State Machine

| | Type-state | Runtime state machine (XState, etc.) |
| --- | --- | --- |
| Where errors caught | Compile time | Runtime |
| Number of states | Few (each adds a type) | Many (chart is data) |
| Dynamic transitions | Awkward | Natural |
| Visualisation tooling | None | Available |
| Best for | API surface design | Complex business workflows |

Use **type-state** for narrow APIs (builders, connections, transactions, capabilities) where the machine is small and known at compile time. Use a **runtime** state machine (XState) when the machine is large, dynamic, or needs visualisation.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Combinatorial explosion of state types | Use intersection-of-flags style; or move to runtime machine |
| `this:` checks circumvented by `(builder as any)` | Lint against `as any`; cast only inside the module |
| State leaks into business types (every signature carries `<S>`) | Erase to a "ready" type once construction finishes (`build(): HttpRequest`) |
| Methods become hard to discover (IDE only shows methods for the current state) | Document the available transitions in JSDoc on the entry method |
| Mutable builders make the state markers a lie | Make the builder immutable (each method returns a new instance) |

## When to Use

**Use type-state when:**

- An API has clear forbidden sequences (must call X before Y; Y is one-shot).
- The number of states is small (≤ 5).
- Compile-time safety is valuable to your API's users.
- You're designing a library/SDK where misuse must be obvious.

**Don't use type-state when:**

- The machine is large or dynamic — XState fits better.
- You want simple ergonomics for casual users — heavy generics can scare them off.
- The "states" are really data and switching them is fine — use a plain field with a discriminator.

## Related Patterns

- **Builder** — type-state turns a builder's runtime "you forgot a step" into a compile-time error.
- **State** — runtime equivalent; type-state is what State looks like in a strongly-typed language.
- **Branded Types** — phantom branding is the mechanism that backs type-state markers.
- **Discriminated Union State** — alternative model when the value should carry the state at runtime.

## Testing

You don't usually need runtime tests for type-state — the compiler is the test. But you can write *type-tests*:

```typescript
import { expectError, expectType } from "tsd";

expectError(QueryBuilder.create().execute());            // missing from()
expectError(QueryBuilder.create().where("x = 1"));       // where before from
expectType<QueryBuilder<WithSelect>>(
  QueryBuilder.create().from("u").select("id"),
);
```

`tsd` (or vitest's `expectTypeOf`) verifies that the disallowed paths really fail to compile.

## Summary

> *If the compiler can refuse a misuse, no test ever has to catch it.*

Type-state is how Rust prevents use-after-free and how a careful TypeScript API can prevent half-built objects, double-close, and capability escalation. Use it for the surface of public libraries and the most-critical internal abstractions; reach for runtime machines when the chart gets big.
