# Principles

Principles are the bedrock under every design pattern. A pattern is the *what*; the principle is the *why*. Mastery is choosing the right pattern because the principles tell you to — not because the pattern looks cool.

## Table of Contents

1. [SOLID](#solid)
2. [Encapsulation Principles](#encapsulation-principles)
3. [Composition Principles](#composition-principles)
4. [Coupling & Cohesion](#coupling--cohesion)
5. [YAGNI, KISS, DRY](#yagni-kiss-dry)
6. [Tell Don't Ask & Law of Demeter](#tell-dont-ask--law-of-demeter)
7. [Hollywood Principle](#hollywood-principle)
8. [Functional Core, Imperative Shell](#functional-core-imperative-shell)
9. [Defensive vs. Offensive Programming](#defensive-vs-offensive-programming)
10. [Principle Selection Matrix](#principle-selection-matrix)

---

## SOLID

Coined by Robert C. Martin. Five object-oriented principles, but every one of them applies just as well to functions and modules.

### S — Single Responsibility Principle (SRP)

> *A class should have one and only one reason to change.*

The "reason" is a **stakeholder** or **change driver**, not a verb. A `Report` class that's edited by both the billing team and the email team has two reasons to change → split it.

**Signs of violation:**

- The class name has "and" or "manager" in it.
- A change for one user breaks tests for an unrelated user.
- The constructor takes 8+ unrelated dependencies.

**Remedy:** split by axis of change. Extract a Strategy, a Service, a separate module.

```typescript
// Violation: two stakeholders
class UserService {
  signUp(input: SignUpInput) { /* … create user … */ }
  exportToBilling(userId: string) { /* … billing team logic … */ }
}

// SRP
class UserService { signUp(input: SignUpInput) { /* … */ } }
class BillingExporter { export(userId: string) { /* … */ } }
```

### O — Open–Closed Principle (OCP)

> *Open for extension, closed for modification.*

Adding new behaviour should not require editing existing code. The Strategy, Decorator, Plugin, and Middleware patterns all encode this.

**Signs of violation:**

- Adding a feature requires a `switch` to grow another case.
- A library's source file is the only place to register new behaviours.

**Remedy:** introduce a polymorphic seam — interface, function-typed parameter, registry.

```typescript
// Violation
function calculate(kind: "premium" | "basic", x: number) {
  switch (kind) {
    case "premium": return x * 0.8;
    case "basic":   return x;
  }
}
// Adding "trial" forces a change here.

// OCP
type Pricing = (x: number) => number;
const premium: Pricing = (x) => x * 0.8;
const basic:   Pricing = (x) => x;
const trial:   Pricing = (x) => 0; // new strategy; no edit to existing code
```

### L — Liskov Substitution Principle (LSP)

> *Subtypes must be substitutable for their base types without altering correctness.*

Inheritance must preserve behaviour. A `Penguin extends Bird` that throws in `fly()` violates LSP — calling code expects every `Bird` to fly.

**Signs of violation:**

- Method overrides throw "not supported".
- Subclasses tighten preconditions or weaken postconditions.
- `if (x instanceof Subtype)` checks throughout the codebase.

**Remedy:** widen the base type, narrow the subtype, or split the hierarchy. Often `is-a` was really `has-a`.

```typescript
// Violation
class Bird { fly(): void { /* … */ } }
class Penguin extends Bird { fly() { throw new Error("can't"); } }

// LSP
class Bird {}
class FlyingBird extends Bird { fly(): void { /* … */ } }
class Penguin extends Bird {} // not a FlyingBird
```

### I — Interface Segregation Principle (ISP)

> *Clients should not be forced to depend on methods they do not use.*

A fat interface forces irrelevant changes on consumers. Split into role-specific interfaces.

**Signs of violation:**

- Implementations have `throw new Error("not implemented")`.
- Mock objects in tests have to stub methods unrelated to the test.

**Remedy:** split the interface; let each consumer accept the narrowest one it needs.

```typescript
// Violation
interface UserRepo {
  findById(id: string): Promise<User | null>;
  save(u: User): Promise<void>;
  delete(id: string): Promise<void>;
  countActive(): Promise<number>;
  exportToCsv(): Promise<string>;
}

// ISP
interface UserReader     { findById(id: string): Promise<User | null>; countActive(): Promise<number>; }
interface UserWriter     { save(u: User): Promise<void>; delete(id: string): Promise<void>; }
interface UserExporter   { exportToCsv(): Promise<string>; }
```

Consumers depend on just the interface they need; mocks are tiny.

### D — Dependency Inversion Principle (DIP)

> *High-level modules should not depend on low-level modules; both should depend on abstractions.*

The domain layer doesn't import the DB layer. Both import the same `UserRepo` interface; the wiring at the composition root provides the implementation.

**Signs of violation:**

- Business logic imports a vendor SDK (`import Stripe from "stripe"`).
- Replacing infrastructure means editing service code.

**Remedy:** define a port (interface) in the domain; implement it in an adapter (infrastructure); inject.

```typescript
// Violation
import Stripe from "stripe";
class OrderService {
  private stripe = new Stripe(process.env.STRIPE_KEY!);
  async place(o: Order) { await this.stripe.charges.create({/* … */}); }
}

// DIP
interface PaymentGateway { charge(amount: number, source: string): Promise<Receipt>; }
class StripeGateway implements PaymentGateway { /* … */ } // adapter
class OrderService {
  constructor(private gateway: PaymentGateway) {}
  async place(o: Order) { await this.gateway.charge(o.total, o.source); }
}
```

This is the foundation of Hexagonal / Clean / Onion architectures.

---

## Encapsulation Principles

### Information Hiding

> *Modules should hide implementation decisions that are likely to change.*

David Parnas (1972). Pick which decisions are likely to vary; encapsulate them. Stable decisions stay public.

### Encapsulate What Varies

Identical principle, stated as a heuristic: find the code likely to change, give it its own seam.

```typescript
// Sorting algorithm varies → encapsulate it
function sortBooks(books: Book[], compare: (a: Book, b: Book) => number) { /* … */ }
```

### Tell, Don't Ask (see below)

Ask an object to do something rather than fetching its state to do it yourself.

---

## Composition Principles

### Composition Over Inheritance

> *Prefer object composition to class inheritance.* — GoF, page 20

Inheritance:

- Locks subclasses to the base class's contract.
- Couples timing (base class methods are called before subclass init).
- Multiplies hierarchies when independent axes exist.

Composition:

- Swappable at runtime.
- Independent axes → linear class counts.
- Easier to test parts.

Rule: use inheritance only for true `is-a` relationships **and** when polymorphic substitution is genuinely needed. Otherwise compose.

### Law of Composition (paraphrasing GoF)

> *Favour interfaces over concrete classes when composing. The collaborator behind the interface can change without rebuilding callers.*

This is DIP again, viewed through the composition lens.

---

## Coupling & Cohesion

### Coupling: how much modules depend on each other (less = better).

Ranked from worst to best:

| Form | Description | Avoid? |
| --- | --- | --- |
| **Content** | A reads B's private internals | Always |
| **Common** | Shared mutable global | Yes |
| **External** | Shared I/O format that both must keep in sync | Sometimes (DTOs) |
| **Control** | A passes a flag controlling B's behaviour | Refactor to Strategy |
| **Stamp / Data-structured** | A passes B a struct from which B uses only one field | Pass the field directly |
| **Data** | A passes B exactly what B needs | Healthy |
| **Message** | A sends B an event; B decides how to react | Best for distributed |

### Cohesion: how much a module's contents belong together (more = better).

Ranked from worst to best:

| Form | Description |
| --- | --- |
| **Coincidental** | Random grouping ("utils.ts") |
| **Logical** | Grouped by category, not behaviour (`StringUtils`) |
| **Temporal** | Grouped because they run at the same time (e.g., startup) |
| **Procedural** | Sequential steps unrelated to each other |
| **Communicational** | Operate on the same data |
| **Sequential** | One's output feeds the next |
| **Functional** | One responsibility (the ideal) |

Goal: high cohesion within a module, low coupling between modules.

---

## YAGNI, KISS, DRY

### YAGNI — You Aren't Gonna Need It

> *Don't add functionality until it's needed.* — Kent Beck

Extra flexibility costs design, testing, and cognitive overhead. Pay for it only when the need is real. The first variant is often *the only* variant.

```typescript
// YAGNI violation
class Logger { /* with strategies for Console / File / Http / Kafka / Splunk / Stackdriver */ }
// You actually only log to console. Strip it down. Add back when needed.
```

### KISS — Keep It Simple, Stupid

> *Most systems work best if they are kept simple rather than made complicated.*

If a simpler design fulfils the requirements, pick it. Patterns are a complication; they earn their weight only against a real problem.

### DRY — Don't Repeat Yourself

> *Every piece of knowledge must have a single, unambiguous, authoritative representation within a system.* — *The Pragmatic Programmer*

The "knowledge" is the key word: it's the **decision**, not the syntax, that should appear once.

DRY abuse: forcing two coincidentally-similar pieces of code under one abstraction. They now change for unrelated reasons → coupling. *"Duplication is far cheaper than the wrong abstraction."* — Sandi Metz

When you spot duplication, *wait* until you have 2–3 instances and can see the shared knowledge. Premature DRYing creates worse code than the duplication did.

---

## Tell, Don't Ask & Law of Demeter

### Tell, Don't Ask

> *Tell objects what to do; don't ask them for their state and decide for yourself.*

```typescript
// Asking
if (account.getBalance() >= amount) {
  account.setBalance(account.getBalance() - amount);
}

// Telling
account.withdraw(amount);   // encapsulates the check and the change
```

The asking version duplicates `Account`'s rules outside it; the telling version keeps them inside.

### Law of Demeter (Principle of Least Knowledge)

> *Talk only to your immediate friends.*

A method may call:

1. Its own methods.
2. Methods on its parameters.
3. Methods on objects it creates.
4. Methods on direct fields.

It may **not** chain through to "a friend of a friend":

```typescript
// LoD violation
const street = order.getCustomer().getAddress().getStreet();

// LoD
const street = order.getShippingStreet(); // Order exposes the relevant fact
```

Symptom: `a.b.c.d.e.f` chains. Each chain step couples your code to the existence and shape of the intermediate types.

Caveat: doesn't apply to fluent builders (`new Query().from("u").where("…")`) — those return `this`, so the chain *is* one object.

---

## Hollywood Principle

> *Don't call us, we'll call you.*

Frameworks call into your code, not the other way around. Achieved via Inversion of Control: hooks, events, dependency injection, the Template Method pattern.

The user code doesn't drive the lifecycle; it registers behaviour and waits to be invoked.

```typescript
// Hollywood: React owns rendering, calls your component
function MyComponent({ name }: { name: string }) { return <h1>Hi {name}</h1>; }

// Not Hollywood: imperative DOM control
const root = document.querySelector("#root")!;
root.innerHTML = `<h1>Hi ${name}</h1>`;
```

The framework's loop is the skeleton; your code is the leaf. This inversion is what makes plugins, middlewares, and lifecycle hooks possible.

---

## Functional Core, Imperative Shell

Coined by Gary Bernhardt. The application has:

- A **functional core** of pure functions over immutable data — easy to test, reason about, compose.
- An **imperative shell** that interacts with the world (I/O, DB, network, time) — thin, hard to test, but small.

Side effects live at the boundary; everything inside is pure.

```typescript
// Shell: imperative
async function handlePlaceOrder(req: Request): Promise<Response> {
  const input  = await req.json();
  const user   = await db.users.findOne({ id: input.userId });    // I/O
  const today  = new Date();                                       // ambient
  const result = priceOrder(user!, input, today);                  // CORE: pure
  await db.orders.insert(result.order);                            // I/O
  return Response.json(result.order);
}

// Core: pure
export function priceOrder(user: User, input: OrderInput, today: Date): PricedOrder {
  /* deterministic, no I/O, easy to test */
}
```

Tests for the core need no mocks. Tests for the shell are few — most of the logic moved inward.

---

## Defensive vs. Offensive Programming

### Defensive

Assume callers are wrong; validate every input.

```typescript
function setAge(age: number) {
  if (typeof age !== "number" || age < 0 || age > 150) throw new Error("bad age");
  this.age = age;
}
```

Useful at trust boundaries (HTTP, RPC, user input). Pointless on private internal calls.

### Offensive / Design by Contract

Define **preconditions, postconditions, invariants**. Trust callers (or your type system) to uphold preconditions; otherwise it's a bug — fail loud.

```typescript
function distance(a: Point, b: Point): number {
  // Precondition: a and b are valid Points (TS guarantees this).
  // Caller's bug if they passed null.
  return Math.hypot(a.x - b.x, a.y - b.y);
}
```

**Rule:** be defensive at the **outer boundary**; be offensive **inside**. Mixing the two everywhere is noise.

In TypeScript, "validate at the boundary with a schema (Zod/Valibot/ArkType); trust the type system internally" is the idiomatic application of this principle.

---

## Principle Selection Matrix

When you have a code smell, the matching principle and remedy:

| Smell | Violated principle | Likely pattern |
| --- | --- | --- |
| Class doing many things | SRP | Split; extract Strategy, Service |
| `switch` keeps growing | OCP | Strategy, Polymorphism, Visitor |
| Subclass throws "not supported" | LSP | Re-think hierarchy; favour composition |
| Mock has 20 stub methods | ISP | Split the interface |
| Domain imports vendor SDK | DIP | Port + Adapter; DI |
| Cross-module callbacks chain through 4 objects | LoD | Add a method that exposes the fact |
| Caller reads state to make a decision | Tell, Don't Ask | Move logic into the owning object |
| "Just in case" generic abstraction | YAGNI | Inline; defer abstraction |
| Three similar files become one over-engineered base class | DRY abuse | Keep them separate until the shared knowledge is clear |
| Logic scattered across imperative I/O | Functional core / imperative shell | Extract pure core |

## Reference Reading

- *Clean Architecture* — Robert C. Martin (SOLID applied at the system level)
- *The Pragmatic Programmer* — Hunt & Thomas (DRY, orthogonality, "broken windows")
- *Object Design* — Wirfs-Brock & McKean (CRC cards, responsibility-driven design)
- *Growing Object-Oriented Software, Guided by Tests* — Freeman & Pryce (tests as design feedback)
- *99 Bottles of OOP* — Sandi Metz (DRY/abstraction at the right moment)
- *Domain-Driven Design* — Evans (modelling complexity)
- *Boundaries* — Gary Bernhardt (functional core, imperative shell)

These principles aren't independent; they reinforce each other. SOLID + DRY + YAGNI usually disagree at first and then converge once you see the design clearly. When two principles point in different directions, prefer the one that names the *current* smell.
