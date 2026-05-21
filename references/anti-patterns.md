# Anti-Patterns & Code Smells

A taxonomy of the recurring mistakes patterns are meant to *prevent*. When you spot one, the remedy is usually a specific pattern from the catalog.

## Table of Contents

1. [Class-Level Smells](#class-level-smells)
2. [Method-Level Smells](#method-level-smells)
3. [Type-Level Smells (TypeScript-specific)](#type-level-smells-typescript-specific)
4. [Architectural Anti-Patterns](#architectural-anti-patterns)
5. [Process & Organisational](#process--organisational)
6. [Async / Distributed-System Smells](#async--distributed-system-smells)
7. [Smell → Pattern Map](#smell--pattern-map)

---

## Class-Level Smells

### God Object / Blob

A class that knows too much and does too much. Often named `*Manager`, `*Helper`, `*Util`, `*Service` (when overgrown).

**Detect:** > 500 lines, > 20 methods, > 10 dependencies in the constructor, or "and" in the description.

**Remedy:** Split by SRP. Extract Strategy / Service / Repository / Builder. Pull cross-cutting concerns out (logging → Middleware/Decorator).

### Anemic Domain Model

Domain types that are pure data with no behaviour; logic lives in "service" classes that mutate the data from outside.

**Detect:** Entities are all getters/setters; services have all the rules.

**Remedy:** Move behaviour onto the entities (`order.cancel()` instead of `OrderService.cancel(order)`). Or — if you've chosen the Transaction Script style intentionally — own the choice and stop pretending to do DDD.

### Refused Bequest

A subclass inherits methods it doesn't want and overrides them with no-ops or `throw`.

**Detect:** Stub overrides, `throw new Error("not implemented")`, "this method doesn't apply to me".

**Remedy:** It's not really `is-a`. Use composition; split the base class along the right axis.

### Feature Envy

A method spends most of its time reading another object's fields and computing.

**Detect:** Heavy chains like `other.x + other.y + other.z` inside a method that uses few of its own fields.

**Remedy:** Move the method to the object whose data it uses (Tell, Don't Ask).

### Inappropriate Intimacy

Two classes know each other's private parts. They access each other's internal state, helper methods, or implementation details.

**Detect:** Friend-class hacks (`_internalMethod`), reaching into "private" fields by convention, parallel class hierarchies that grow lockstep.

**Remedy:** Encapsulate one or merge them if they're really one concept. Mediator pattern if N-to-N intimacy.

### Data Class

A class with public fields and no behaviour. Just a struct.

**Detect:** Only getters and setters; no real methods.

**Remedy:** Acceptable for DTOs at trust boundaries. **Not** acceptable for domain types — give them behaviour.

### Lazy Class

A class that doesn't do much and could be folded into another.

**Detect:** Two methods, both trivial, only one caller.

**Remedy:** Inline. Don't make a class out of a function.

### Speculative Generality

Abstractions added "in case we need it later".

**Detect:** Interfaces with one implementation; generic parameters that never vary; configuration knobs no one uses.

**Remedy:** Delete. Reintroduce when you have a real second implementation.

### Primitive Obsession

Using primitives (`string`, `number`, `boolean`) where a domain type would be clearer and safer.

**Detect:** Method signatures like `function send(to: string, from: string, subject: string)` — easy to swap args; no validation.

**Remedy:** Branded types (`Email`, `UserId`, `Cents`). Value Objects. Schema parsing at boundaries.

```typescript
// Before
function transfer(from: string, to: string, amount: number) {}

// After
function transfer(from: AccountId, to: AccountId, amount: Money) {}
```

---

## Method-Level Smells

### Long Method

A method longer than ~20 lines is usually doing more than one thing.

**Remedy:** Extract Function. Each extracted function names a sub-step; the outer method reads like a table of contents.

### Long Parameter List

> 4 parameters and you forget the order; readers can't keep track.

**Remedy:** Group related params into a struct; introduce a Builder; or split the function — it probably does two things.

```typescript
// Before
function placeOrder(userId, items, address, paymentMethod, currency, idempotencyKey, notifyEmail) {}

// After
function placeOrder(input: PlaceOrderInput) {}
```

### Switch Statements (on type)

Repeated switches on a "type" field. Adding a case forces updates in every location.

**Remedy:** Polymorphism (Strategy / State / Visitor); or discriminated union with a single exhaustive match function.

### Comments Substituting for Names

A long comment over a chunk of code, often explaining what it does.

**Remedy:** Extract Function with a name that describes the comment.

```typescript
// Before
// Validate that the order's total matches the sum of its items
let sum = 0;
for (const item of order.items) sum += item.price * item.qty;
if (Math.abs(sum - order.total) > 0.01) throw new Error("mismatch");

// After
verifyOrderTotalMatchesItems(order);
```

### Magic Numbers / Strings

Literals scattered through code with no name.

**Remedy:** Named constants; flyweight registry; enum-like `as const` objects.

### Dead Code

Code reachable only by impossible conditions; commented-out blocks; "kept just in case".

**Remedy:** Delete. Git remembers.

### Loops You Couldn't Read

Manual `for` with mutation, index off-by-ones, accumulation.

**Remedy:** Iterator helpers, `map`/`filter`/`reduce`, generators.

---

## Type-Level Smells (TypeScript-specific)

### `any`

The escape hatch that defeats the type checker.

**Detect:** Grep `:\s*any\b`, `as any`, type assertions through `unknown`.

**Remedy:** Use `unknown` and narrow with type guards; or define a schema and parse.

### `as` Casts Used as Lies

```typescript
const u = jsonData as User;  // jsonData might not be a User
```

**Detect:** `as X` where `X` is not `const`/`unknown`.

**Remedy:** Validate at the boundary (Zod / Valibot / ArkType). Once parsed, the type is trustworthy.

### `!` Non-Null Assertions Everywhere

```typescript
const name = user!.profile!.name!;
```

**Detect:** `!` outside narrow, justified spots (e.g., right after `if (!x) throw`).

**Remedy:** Explicit null checks; `??`; refactor the type to remove the optional.

### Boolean Parameter Flags

```typescript
sendEmail(user, true, false, true);
```

**Detect:** Multiple booleans in a parameter list.

**Remedy:** Replace with explicit option objects; or split into multiple functions.

```typescript
// Better
sendEmail(user, { html: true, attachInvoice: false, bcc: true });
// Best
sendInvoiceEmail(user, { withAttachment: false });
```

### Implicit Any in Library Boundaries

Untyped JSON, response data, query strings.

**Remedy:** Schema-parse at the boundary. Use branded types for IDs.

### Stringly-Typed APIs

Discriminating by raw strings without literal types.

```typescript
function dispatch(action: { type: string; payload: any }) {}
```

**Remedy:** Discriminated unions with literal types.

### Mutation of Function Parameters

A function reaches into its argument and changes it.

**Detect:** `param.field = …` inside a function.

**Remedy:** Return a new value; mark inputs as `readonly`.

### "Optional" Fields That Are Required in Half the States

Fields typed `?:` because they're not always present, but the code assumes they're present in some states without expressing that.

**Remedy:** Discriminated union state — let the *state* dictate which fields are present.

---

## Architectural Anti-Patterns

### Big Ball of Mud

No discernible architecture; everything imports everything; changes ripple unpredictably.

**Remedy:** Introduce boundaries one slice at a time. Pick the riskiest module and move it behind an interface.

### Lasagna Architecture

Strict layering for layering's sake. A trivial change requires editing 6 files in 6 layers.

**Remedy:** Vertical Slice Architecture — group by feature, not by technical layer. Or accept some duplication across layers as the price of decoupling — but only where it actually buys you something.

### Distributed Monolith

Microservices that share a database, deploy together, and can't be released independently.

**Detect:** "We have 12 services but a release is a coordinated dance across all of them."

**Remedy:** Per-service databases; backwards-compatible API contracts; outbox for events. If you can't honestly do this, you have one application; don't pretend.

### Service Locator

Components call `Container.get<T>()` from inside their body to look up dependencies.

**Detect:** Constructor takes no args but the class needs many dependencies.

**Remedy:** Constructor injection.

### Hidden Singleton

A "stateless utility" with a static field that secretly holds state.

```typescript
class Cache {
  private static store = new Map<string, unknown>();
  static get(k: string) { /* … */ }
}
```

**Remedy:** Instance-based with DI.

### Reinvented Framework

A homegrown DI container, ORM, query builder, logger, or HTTP framework. Almost always worse than the existing ones.

**Remedy:** Use the boring tool the ecosystem agrees on.

### Premature Microservices

Splitting into services before the team / product has stabilised.

**Symptom:** Architectural diagrams change weekly; latency budget exceeded by cross-service calls.

**Remedy:** Modular monolith first. Split when team boundaries naturally separate.

### Layered Cake DTO Mapping Hell

Six DTOs for one entity (`EntityEntity`, `EntityDomain`, `EntityDto`, `EntityResponse`, `EntityCreateRequest`, `EntityUpdateRequest`).

**Remedy:** Distinguish only at trust boundaries: input DTO (validated), domain, response DTO (selected). Three at most; often two.

---

## Process & Organisational

### Cargo Cult

Copying patterns or practices because successful teams use them, without understanding why.

**Remedy:** Read the *Intent* and *When to Use* sections of each pattern. Question every "we do X here".

### Golden Hammer

Same pattern (or library, or language) applied to every problem.

**Remedy:** Diversify. Match pattern to problem.

### Lava Flow

Dead code that nobody removes because "we might need it" or "we're not sure what it does".

**Remedy:** Delete with intent. Git remembers. Tests catch regressions.

### Yoyo Problem

Following an inheritance chain through 5+ classes to understand what a method does.

**Remedy:** Flatten via composition.

### Boat Anchor

A piece of obsolete infrastructure kept around because removing it is scary.

**Remedy:** Plan a removal milestone. The scariness compounds the longer you wait.

### Not Invented Here

Refusing to use existing libraries; rewriting everything in-house.

**Remedy:** Adopt the ecosystem default unless you have a quantified reason not to.

### Stovepipe

Different teams build incompatible, redundant systems because they don't talk.

**Remedy:** Cross-team architecture review at the right scope. RFCs.

---

## Async / Distributed-System Smells

### Dual Write

```typescript
await db.save(x);
await broker.publish(x);   // fails sometimes; states diverge
```

**Remedy:** [Outbox pattern](../patterns/outbox.md).

### Unbounded Retry Loop

```typescript
while (true) { try { await call(); break; } catch {} }
```

**Remedy:** Bounded attempts, [exponential backoff + jitter](../patterns/retry-backoff.md), circuit breaker.

### Retrying Non-Idempotent Writes

Without an idempotency key, retries duplicate charges / emails / inventory.

**Remedy:** [Idempotency](../patterns/idempotency.md) keys.

### Fan-Out Storms

A single user action triggers thousands of cascading downstream calls.

**Remedy:** Batch, debounce, bulkhead.

### N+1 Queries

A loop that issues one query per item.

**Remedy:** Batch via `IN (...)`, dataloader, JOIN, or eager-loading flag.

### Synchronous Cross-Service Calls in Critical Path

Each service waits on the next; total latency = sum of all hops.

**Remedy:** Reduce hops; cache; or move to async messaging where latency isn't on the critical path.

### Cross-Service Transactions

Trying to wrap multiple services in one DB transaction.

**Remedy:** [Saga](../patterns/saga.md) with compensations.

### Distributed Logging Black Hole

Logs from each service, no correlation ID, no way to follow one request through.

**Remedy:** OpenTelemetry. Propagate a trace ID at every boundary.

### Time-of-Check vs. Time-of-Use (TOCTOU)

```typescript
if (await isAvailable(id)) await reserve(id);  // race window
```

**Remedy:** Atomic operation (`reserve` returns success/failure); optimistic locking; database constraint.

### Thundering Herd

Many clients retry at exactly the same moment after a downstream blip.

**Remedy:** Jitter retries; per-client backoff.

### Cache Stampede

Cache miss for a hot key triggers many parallel recomputations.

**Remedy:** Lock the recompute (single-flight); pre-warm on expiry; staggered TTLs.

---

## Smell → Pattern Map

A reference table mapping the most common smells to the patterns and references that fix them.

| Smell | Pattern / reference |
| --- | --- |
| Growing `switch` on type | [Strategy](../patterns/strategy.md), [Discriminated Union State](../patterns/discriminated-union-state.md), [Visitor](../patterns/visitor.md) |
| God Object | [Single Responsibility](./principles.md#s--single-responsibility-principle-srp), [Service Layer](../patterns/service-layer.md), [Facade](../patterns/facade.md) |
| Anemic Domain | Add behaviour to entities; see [Domain Model](./architectural-styles.md) |
| Inheritance abuse | [Composition over inheritance](./principles.md#composition-principles), [Strategy](../patterns/strategy.md), [Decorator](../patterns/decorator.md), [Bridge](../patterns/bridge.md) |
| Singleton everywhere | [Dependency Injection](../patterns/dependency-injection.md) |
| Service Locator | [DI](../patterns/dependency-injection.md) — pass deps explicitly |
| `any` / unsafe casts | [Branded Types](../patterns/branded-types.md), schema parsing |
| Boolean parameter flags | Option objects, [Builder](../patterns/builder.md) |
| Magic strings | `as const` objects, [Flyweight](../patterns/flyweight.md) |
| Dual write | [Outbox](../patterns/outbox.md) |
| Unbounded retries | [Retry + Backoff](../patterns/retry-backoff.md), [Circuit Breaker](../patterns/circuit-breaker.md) |
| Non-idempotent writes retried | [Idempotency](../patterns/idempotency.md) |
| Cross-service transactions | [Saga](../patterns/saga.md) |
| N+1 queries | Batch / DataLoader |
| Premature abstraction | [YAGNI](./principles.md#yagni-kiss-dry) |
| Long parameter list | Object parameters, [Builder](../patterns/builder.md) |
| Feature Envy | Move method to data's owner (Tell, Don't Ask) |
| Throwing for expected errors | [Result](../patterns/result.md) |
| Untyped JSON crossing boundaries | Zod/Valibot parse + [Branded Types](../patterns/branded-types.md) |
| Cross-cutting concern duplicated | [Middleware](../patterns/middleware.md), [Decorator](../patterns/decorator.md) |
| Manual state flags exploding | [Discriminated Union State](../patterns/discriminated-union-state.md), [State](../patterns/state.md), [Reducer](../patterns/reducer.md) |
| Brittle inheritance chain | Composition, [Strategy](../patterns/strategy.md) |
| Untestable due to env coupling | [DI](../patterns/dependency-injection.md), [Functional core / imperative shell](./principles.md#functional-core-imperative-shell) |

## Reference Reading

- *Refactoring* — Martin Fowler (the canonical smell catalogue)
- *Clean Code* — Robert C. Martin (chapter on smells)
- *Release It!* — Michael Nygard (the stability anti-patterns)
- *The Pragmatic Programmer* — Hunt & Thomas (orthogonality, ETC)

> *"There are only two hard things in Computer Science: cache invalidation and naming things."* — Phil Karlton
>
> Most anti-patterns trace back to one of these.
