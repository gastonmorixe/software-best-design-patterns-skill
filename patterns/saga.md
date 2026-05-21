# Saga Pattern

> Distributed-systems pattern. Originated in 1987 (Garcia-Molina & Salem) for long-running transactions; rediscovered in the microservices era as the canonical alternative to two-phase commit.

## Intent

Coordinate a sequence of local transactions across services where a global ACID transaction is impossible. If a step fails, run **compensating actions** for the steps that already succeeded — semantic, not transactional, rollback.

## The Problem

An "order placement" spans multiple services, each with its own database:

```
[Customer] → [Order Service] → [Payment Service] → [Inventory Service] → [Shipping Service]
```

You want atomicity: either all four steps happen, or none do. But there's no single database. Two-phase commit (2PC) across services is brittle and rare in modern systems.

A naive approach swallows the inconsistency:

```typescript
async function placeOrder(input: OrderInput) {
  const order   = await orderService.create(input);
  const payment = await paymentService.charge(input);
  await inventoryService.reserve(input);
  await shippingService.ship(order.id);
}
```

If `inventoryService.reserve` fails after `paymentService.charge` succeeded, the customer is charged for an item that won't ship.

## The Solution

Express the workflow as a sequence of **(action, compensation)** pairs. On failure, run the compensations for the steps that already ran, in reverse order.

```typescript
type SagaStep<Ctx> = {
  name:        string;
  execute:     (ctx: Ctx) => Promise<Ctx>;
  compensate?: (ctx: Ctx) => Promise<void>;
};

async function runSaga<Ctx>(initial: Ctx, steps: SagaStep<Ctx>[]): Promise<Ctx> {
  const executed: SagaStep<Ctx>[] = [];
  let ctx = initial;

  try {
    for (const step of steps) {
      ctx = await step.execute(ctx);
      executed.push(step);
    }
    return ctx;
  } catch (err) {
    // Compensate in reverse order. Each compensation must be idempotent.
    for (const step of executed.reverse()) {
      if (!step.compensate) continue;
      try { await step.compensate(ctx); }
      catch (compErr) {
        // Critical: compensation failures need attention. Don't swallow.
        logger.error(`compensation failed in ${step.name}`, compErr);
      }
    }
    throw err;
  }
}
```

```typescript
type OrderCtx = {
  input:       OrderInput;
  orderId?:    string;
  paymentId?:  string;
  reservation?:string;
  shipmentId?: string;
};

await runSaga<OrderCtx>({ input }, [
  {
    name: "create-order",
    execute: async (c) => ({ ...c, orderId: (await orderService.create(c.input)).id }),
    compensate: async (c) => { if (c.orderId) await orderService.markAbandoned(c.orderId); },
  },
  {
    name: "charge-payment",
    execute: async (c) => ({
      ...c,
      paymentId: (await paymentService.charge(c.input, { idempotencyKey: c.orderId! })).id,
    }),
    compensate: async (c) => { if (c.paymentId) await paymentService.refund(c.paymentId); },
  },
  {
    name: "reserve-inventory",
    execute: async (c) => ({
      ...c,
      reservation: (await inventoryService.reserve(c.input, c.orderId!)).id,
    }),
    compensate: async (c) => { if (c.reservation) await inventoryService.release(c.reservation); },
  },
  {
    name: "create-shipment",
    execute: async (c) => ({
      ...c,
      shipmentId: (await shippingService.ship(c.orderId!)).id,
    }),
    // No compensation needed if it's the last step.
  },
]);
```

## Choreography vs. Orchestration

Two flavours of saga, picked by who decides the next step.

### Orchestration (central coordinator)

```
            ┌──────────────┐
            │ Orchestrator │
            └───────┬──────┘
       ┌───────────┬┼┬───────────┐
       ▼           ▼ ▼           ▼
   [Order]    [Payment]    [Inventory] [Shipping]
```

A central service tells each step what to do and when. Compensation is centralised.

| Pros | Cons |
| --- | --- |
| Easy to reason about — the chart is the code | Coordinator is a coupling point |
| Compensation logic in one place | Failures here block the saga |
| Easy to add metrics/logging | Coordinator can grow to a god service |

**Tools:** Temporal, AWS Step Functions, Camunda 8 (Zeebe), Cadence, [restate.dev](https://restate.dev).

### Choreography (events on a bus)

```
                ┌─────────────────────────────┐
                │         Event Bus           │
                └─────────────────────────────┘
                  ▲       ▲       ▲       ▲
                  │       │       │       │
                [Order] [Payment][Inventory] [Shipping]
```

Each service emits events and reacts to others'. There's no central coordinator. Compensation is each service's responsibility.

| Pros | Cons |
| --- | --- |
| No single point of coordination | Hard to trace end-to-end |
| Services stay autonomous | Logic of the saga is scattered |
| Resilience is implicit (services retry from events) | Easy to lose track of the flow |

**Tools:** Kafka, NATS, RabbitMQ, AWS EventBridge.

**Rule of thumb:**

- ≤ 4 steps, well-known flow → **orchestration**. Start simple.
- Many services, many flows, lots of cross-traffic → **choreography**. But invest in tracing.

## Modern TypeScript Twist

### With Temporal (production-grade orchestration)

```typescript
// activities.ts — the "step" functions
export async function createOrder(input: OrderInput): Promise<string> { /* … */ return ""; }
export async function chargePayment(input: OrderInput, idemKey: string): Promise<string> { /* … */ return ""; }
export async function reserveInventory(input: OrderInput): Promise<string> { /* … */ return ""; }
export async function releaseReservation(reservationId: string): Promise<void> { /* … */ }
export async function refundPayment(paymentId: string): Promise<void> { /* … */ }
export async function markOrderAbandoned(orderId: string): Promise<void> { /* … */ }

// workflow.ts — the saga
import { proxyActivities } from "@temporalio/workflow";
import type * as A from "./activities";

const acts = proxyActivities<typeof A>({ startToCloseTimeout: "1 minute" });

export async function placeOrderWorkflow(input: OrderInput): Promise<string> {
  let orderId: string | undefined;
  let paymentId: string | undefined;
  let reservation: string | undefined;

  try {
    orderId    = await acts.createOrder(input);
    paymentId  = await acts.chargePayment(input, orderId);
    reservation= await acts.reserveInventory(input);
    return orderId;
  } catch (err) {
    // Compensations as ordinary activities. Temporal guarantees they retry until success.
    if (reservation) await acts.releaseReservation(reservation);
    if (paymentId)   await acts.refundPayment(paymentId);
    if (orderId)     await acts.markOrderAbandoned(orderId);
    throw err;
  }
}
```

Temporal handles:

- Durability — workflow state survives restarts.
- Retries — each activity retries automatically per policy.
- Idempotency — workflow IDs deduplicate.
- Compensation observability — built into the UI.

**This is the modern default** for non-trivial sagas. Don't roll your own coordinator past the prototype stage.

### With Restate (durable execution)

```typescript
import * as restate from "@restatedev/restate-sdk";

export const orderService = restate.service({
  name: "OrderService",
  handlers: {
    placeOrder: async (ctx: restate.Context, input: OrderInput) => {
      const orderId    = await ctx.run("create-order",   () => createOrder(input));
      try {
        const paymentId   = await ctx.run("charge-payment",  () => chargePayment(input, orderId));
        const reservation = await ctx.run("reserve-inventory", () => reserveInventory(input));
        return { orderId };
      } catch (err) {
        await ctx.run("compensate", () => compensate(orderId));
        throw err;
      }
    },
  },
});
```

`ctx.run(name, fn)` makes each step durable. On crash, replay resumes from the last completed step.

## Compensation Design Rules

1. **Compensations must be idempotent.** They may be invoked more than once.
2. **Compensations must succeed.** If they can't, alert humans; don't silently drop.
3. **Compensations are semantic, not transactional.** A "refund" undoes a "charge" semantically but doesn't make it as if the charge never happened (the customer sees the transaction on their statement).
4. **Order matters.** Compensate in reverse order of execution.
5. **Some steps are not compensatable.** "Send email" can't be unsent. Move them to the end of the saga, after all reversible steps succeed.

```
[reservable] [reservable] [reservable] → [unreversible: send shipment email]
```

## Idempotency Keys

Every step that mutates external state needs an idempotency key — usually the saga's correlation ID or a deterministic derivative:

```typescript
await paymentService.charge(input, { idempotencyKey: `order:${orderId}` });
await inventoryService.reserve(input, { idempotencyKey: `order:${orderId}:reserve` });
```

If the saga is retried (or the worker crashed mid-step), the same key prevents duplicate charges. See [idempotency.md](./idempotency.md).

## Persistent State

A naive in-memory saga loses progress on process crash. Real sagas persist state at every step:

| Mechanism | Notes |
| --- | --- |
| **Workflow engine** (Temporal, Restate, Camunda) | Best. State persists across restarts; replays from the journal. |
| **State machine table** | Save `{sagaId, currentStep, ctx}` in your DB after each step. On startup, resume in-flight sagas. |
| **Event sourcing** | The event log IS the saga state; rehydrate by replay. |

If you're tempted to "just retry the whole thing on crash", first ensure every step is idempotent — and most aren't naturally.

## When to Use

**Use Saga when:**

- A workflow crosses service / database boundaries.
- You need eventual consistency with semantic compensation.
- You can identify a compensating action for each step (or accept some steps are best-effort).
- You can tolerate the intermediate inconsistent window.

**Don't use Saga when:**

- A single database covers the workflow — use a DB transaction.
- Compensation is impossible AND the operation is irreversible — split into pre-checks + commit instead.
- Latency budget is too tight (e.g., sub-second user-facing API) — a saga with 5 network calls is slow.

## Saga vs. Transaction vs. 2PC

| | DB transaction | 2PC | Saga |
| --- | --- | --- | --- |
| Atomicity | Yes (ACID) | Yes (in theory) | Eventual |
| Isolation | Yes | Yes | No (other actors see intermediate states) |
| Network partitions | n/a | Halts | Survives |
| Latency | Low | High | Variable |
| Practical for microservices | No | Rarely | Yes |

If you only need atomicity within one database, use a DB transaction. Don't reach for a saga because it sounds more impressive.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Lost intermediate state on crash | Use a workflow engine, or persist after each step |
| Compensation forgets to run because exception was swallowed | Wrap each step in `try/catch` that pushes onto the compensation stack first |
| Non-idempotent compensations | Design with idempotency in mind from day one |
| Two sagas racing on the same entity | Lock the entity for the saga's duration (status: "processing"), or detect conflict and retry |
| Visibility into a stuck saga is poor | Add structured logging with correlation ID; dashboards for saga state |
| Choreography sprawl | Document the choreography in a diagram; add tracing |

## Observability

A saga without observability is a black hole. Track:

- `saga_started{name}`, `saga_completed{name, outcome}`.
- Time per step (histogram).
- Compensation execution rate (high values mean trouble).
- Currently-stuck sagas (status: in-flight for > X minutes).
- End-to-end trace ID linking every step.

Workflow engines give you most of this for free; rolling your own means building it from scratch.

## Related Patterns

- **Command** — Each step is a Command; compensation is its inverse.
- **Process Manager** — A saga that maintains long-lived state across events; common in choreography-style.
- **Idempotency Key** — Required to make retries safe.
- **Outbox** — Reliable event publication for choreography-style sagas.
- **Two-Phase Commit** — The strictly-ACID alternative. Rarely viable across services.

## Testing

```typescript
import { describe, it, expect, vi } from "vitest";

describe("placeOrder saga", () => {
  it("happy path", async () => {
    const ctx = await runSaga({ input: testInput }, allSteps);
    expect(ctx.orderId).toBeDefined();
    expect(ctx.shipmentId).toBeDefined();
  });

  it("compensates payment when inventory fails", async () => {
    const refund = vi.fn();
    const failingSteps = allSteps.map(s =>
      s.name === "reserve-inventory"
        ? { ...s, execute: async () => { throw new Error("sold out"); } }
        : s.name === "charge-payment"
        ? { ...s, compensate: refund }
        : s,
    );

    await expect(runSaga({ input: testInput }, failingSteps)).rejects.toThrow("sold out");
    expect(refund).toHaveBeenCalled();
  });
});
```

Integration-test the saga with real services (or contract-tested fakes); unit-test the orchestration logic with stubs.

## Summary

> *A saga is not a transaction. It's a discipline for living without one.*

For anything beyond a toy, use a workflow engine (Temporal, Restate, Step Functions). Roll your own only for simple, short orchestrations where the value of one more dependency isn't worth it. Always: idempotency keys, durable state, observability.
