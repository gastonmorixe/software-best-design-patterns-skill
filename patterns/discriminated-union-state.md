# Discriminated Union State Pattern

> Modern pattern. Not in GoF — but it's the **TypeScript idiom that subsumes State, Memento, and parts of Visitor**. Master it before reaching for the OO equivalents.

## Intent

Model state machines and ADTs as a **tagged union of state shapes**, where each tag carries exactly the fields valid in that state. The type system makes impossible states unrepresentable.

## The Problem: "Booleans + Nulls"

A typical loading state evolves as code grows:

```typescript
type RequestState = {
  loading: boolean;
  data: User | null;
  error: Error | null;
  retries: number;
};

// Renderers everywhere ask:
if (state.loading && state.data) /* shouldn't happen but is it? */
if (state.error && state.data)   /* both set after a refetch?      */
if (!state.loading && !state.data && !state.error) /* idle? */
```

Sixteen logically possible combinations (`2^4`); only four are valid. The type doesn't tell you which.

## The Solution

Replace independent boolean/null fields with a tagged union where each tag carries only the fields legal in that state.

```typescript
type RequestState =
  | { status: "idle" }
  | { status: "loading"; startedAt: number; retries: number }
  | { status: "success"; data: User; fetchedAt: number }
  | { status: "error";   error: AppError; retries: number };

function render(s: RequestState): JSX.Element {
  switch (s.status) {
    case "idle":    return <Idle />;
    case "loading": return <Spinner startedAt={s.startedAt} />;
    case "success": return <UserCard user={s.data} />;
    case "error":   return <ErrorView error={s.error} retries={s.retries} />;
  }
}
```

Inside `case "loading"`, TS knows `s.startedAt` exists and `s.data` doesn't. There is no longer a "loading **and** error" state. The bug class is gone.

## The Discriminant

The discriminator is a **literal type** (`"idle" | "loading" | …`), not a string or boolean. TypeScript narrows the union based on equality checks against literals:

```typescript
type Shape =
  | { kind: "circle";    radius: number }
  | { kind: "rectangle"; width: number; height: number }
  | { kind: "triangle";  a: number; b: number; c: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":    return Math.PI * s.radius ** 2;
    case "rectangle": return s.width * s.height;
    case "triangle": {
      const p = (s.a + s.b + s.c) / 2;
      return Math.sqrt(p * (p - s.a) * (p - s.b) * (p - s.c));
    }
  }
}
```

The compiler will refuse `s.width` inside `case "circle"`.

## Exhaustiveness Checking

Force the compiler to flag missing branches when the union grows:

```typescript
function assertNever(x: never, ctx?: string): never {
  throw new Error(`${ctx ?? "non-exhaustive"}: ${JSON.stringify(x)}`);
}

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":    return Math.PI * s.radius ** 2;
    case "rectangle": return s.width * s.height;
    // forgot "triangle"
    default:          return assertNever(s, "area"); // ❌ TS error: 'triangle' is not assignable to 'never'
  }
}
```

Adding a new case to `Shape` instantly turns every non-exhaustive `switch` into a build error. This is the same guarantee Visitor gives you in OO languages — but lighter and earlier.

## Transitions

Define transitions as **functions from one state shape to another**, not as setters on every field:

```typescript
type RequestEvent =
  | { type: "fetch" }
  | { type: "fetch/success"; data: User }
  | { type: "fetch/error"; error: AppError }
  | { type: "retry" }
  | { type: "reset" };

function reduce(state: RequestState, ev: RequestEvent): RequestState {
  switch (state.status) {
    case "idle":
      if (ev.type === "fetch")
        return { status: "loading", startedAt: Date.now(), retries: 0 };
      return state;

    case "loading":
      if (ev.type === "fetch/success")
        return { status: "success", data: ev.data, fetchedAt: Date.now() };
      if (ev.type === "fetch/error")
        return { status: "error", error: ev.error, retries: state.retries };
      return state;

    case "error":
      if (ev.type === "retry")
        return { status: "loading", startedAt: Date.now(), retries: state.retries + 1 };
      if (ev.type === "reset")
        return { status: "idle" };
      return state;

    case "success":
      if (ev.type === "reset")
        return { status: "idle" };
      return state;
  }
}
```

This is the **State** pattern, but rendered as data. The transition table is one function; no per-state class needed.

## Modern TypeScript Twist

### Type-level state machines

Encode legal transitions in the type so illegal ones are *compile-time* errors:

```typescript
type DoorState = "closed" | "open" | "locked";

type Transitions = {
  closed: "open" | "locked";
  open:   "closed";
  locked: "closed";
};

class Door<S extends DoorState = "closed"> {
  constructor(public readonly state: S) {}

  to<T extends Transitions[S]>(next: T): Door<T> {
    return new Door<T>(next);
  }
}

const d = new Door("closed");
const open   = d.to("open");      // OK
const locked = d.to("locked");    // OK
// open.to("locked");             // ❌ TS error: only "closed" allowed from "open"
```

For non-trivial machines, use [XState](https://stately.ai/) — it gives you visualisation, history, parallel states, and TS types generated from the chart.

### Helpers: pattern matching

A small `match` helper sharpens ergonomics:

```typescript
function match<S extends { kind: string }, R>(
  s: S,
  cases: { [K in S["kind"]]: (s: Extract<S, { kind: K }>) => R },
): R {
  return cases[s.kind as S["kind"]](s as Extract<S, { kind: S["kind"] }>);
}

const area = (s: Shape) => match(s, {
  circle:    (s) => Math.PI * s.radius ** 2,
  rectangle: (s) => s.width * s.height,
  triangle:  (s) => {
    const p = (s.a + s.b + s.c) / 2;
    return Math.sqrt(p * (p - s.a) * (p - s.b) * (p - s.c));
  },
});
```

Or, when TC39's [Pattern Matching proposal](https://github.com/tc39/proposal-pattern-matching) ships, use the native syntax.

### Discriminated unions vs. classes

A class hierarchy with a method per state is structurally equivalent. Pick by ergonomics:

| Class hierarchy | Discriminated union |
| --- | --- |
| Many small files | One file |
| `instanceof` checks | `switch (x.kind)` |
| Polymorphism via methods | Pattern match at use site |
| Add state → new class | Add case → new variant |
| Easier to extend with new behavior (Visitor) | Easier to extend with new state (Open Variant) |

The classic trade-off: classes are friendlier to **new operations**, unions to **new variants**. TypeScript's structural typing leans toward unions for most non-OO codebases.

## Real-World Applications

### 1. Form state

```typescript
type Field<T> =
  | { status: "pristine"; value: T }
  | { status: "editing"; value: T; lastValid: T }
  | { status: "validating"; value: T; pendingAt: number }
  | { status: "invalid";  value: T; issues: Issue[] }
  | { status: "valid";    value: T };

// Rendering and validation logic flow naturally from the case.
```

### 2. WebSocket connection

```typescript
type Conn =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "open"; socket: WebSocket; openedAt: number }
  | { status: "closing"; code: number }
  | { status: "closed"; code: number; reason: string; closedAt: number };
```

### 3. Auth state

```typescript
type Auth =
  | { status: "anonymous" }
  | { status: "authenticating"; method: "password" | "oauth"; startedAt: number }
  | { status: "authenticated"; user: User; token: string; expiresAt: number }
  | { status: "expired";       user: User; lastSeenAt: number };
```

### 4. Drag-and-drop state machine

```typescript
type DnD =
  | { phase: "idle" }
  | { phase: "dragging"; itemId: string; from: { x: number; y: number } }
  | { phase: "over_drop_zone"; itemId: string; zoneId: string }
  | { phase: "dropped"; itemId: string; zoneId: string; at: number };
```

Each phase has only the fields it needs. No "is dragging but no itemId" bugs.

## When to Use

**Use discriminated union state when:**

- You're building anything with "states" (loading, auth, form, connection, game level).
- The valid combinations of fields are a small subset of all combinations.
- You want compile-time exhaustiveness.
- You'd otherwise reach for the GoF **State** pattern.

**Don't use when:**

- There's only one state (use a plain object).
- The states all share the same shape (use a plain object with a status enum).
- You need true OO polymorphism for unrelated behaviors per state — consider the classical **State** pattern with classes.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Discriminator is `string` instead of literal | Use `as const` literals on creation, narrow types in helpers |
| Switch over `typeof` or `instanceof` instead of the tag | Discriminate on the literal field — it's the only thing TS narrows |
| Forgot `default: assertNever(x)` | Add it; new variants force exhaustiveness errors immediately |
| Discriminant key inconsistent across unions (`type`, `kind`, `status`, `_tag`) | Pick **one** convention per project; document in a style guide |
| Casts from `unknown` skip narrowing | Parse with Zod/Valibot/ArkType at boundaries; trust the type from there |

## Naming the Tag

Whatever you pick, be consistent:

| Convention | Origin | Fits |
| --- | --- | --- |
| `kind` | Common in TS docs | Shapes, AST nodes |
| `type` | Redux actions | Events, actions |
| `status` | UI state | Loading, auth, request |
| `_tag` | fp-ts, neverthrow | Errors, ADTs in libraries |

## Combine With

- **Reducer pattern** — state + action → state, exactly the shape of `reduce(state, ev)` above.
- **Result pattern** — both are discriminated unions; `Result<T, E>` is the smallest interesting case.
- **State pattern** — same intent, OO realisation; pick by ergonomics.
- **Visitor** — same intent for operations across variants; in TS, prefer the union.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("RequestState reducer", () => {
  it("idle → loading on fetch", () => {
    const s = reduce({ status: "idle" }, { type: "fetch" });
    expect(s.status).toBe("loading");
    if (s.status === "loading") expect(s.retries).toBe(0);
  });

  it("loading → success on fetch/success", () => {
    const s = reduce(
      { status: "loading", startedAt: 1, retries: 0 },
      { type: "fetch/success", data: { id: "u_1" } as User },
    );
    expect(s.status).toBe("success");
    if (s.status === "success") expect(s.data.id).toBe("u_1");
  });

  it("ignores events that don't apply in the current state", () => {
    const initial: RequestState = { status: "idle" };
    const s = reduce(initial, { type: "retry" });
    expect(s).toBe(initial); // same reference; no needless re-render
  });
});
```

You don't need elaborate setup — every state is just a value, every transition is just a function.

## Summary

> *Make illegal states unrepresentable.* — Yaron Minsky

Discriminated unions are TypeScript's most powerful design pattern. They subsume the State pattern, the Result pattern, and most of Visitor. When in doubt, ask: *"what set of mutually-exclusive shapes does this thing actually inhabit?"* and encode that.
