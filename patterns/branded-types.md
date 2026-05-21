# Branded Types Pattern

> Modern pattern. Not in GoF. TypeScript trick that recovers **nominal typing** in a structural type system.

## Intent

Prevent values that are structurally identical but semantically different from being used interchangeably. Useful for IDs, validated strings, units, and any "this `string` is not just any string" situation.

## The Problem

TypeScript's type system is **structural**: two types with the same shape are interchangeable.

```typescript
function chargeUser(userId: string, amount: number) { /* … */ }

const userId  = "u_123";
const orderId = "o_456";
const amount  = 100;
const cents   = 10_000;

chargeUser(orderId, amount);    // ❌ compiles. Wrong ID used.
chargeUser(userId, cents);      // ❌ compiles. Wrong unit.
chargeUser(amount, userId);     // ❌ compiles. Args swapped (`amount` is a string here, but TS sees `string | number`).
```

`string` is `string`. The compiler can't tell `userId` apart from `orderId`. Same with `dollars` vs `cents`, `radians` vs `degrees`, `Email` vs `Username`.

## The Solution

Attach a phantom "brand" to the type via intersection with a marker. The brand exists only at the type level; the runtime value is unchanged.

```typescript
// ── Generic Brand helper ─────────────────────────────────────
declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

// ── Define branded types ─────────────────────────────────────
type UserId  = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;
type Cents   = Brand<number, "Cents">;
type Dollars = Brand<number, "Dollars">;

// ── Constructors gate the world ──────────────────────────────
const UserId  = (s: string): UserId  => s as UserId;
const OrderId = (s: string): OrderId => s as OrderId;
const Cents   = (n: number): Cents   => n as Cents;
const Dollars = (n: number): Dollars => n as Dollars;

// ── Public API uses branded types ────────────────────────────
function chargeUser(userId: UserId, amount: Cents): Promise<Receipt> {
  /* … */
  return Promise.resolve({ id: "" } as Receipt);
}

const u = UserId("u_123");
const o = OrderId("o_456");
const c = Cents(10_000);
const d = Dollars(100);

chargeUser(u, c); // ✅ OK
chargeUser(o, c); // ❌ Argument of type 'OrderId' is not assignable to 'UserId'.
chargeUser(u, d); // ❌ Argument of type 'Dollars' is not assignable to 'Cents'.
chargeUser(u, 100);// ❌ number is not Cents — must be constructed explicitly.
```

The brand is a phantom — `__brand` is a `unique symbol`, so the property cannot be forged from outside the module. At runtime there is no overhead; the brand exists only in the type system.

## Validated Branded Types

Brands are most useful when paired with a validation function — once a value has the brand, you *know* it's been validated.

```typescript
type Email = Brand<string, "Email">;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmail(s: string): Result<Email, "invalid_email"> {
  return EMAIL_RE.test(s) ? Ok(s as Email) : Err("invalid_email");
}

// Inside the system:
function sendEmail(to: Email, body: string) { /* … */ }

// Outside (at boundary):
const r = parseEmail(formInput);
if (r.ok) sendEmail(r.value, body); // body of code never re-validates
```

Once you hold an `Email`, you can never accidentally pass an unvalidated `string` again. Validation happens once, at the boundary.

## Modern TypeScript Twist

### Pair with Zod / Valibot / ArkType

Schema libraries can produce branded types from parsers:

```typescript
import { z } from "zod";

const EmailSchema = z.string().email().brand<"Email">();
type Email = z.infer<typeof EmailSchema>; // string & z.BRAND<"Email">

const r = EmailSchema.safeParse(input);
if (r.success) sendEmail(r.data, "hi"); // r.data is Email
```

The brand survives across the codebase; the parser is the only place that mints values.

### `as const` and template literal brands

For closed sets of valid prefixed strings, combine literal types with brands:

```typescript
type UserId  = `user_${string}`  & { readonly __brand: "UserId" };
type OrderId = `order_${string}` & { readonly __brand: "OrderId" };

function UserId(suffix: string): UserId {
  return (`user_${suffix}`) as UserId;
}
```

The template literal type alone (`user_${string}`) is enough to make `OrderId` and `UserId` non-assignable since they have different prefixes. The brand adds an extra layer of safety against `string` widening.

### Unit safety

```typescript
type Meters       = Brand<number, "Meters">;
type Feet         = Brand<number, "Feet">;
type Seconds      = Brand<number, "Seconds">;
type Milliseconds = Brand<number, "Milliseconds">;

const FEET_PER_METER = 3.28084;

function feetToMeters(f: Feet): Meters {
  return (f / FEET_PER_METER) as Meters;
}

function setTimeoutMs(ms: Milliseconds, fn: () => void): void {
  setTimeout(fn, ms);
}

const ten = Seconds(10);
setTimeoutMs(ten, () => {});                       // ❌ pass Seconds where Milliseconds expected
setTimeoutMs((ten * 1000) as Milliseconds, () => {}); // ✅ explicit conversion
```

The Mars Climate Orbiter would not have crashed.

### Opaque types

Some teams prefer the term *opaque type* — same idea, the brand hides the underlying type entirely:

```typescript
type UserId = Brand<string, "UserId">;

// In a barrel export, omit the constructor:
export type { UserId };
// no `export const UserId = …`

// External callers cannot construct a UserId; only the owning module can.
```

This is how Flow and ReScript model `opaque type`. TS achieves it by module-private constructors.

## Real-World Applications

### 1. Distinguishing IDs

```typescript
type UserId        = Brand<string, "UserId">;
type WorkspaceId   = Brand<string, "WorkspaceId">;
type ProjectId     = Brand<string, "ProjectId">;
type SessionToken  = Brand<string, "SessionToken">;
type IdempotencyKey= Brand<string, "IdempotencyKey">;
```

Every cross-reference in your codebase is now type-safe.

### 2. Validated input

```typescript
type Username = Brand<string, "Username">;        // 3..30 chars, [a-z0-9_]
type Password = Brand<string, "Password">;        // ≥12 chars
type Slug     = Brand<string, "Slug">;            // [a-z0-9-]+
type IsoDate  = Brand<string, "IsoDate">;         // matches /\d{4}-\d{2}-\d{2}/
type Uuid     = Brand<string, "Uuid">;            // RFC 4122
type SafeHtml = Brand<string, "SafeHtml">;        // sanitized DOMPurify output
```

Once parsed, no further validation is needed downstream — and the type prevents a non-sanitised string from reaching `innerHTML`.

### 3. Permission tokens

```typescript
type Authenticated<T> = T & { readonly __auth: true };
type Authorized<T, P extends string> = T & { readonly __perms: P };

function requireAuth<T>(req: T): Authenticated<T> { /* … */ return req as Authenticated<T>; }
function requirePerm<T, P extends string>(req: Authenticated<T>, perm: P): Authorized<T, P> {
  /* … */ return req as Authorized<T, P>;
}

function deleteUser(req: Authorized<Request, "admin">, id: UserId) { /* … */ }
```

The signature alone documents the permission model. You can't call `deleteUser` without an `Authorized<Request, "admin">`.

### 4. SQL injection safety

```typescript
type SqlText = Brand<string, "SqlText">;          // safe, no concatenation
type SqlParam = Brand<unknown, "SqlParam">;

function sql(strings: TemplateStringsArray, ...params: unknown[]): {
  text: SqlText; params: SqlParam[]
} {
  return {
    text: strings.join("$") as SqlText,
    params: params as SqlParam[],
  };
}

function query<T>(s: { text: SqlText; params: SqlParam[] }): Promise<T[]> { /* … */ }

// Use:
const q = sql`SELECT * FROM users WHERE id = ${userId}`;
await query(q); // OK

// Misuse blocked:
await query({ text: `SELECT * FROM users WHERE id = '${userId}'` as SqlText, params: [] }); // ⚠ hand-cast, code review must catch
```

## When to Use

**Use Branded Types when:**

- Two values share a primitive shape but mean different things.
- You parse input once and want the rest of the code to assume validity.
- You're modelling units, IDs, validated strings, or capability tokens.
- A misuse would cost real money / cause a security bug.

**Don't use Branded Types when:**

- The values are interchangeable in practice (e.g., generic `count: number`).
- The brand is the only safety mechanism (validation must back it up — a hand-cast `s as Email` lies).
- You have only one such type and the chance of confusion is zero.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Hand-casts (`s as Email`) lie about validation | Funnel construction through a single parser; lint against ad-hoc casts |
| Branded types serialise to plain JSON, then deserialise un-branded | Re-parse at the deserialisation boundary |
| Brands proliferate to the point that signatures are unreadable | Group brands by domain in one file; expose minimal surface |
| Two libraries each define `Brand<T, "Email">` — collide | Use module-private `unique symbol` brands |
| Generic helpers can't see the brand | Use `Brand<T, _>` constraints; preserve via `Extract` |

## Brand Hygiene Checklist

- [ ] Branded type has a **constructor** (parser) and is the **only** way to create one.
- [ ] Casts are confined to that constructor; the rest of the code uses the branded type.
- [ ] Brand survives across module boundaries (don't pass through `JSON.parse` without re-parsing).
- [ ] The brand has a meaningful name (`"UserId"`, not `"Brand1"`).
- [ ] If validation fails, return a `Result`, not throw.

## Related Patterns

- **Value Object (DDD)** — Value Objects are conceptual; branded types are how you implement them cheaply in TS.
- **Result** — pairs naturally: parser returns `Result<Branded, ParseError>`.
- **Smart Constructor** — exactly the constructor function for a branded type.
- **DTO** — DTOs cross trust boundaries; branded types live inside the trusted core.

## Summary

> *Parse, don't validate.* — Alexis King

Branded types let you parse once and then trust the type for the rest of execution. In TypeScript they cost nothing at runtime and stop entire categories of bugs (wrong-ID, wrong-unit, unsanitised-string) at compile time. Pair them with `Result` and a schema library and you have the modern equivalent of a strong domain model.
