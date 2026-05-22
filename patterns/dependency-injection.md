# Dependency Injection (DI) Pattern

> Modern pattern. Not in GoF but the **default replacement** for Singleton, Service Locator, and many ad-hoc factories.

## Intent

Provide a class or function with the **dependencies it needs from outside**, rather than letting it construct or look them up itself. The class declares what it needs in its constructor / parameters; the composition root decides what to give it.

## The Problem

Inline construction couples a class to concrete implementations, hides its dependencies, and ruins testability:

```typescript
class OrderService {
  private readonly db = new PostgresDb(process.env.DATABASE_URL!);
  private readonly logger = new ConsoleLogger();
  private readonly mailer = new SendGridMailer(process.env.SENDGRID_KEY!);
  private readonly clock = { now: () => new Date() };

  async place(o: Order) {
    this.logger.info("placing");
    await this.db.users.findOne({ id: o.userId });
    await this.mailer.send(o.userId, "confirmation");
  }
}
```

Problems:

- Tests need to spin up Postgres, hit SendGrid (or carefully monkey-patch).
- The class is married to concrete classes; swapping implementations means editing the class.
- Environment configuration leaks into business logic.
- Construction order is implicit.

## The Solution

**Inject** dependencies through the constructor; depend on **interfaces**, not implementations.

```typescript
// ── Interfaces (ports) ────────────────────────────────────
interface UserRepo {
  findOne(criteria: { id: string }): Promise<User | null>;
}

interface Logger {
  info(msg: string): void;
  error(msg: string, cause?: unknown): void;
}

interface Mailer {
  send(to: string, template: string, vars?: Record<string, unknown>): Promise<void>;
}

interface Clock {
  now(): Date;
}

// ── Service depends on interfaces ─────────────────────────
class OrderService {
  constructor(
    private readonly users: UserRepo,
    private readonly logger: Logger,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
  ) {}

  async place(o: Order): Promise<void> {
    this.logger.info(`placing ${o.id} at ${this.clock.now().toISOString()}`);
    const user = await this.users.findOne({ id: o.userId });
    if (!user) throw new Error("user not found");
    await this.mailer.send(user.email, "order-confirmation", { orderId: o.id });
  }
}

// ── Composition root: src/main.ts ─────────────────────────
const db        = new PostgresDb(env.DATABASE_URL);
const logger    = new PinoLogger();
const mailer    = new SendGridMailer(env.SENDGRID_KEY);
const clock     = { now: () => new Date() };
const orders    = new OrderService(db.users, logger, mailer, clock);

// ── Tests: src/order-service.test.ts ──────────────────────
import { vi, describe, it, expect } from "vitest";

describe("OrderService", () => {
  it("emails the user on placement", async () => {
    const users:  UserRepo = { findOne: async () => ({ id: "u_1", email: "a@x.com" } as User) };
    const logger: Logger   = { info: vi.fn(), error: vi.fn() };
    const mailer: Mailer   = { send: vi.fn() };
    const clock:  Clock    = { now: () => new Date("2026-01-01") };

    const svc = new OrderService(users, logger, mailer, clock);
    await svc.place({ id: "o_1", userId: "u_1" } as Order);

    expect(mailer.send).toHaveBeenCalledWith(
      "a@x.com",
      "order-confirmation",
      { orderId: "o_1" },
    );
  });
});
```

## Three Forms of Injection

| Form | Looks like | When to use |
| --- | --- | --- |
| **Constructor** | `constructor(private dep: Dep)` | Default. Required dependencies. |
| **Method** | `doSomething(input, dep: Dep)` | Per-call dependencies (e.g., `Clock` for a pure function). |
| **Property** | `service.logger = logger` (after construction) | Optional dependencies, framework setters. Last resort. |

**Constructor injection is the default.** It makes dependencies visible in the signature and ensures the object is never half-built.

## Modern TypeScript Twist

### Type-only DI with plain functions

You don't need a class or a container. A factory function returning closures gives you the same thing with no ceremony:

```typescript
type OrderServiceDeps = {
  users: UserRepo;
  logger: Logger;
  mailer: Mailer;
  clock: Clock;
};

export function makeOrderService(deps: OrderServiceDeps) {
  return {
    async place(o: Order): Promise<void> {
      deps.logger.info(`placing ${o.id}`);
      const user = await deps.users.findOne({ id: o.userId });
      if (!user) throw new Error("user not found");
      await deps.mailer.send(user.email, "order-confirmation", { orderId: o.id });
    },
  };
}

const orders = makeOrderService({ users, logger, mailer, clock });
await orders.place(o);
```

Pure data, easy to test, no decorators, no metadata reflection.

### Reader monad / contextual injection

For pure functional code, pass deps explicitly through every function. A `Reader` (or thread-local in some langs) hides the parameter:

```typescript
type Reader<R, A> = (r: R) => A;
type Async<R, A>  = (r: R) => Promise<A>;

const place = (o: Order): Async<OrderServiceDeps, void> => async (deps) => {
  deps.logger.info(`placing ${o.id}`);
  const user = await deps.users.findOne({ id: o.userId });
  if (!user) throw new Error("user not found");
  await deps.mailer.send(user.email, "order-confirmation", { orderId: o.id });
};

// Use:
await place(order)(deps);
```

This is what [Effect](https://effect.website/) builds on (`Effect<R, E, A>` — R = required services).

### DI containers (when they earn their weight)

For large apps with many services, manual wiring at the root becomes tedious. A DI container automates it. Popular TS containers:

| Container | Style | Notes |
| --- | --- | --- |
| **tsyringe** | Decorator-based, reflection | Lightweight, Microsoft-maintained |
| **inversify** | Decorator + symbols | Mature, verbose |
| **awilix** | Functional, no decorators | Auto-wiring by parameter name |
| **NestJS DI** | Decorator, module system | Comes with NestJS; superb for that ecosystem |
| **typedi** | Decorator | Simple but archived |

Example with **awilix** (no decorators, plays well with TS 6.x):

```typescript
import { createContainer, asClass, asValue, InjectionMode } from "awilix";

type Cradle = {
  users: UserRepo;
  logger: Logger;
  mailer: Mailer;
  clock: Clock;
  orderService: OrderService;
};

const container = createContainer<Cradle>({ injectionMode: InjectionMode.PROXY });
container.register({
  users:        asClass(PostgresUserRepo).singleton(),
  logger:       asClass(PinoLogger).singleton(),
  mailer:       asClass(SendGridMailer).singleton(),
  clock:        asValue({ now: () => new Date() }),
  orderService: asClass(OrderService).scoped(), // new per request
});

// In OrderService:
class OrderService {
  // awilix injects by parameter name from the cradle.
  constructor({ users, logger, mailer, clock }: Cradle) {
    /* … */
  }
}
```

**When to reach for a container:** > 20 services, complex lifecycle (request-scoped, transient), or a framework that already ships one (Nest, Fastify with awilix). Below that, manual wiring is clearer.

### Lifecycles

| Lifetime | Meaning | Example |
| --- | --- | --- |
| **Singleton** | One instance per container | Logger, DB pool, config |
| **Scoped** | One per "scope" (usually one per HTTP request) | DB transaction, request-scoped logger with correlation ID |
| **Transient** | New instance per resolve | Throwaway DTO builders, stateful helpers |

Wrong lifetimes are a frequent bug source — e.g., a request-scoped DB transaction registered as a singleton leaks across requests.

## DI vs. Service Locator

| Aspect | DI | Service Locator |
| --- | --- | --- |
| Where deps come from | Constructor parameters | Calling `Container.get<T>()` inside the class |
| Visible in signature | Yes | No |
| Testability | Pass fakes directly | Must replace the container globally |
| Coupling | To interfaces | To the container |

**Service Locator is an anti-pattern.** It hides dependencies inside the class body and re-introduces every problem DI solved. If you see `Container.get<T>()` inside business logic, that's a smell.

## Common DI Patterns

### Optional dependencies

```typescript
class OrderService {
  constructor(
    private readonly users: UserRepo,
    private readonly logger: Logger,
    private readonly analytics: Analytics | NoopAnalytics = new NoopAnalytics(),
  ) {}
}
```

Use a **null object** (NoopAnalytics) rather than `Analytics | undefined`. Eliminates the null check throughout the class.

### Factories as dependencies

Need to create N instances of something? Inject a factory:

```typescript
interface ConnectionFactory {
  open(): Promise<Connection>;
}

class Worker {
  constructor(private readonly connections: ConnectionFactory) {}
  async run() {
    const c = await this.connections.open();
    try { /* … */ } finally { await c.close(); }
  }
}
```

### Context object

Sometimes a single grouped object reads more cleanly than 8 separate parameters:

```typescript
type RequestContext = {
  user: User;
  logger: Logger;
  db: Tx;
  clock: Clock;
  traceId: string;
};

async function handleRequest(ctx: RequestContext, req: HttpRequest): Promise<HttpResponse> {
  /* … */
}
```

Common in Go, increasingly common in TS. Keep it narrow — a god-context that holds everything is worse than too many parameters.

## When to Use

**Use DI when:**

- The class has any external dependency (DB, HTTP, FS, clock, randomness).
- You want tests to substitute fakes.
- You want to swap implementations between environments (prod vs dev vs test).
- You're applying **Dependency Inversion** (depend on abstractions).

**Don't use DI when:**

- The dependency is a pure utility (`lodash`, `Math.random`) and substitution has no value.
- The class is a small data-only DTO.
- The dep is conceptually part of the language (`JSON`, `Map`, `Array`).

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| **Too many constructor parameters** | Split the class (it's doing too much) or group related deps |
| **Service Locator in disguise** (passing a "container" through DI) | Inject specific interfaces, not containers |
| **Constructor does work** | Constructors should only assign; do work in init methods or factories |
| **Circular dependencies** | Often indicates a missing third role; or use `Lazy<T>` |
| **DI container as global** | Containers belong at the composition root, not in services |
| **Hidden coupling via "scope"** | Document which lifetime each binding uses |

## Composition Root

The **composition root** is the single place in your application where the dependency graph is built:

```
src/main.ts           # CLI / server entry
src/server.ts         # Express / Fastify bootstrap
src/lambda/index.ts   # Serverless handler
```

Wiring lives here. Nowhere else. Tests have their own composition roots (the test files themselves, or a `test/helpers/build.ts`).

The composition root is allowed to know everything; everything else should know almost nothing. This is the only place where you import concrete classes; the rest of the system imports interfaces.

## Related Patterns

- **Singleton** — DI is the modern replacement. Use container singleton-scope rather than the GoF Singleton.
- **Factory** — Often paired: inject a factory to construct N instances.
- **Strategy** — Strategy variants are typically injected.
- **Abstract Factory** — An abstract factory is one large grouped dependency.
- **Hexagonal Architecture** — Ports are interfaces, adapters are injected; DI is the mechanism.

## Testing

```typescript
import { describe, it, expect, vi } from "vitest";

const fakeClock = (iso: string): Clock => ({ now: () => new Date(iso) });

describe("OrderService.place", () => {
  it("logs with the injected clock", async () => {
    const logger: Logger = { info: vi.fn(), error: vi.fn() };
    const svc = makeOrderService({
      users:  { findOne: async () => ({ id: "u_1", email: "a@x.com" } as User) },
      mailer: { send: vi.fn() },
      logger,
      clock:  fakeClock("2026-01-01T12:00:00Z"),
    });

    await svc.place({ id: "o_1", userId: "u_1" } as Order);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("2026-01-01T12:00:00.000Z"));
  });
});
```

Because dependencies are values, every test is a pure function from inputs (`deps`, `args`) to assertions.

## Summary

> *Constructor injection of interfaces is 95% of "doing DI right".*

Plain DI by constructor parameter is enough for most TypeScript projects. Reach for a container only when manual wiring becomes the bottleneck. Treat the composition root as a single, owned location; ban container access from business code.
