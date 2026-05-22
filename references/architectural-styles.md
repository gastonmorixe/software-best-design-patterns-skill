# Architectural Styles

Patterns operate inside a class or a module. **Architectural styles** organise whole applications. They tell you where business rules go, where I/O lives, how modules depend on each other, and how to grow without making a Big Ball of Mud.

This reference covers the styles you'll see in 2026 TypeScript codebases. None of them is universally right; the trade-off table at the end helps you pick.

## Table of Contents

1. [Layered (n-tier)](#layered-n-tier)
2. [Hexagonal / Ports & Adapters](#hexagonal--ports--adapters)
3. [Clean Architecture](#clean-architecture)
4. [Onion Architecture](#onion-architecture)
5. [Vertical Slice Architecture](#vertical-slice-architecture)
6. [Modular Monolith](#modular-monolith)
7. [Microservices](#microservices)
8. [CQRS](#cqrs)
9. [Event Sourcing](#event-sourcing)
10. [Domain-Driven Design (tactical)](#domain-driven-design-tactical)
11. [Comparison & selection](#comparison--selection)

---

## Layered (n-tier)

The classical structure. Layers depend downward.

```
┌────────────────────────┐
│  Presentation (HTTP)   │
├────────────────────────┤
│  Application / Service │
├────────────────────────┤
│  Domain                │
├────────────────────────┤
│  Persistence (DB)      │
└────────────────────────┘
```

```
src/
  controllers/   # routes, request parsing, response shaping
  services/      # business logic
  repositories/  # data access
  models/        # entities
```

**Pros:** familiar; easy to onboard.
**Cons:** the domain ends up *importing* infrastructure ("repositories" leak SQL into services); changes ripple through every layer; the dependency direction is wrong (domain → DB is fragile).

When you outgrow layered architecture, the next step is usually Hexagonal.

---

## Hexagonal / Ports & Adapters

Alistair Cockburn, 2005. The domain is at the centre; everything else is an adapter behind a port (interface).

```
                  ┌────────────────────────┐
        HTTP ────▶│ Inbound adapters       │
        CLI  ────▶│ (controllers)          │
        gRPC ────▶│                        │
                  └───────────┬────────────┘
                              │ ports (interfaces)
                              ▼
                  ┌────────────────────────┐
                  │   Application core     │
                  │   (use cases + domain) │
                  └───────────┬────────────┘
                              │ ports
                              ▼
                  ┌────────────────────────┐
                  │ Outbound adapters      │
                  │ (DB, broker, mailer)   │
                  └────────────────────────┘
```

```
src/
  domain/                # entities, value objects, domain services
  application/           # use cases; one per command/query
  ports/                 # interfaces the application needs from the outside
    UserRepo.ts
    EventPublisher.ts
    Mailer.ts
  adapters/              # implementations of ports
    in/
      http/               # HTTP controllers
      cli/                # CLI commands
    out/
      pg/UserRepo.ts
      kafka/EventPublisher.ts
      sendgrid/Mailer.ts
  composition/
    main.ts              # wires adapters into the application core
```

```typescript
// domain/order.ts — pure
export class Order { /* … */ }

// ports/UserRepo.ts
export interface UserRepo { findById(id: string): Promise<User | null>; }

// application/placeOrder.ts
export function placeOrder(deps: { users: UserRepo; events: EventPublisher }) {
  return async (input: PlaceOrderInput): Promise<Result<OrderId, PlaceOrderError>> => {
    const user = await deps.users.findById(input.userId);
    if (!user) return Err({ kind: "user_not_found" });
    /* … */
    await deps.events.publish({ type: "order.placed", aggregateId: order.id, payload: {/* … */} });
    return Ok(order.id);
  };
}

// adapters/out/pg/UserRepo.ts
export class PgUserRepo implements UserRepo { /* SQL */ }

// composition/main.ts
const users  = new PgUserRepo(pgPool);
const events = new KafkaEventPublisher(kafka);
const place  = placeOrder({ users, events });

app.post("/orders", async (req, res) => {
  const r = await place(req.body);
  return r.ok ? res.json({ id: r.value }) : res.status(400).json({ error: r.error });
});
```

**Dependency direction:** always **inward**. The domain knows nothing about Postgres or Kafka; the adapters know the domain.

**Pros:** maximum testability (swap any adapter); business logic free of infrastructure; clear inversion of control.
**Cons:** more interfaces to define; setup overhead for tiny apps; "ports" can proliferate.

This is the default I recommend for any non-trivial backend service.

---

## Clean Architecture

Uncle Bob (Robert C. Martin), 2012. A specific layering of Hexagonal:

```
        ┌──────────────────────────────────┐
        │   Frameworks & Drivers           │   (web, DB, devices)
        │   ┌────────────────────────────┐ │
        │   │  Interface Adapters        │ │   (controllers, presenters, gateways)
        │   │   ┌──────────────────────┐ │ │
        │   │   │  Application Business│ │ │   (use cases)
        │   │   │   ┌────────────────┐ │ │ │
        │   │   │   │   Entities     │ │ │ │   (enterprise business rules)
        │   │   │   └────────────────┘ │ │ │
        │   │   └──────────────────────┘ │ │
        │   └────────────────────────────┘ │
        └──────────────────────────────────┘
```

The rule: source-code dependencies point only **inward**. Use Cases call Entities; Adapters call Use Cases; Frameworks call Adapters. Nothing on the inside knows anything on the outside.

In TypeScript practice, Clean ≈ Hexagonal with one extra distinction: **Entities** (enterprise-wide rules, reusable across applications) vs **Use Cases** (application-specific orchestrations).

---

## Onion Architecture

Jeffrey Palermo, 2008. Same idea, drawn as concentric circles. The differences from Hexagonal/Clean are essentially cosmetic — implementations look the same in TypeScript.

If your team agrees on a name, run with it. The substance is: **dependencies point toward the domain**.

---

## Vertical Slice Architecture

Jimmy Bogard, ~2014. Instead of layering horizontally, organise vertically by feature.

```
src/
  features/
    place-order/
      PlaceOrder.command.ts
      PlaceOrderHandler.ts
      PlaceOrder.validator.ts
      PlaceOrder.controller.ts
      PlaceOrder.test.ts
    cancel-order/
      CancelOrder.command.ts
      CancelOrderHandler.ts
      …
    get-order/
      GetOrder.query.ts
      GetOrderHandler.ts
      …
```

Each feature owns whatever layers it needs. A simple query might be just a handler + controller; a complex command involves entities, repos, validators.

**Pros:** changes for one feature live in one folder; cohesion is high; tests live next to code; deletion is easy.
**Cons:** some duplication across features (each may have its own DTO mapper); less clear "domain core" — domain logic ends up spread across handlers.

Often combined with Hexagonal: each feature folder is a slice, but shared `domain/` and `ports/` exist alongside. This combination tends to be the most pragmatic for medium-to-large applications.

---

## Modular Monolith

The pragmatic alternative to microservices. One deployable, internally separated into modules with strict boundaries:

```
src/
  modules/
    orders/
      domain/
      application/
      adapters/
      api/              # public exports — what other modules can use
    payments/
      domain/
      application/
      adapters/
      api/
    notifications/
      ...
```

Module A may only import from Module B's `api/`. Inside `domain/`, `application/`, `adapters/`, A has no business reaching in.

Enforce with:

- **eslint-plugin-boundaries** (per-folder import rules)
- **ts-architect** / dependency-cruiser
- Code review

**Pros:** clear boundaries → easy to extract to microservice later; one deploy → low operational cost; can adopt patterns piecemeal.
**Cons:** boundary discipline requires tooling; one runtime per app → harder to scale individual modules independently.

This is the default for teams who've been bitten by premature microservices.

---

## Microservices

Each service is its own deployable, its own database, its own team. Communication via HTTP/gRPC + async messages.

```
[Orders]   [Payments]   [Inventory]   [Notifications]
   │           │            │              │
   └───────────┴────────────┴──────────────┘
                       │
                  ┌────┴────┐
                  │  Bus     │
                  └─────────┘
```

**When microservices help:**

- Teams need independent release cadence.
- Components have wildly different scaling characteristics.
- Polyglot benefits (Node + Python + Rust) are real.

**When they hurt:**

- Team < 30 engineers. Latency budget tight. Domain still evolving.
- The dreaded distributed monolith (see [anti-patterns.md](./anti-patterns.md)).

**Pre-requisites:**

- Outbox for reliable events. See [outbox.md](../patterns/outbox.md).
- Sagas for cross-service workflows. See [saga.md](../patterns/saga.md).
- Idempotency everywhere. See [idempotency.md](../patterns/idempotency.md).
- Distributed tracing.
- CI/CD per service.

Default: **start with a modular monolith**. Extract a service only when you have a strong reason.

---

## CQRS

Command Query Responsibility Segregation, Greg Young, 2010.

Separate the **write model** (commands, optimised for transactional consistency) from the **read model** (queries, optimised for retrieval and display).

```
            ┌──────────────────┐
   write ───▶│ Command Handler  │──▶  Write DB
            └─────────┬────────┘
                      │ events
                      ▼
            ┌──────────────────┐
            │ Projector(s)     │──▶  Read DB(s)
            └──────────────────┘
                      ▲
                      │
   read  ───▶ ┌───────┴────────┐
              │ Query Handler  │
              └────────────────┘
```

Two models, two databases (or two schemas), two code paths. The read side can be heavily denormalised; multiple projections for different views (table, search index, cache).

```typescript
// Write
interface CommandHandler<C, R> { execute(cmd: C): Promise<Result<R, AppError>>; }
class PlaceOrder implements CommandHandler<PlaceOrderCmd, OrderId> { /* … */ }

// Read
interface QueryHandler<Q, R> { execute(q: Q): Promise<R>; }
class OrderSummaryQuery implements QueryHandler<{ orderId: string }, OrderSummaryDto> { /* … */ }
```

**When to use CQRS:**

- Read and write loads diverge drastically (read-heavy with rich queries).
- The "view shape" is very different from the storage shape.
- You're already doing event sourcing (CQRS pairs naturally).

**When NOT to use:**

- Simple CRUD apps. CQRS doubles the moving parts.
- "Read your own write" requirements are strict and your projection lag would matter.

CQRS is sometimes overhyped. The lightweight form ("separate query types from command types but use the same DB") is free; the heavyweight form (separate read store with eventual consistency) is a big commitment.

---

## Event Sourcing

Don't store state; store the **sequence of events** that produced it. State is a fold over the log.

```
events: [
  { type: "OrderPlaced",    orderId: "o_1", items, total },
  { type: "OrderPaid",      orderId: "o_1", amount },
  { type: "OrderShipped",   orderId: "o_1", tracking },
  { type: "OrderDelivered", orderId: "o_1" },
]

state = events.reduce(apply, initialState)
```

```typescript
type OrderEvent =
  | { type: "OrderPlaced";    orderId: string; items: Item[]; total: number }
  | { type: "OrderPaid";      orderId: string; amount: number }
  | { type: "OrderShipped";   orderId: string; tracking: string }
  | { type: "OrderDelivered"; orderId: string };

type OrderState = {
  id: string;
  status: "placed" | "paid" | "shipped" | "delivered" | "cancelled";
  total: number;
  paid: number;
  tracking?: string;
};

function apply(state: OrderState, ev: OrderEvent): OrderState {
  switch (ev.type) {
    case "OrderPlaced":    return { id: ev.orderId, status: "placed", total: ev.total, paid: 0 };
    case "OrderPaid":      return { ...state, status: "paid", paid: state.paid + ev.amount };
    case "OrderShipped":   return { ...state, status: "shipped", tracking: ev.tracking };
    case "OrderDelivered": return { ...state, status: "delivered" };
  }
}

function rehydrate(events: OrderEvent[]): OrderState {
  return events.reduce(apply, { id: "", status: "placed", total: 0, paid: 0 });
}
```

**Pros:**

- Complete audit log "for free".
- Time travel — see any historical state.
- Replay events to populate new projections.
- Natural fit for CQRS.

**Cons:**

- Migrations are painful. You can't "ALTER TABLE" events; you must replay with new logic.
- "What's the current state?" requires a rebuild or a snapshot.
- More moving parts (event store + projections).
- Many devs are unfamiliar with the model.

**Use when:**

- Audit trail is a hard requirement (finance, healthcare, legal).
- Multiple read models are needed.
- The domain naturally thinks in events ("approval workflow", "order lifecycle").

**Don't use when:**

- Audit isn't critical and CRUD would do.
- Team is small and new to the model.
- The domain is simple.

Tools in the TypeScript / Node ecosystem: **EventStoreDB** (with the official Node client), **MartenDB**'s Postgres-based event store via raw SQL, **eventually-typescript**, **node-eventstore**, or roll-your-own on Postgres for small systems. The pattern itself is language-agnostic — adopt the cleanest implementation that fits your runtime.

---

## Domain-Driven Design (tactical)

DDD splits into **strategic** (bounded contexts, ubiquitous language, context maps) and **tactical** (entities, value objects, aggregates, domain events, repositories). The tactical patterns map naturally to TypeScript.

### Value Object

A small, immutable object identified by its **value**, not by identity.

```typescript
class Money {
  constructor(
    readonly amount: number,
    readonly currency: "USD" | "EUR" | "GBP",
  ) {
    if (amount < 0) throw new Error("negative money");
    Object.freeze(this);
  }
  equals(o: Money) { return this.amount === o.amount && this.currency === o.currency; }
  add(o: Money) {
    if (o.currency !== this.currency) throw new Error("currency mismatch");
    return new Money(this.amount + o.amount, this.currency);
  }
}
```

In TypeScript, branded types (see [branded-types.md](../patterns/branded-types.md)) often replace small value objects with no allocation cost.

### Entity

Has an identity that persists across changes.

```typescript
class User {
  constructor(
    readonly id: UserId,
    public name: string,
    public email: Email,
  ) {}
  equals(o: User) { return o.id === this.id; }
}
```

### Aggregate

A consistency boundary around a cluster of entities + value objects, with one entity designated as the root.

```typescript
class Order {
  private _items: OrderLine[] = [];

  constructor(readonly id: OrderId, readonly customerId: UserId) {}

  addItem(item: OrderLine) {
    if (this._items.length >= 100) throw new Error("too many items");
    this._items.push(item);
  }

  get total(): Money { /* compute */ return new Money(0, "USD"); }

  // Invariants are enforced inside the aggregate; external code talks only to the root.
}
```

**Rule:** modifications happen through the aggregate root; outside code never reaches into child entities directly.

### Domain Event

Something that happened in the domain. Often emitted by aggregates.

```typescript
class Order {
  private events: DomainEvent[] = [];

  place() {
    /* … */
    this.events.push({ type: "OrderPlaced", orderId: this.id, at: new Date() });
  }

  pullEvents(): DomainEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

// Repository publishes events on save:
class OrderRepo {
  async save(order: Order) {
    await this.persist(order);
    for (const ev of order.pullEvents()) await this.events.publish(ev);
  }
}
```

### Domain Service

Stateless behaviour that doesn't belong to any single entity but is part of the domain.

```typescript
class OrderPricingService {
  price(order: Order, customer: Customer, discounts: Discount[]): Money { /* … */ return new Money(0, "USD"); }
}
```

### Repository

Collection-like access to aggregates. See [repository.md](../patterns/repository.md).

### Application Service (use case)

Orchestrates a single use case. Calls domain services and repositories. Doesn't have domain logic itself.

```typescript
class PlaceOrderUseCase {
  constructor(
    private orders: OrderRepo,
    private customers: CustomerRepo,
    private pricing: OrderPricingService,
  ) {}

  async execute(cmd: PlaceOrderCmd): Promise<Result<OrderId, AppError>> {
    const customer = await this.customers.findById(cmd.customerId);
    if (!customer) return Err({ kind: "customer_not_found" });
    const order = Order.draft(customer);
    cmd.items.forEach((i) => order.addItem(i));
    order.priceWith(this.pricing);
    await this.orders.save(order);
    return Ok(order.id);
  }
}
```

This is exactly the "Application" layer in Hexagonal / Clean.

---

## Comparison & selection

Pick the simplest style that doesn't actively hurt.

| Style | Best for | Avoid when |
| --- | --- | --- |
| **Layered** | CRUD apps, MVPs, < 10 KLOC | Domain is complex; you'll outgrow it |
| **Hexagonal** | Any non-trivial backend service | Project is tiny |
| **Clean / Onion** | Hexagonal with formal entity/use-case split | Team prefers less ceremony |
| **Vertical Slice** | Feature-heavy apps; medium-large teams | Lots of shared core logic across features |
| **Modular Monolith** | Most production apps; pre-microservices | Team and domain are stable and small |
| **Microservices** | Independent teams, polyglot, very large scale | Most projects, especially early-stage |
| **CQRS (light)** | Any app where read shapes diverge from writes | CRUD apps |
| **CQRS (heavy) + ES** | Audit-heavy, event-driven domains; finance, regulated industries | Simple domains; junior teams |
| **DDD tactical** | Complex domains with rich invariants | CRUD apps where there's no real domain |

### Combined real-world stack

A pragmatic 2026 backend often looks like:

```
TypeScript modular monolith
   ├── Hexagonal per module
   │     ├── DDD tactical patterns (Entity, VO, Aggregate, DomainEvent)
   │     ├── Vertical slice organisation per feature
   │     └── CQRS-light (Command/Query separation at handler level)
   ├── Result types throughout
   ├── Outbox + idempotency for cross-module / external events
   └── Functional core where the domain logic is non-trivial
```

This stack gets you most of the benefits of each idea while staying buildable by a small-to-medium team.

---

## Reference Reading

- *Hexagonal Architecture* — Alistair Cockburn (the foundational paper)
- *Clean Architecture* — Robert C. Martin
- *Domain-Driven Design* — Eric Evans
- *Implementing Domain-Driven Design* — Vaughn Vernon (more hands-on)
- *Patterns of Enterprise Application Architecture* — Martin Fowler
- *Building Event-Driven Microservices* — Adam Bellemare
- *Designing Data-Intensive Applications* — Martin Kleppmann (system-level perspective)
- *Vertical Slice Architecture* talks — Jimmy Bogard

## Summary

> *The architecture is the part you can't change cheaply.*

Pick the style that delays decisions you might regret. Modular Monolith + Hexagonal + Result + Outbox + DDD where the domain warrants it is the safe default for 2026 TypeScript backend services. Microservices and Event Sourcing are powerful tools that need explicit justification.
