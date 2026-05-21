# Transactional Outbox Pattern

> Distributed-systems pattern. Solves the "dual-write" problem: how do you atomically update your database **and** publish an event?

## Intent

When a service must both **persist state** and **publish an event**, do them in **one local transaction** by writing the event into a same-database `outbox` table. A separate relay process then reads the outbox and publishes to the bus, marking rows as sent.

This is the only correct way to guarantee that "DB state and emitted events agree" without distributed transactions.

## The Problem: Dual Writes

The naive approach is broken in subtle ways:

```typescript
async function placeOrder(input: OrderInput) {
  await db.orders.insert(input);           // (1)
  await kafka.publish("order.placed", input); // (2)
}
```

What happens if:

- (1) succeeds, (2) fails (broker down) → DB has the order, no one is notified. **Lost event.**
- (1) succeeds, (2) succeeds, but the process crashes before responding → caller retries → **duplicate insert + duplicate publish**.
- Reverse order: (2) succeeds, (1) fails → notification for an order that doesn't exist. **Phantom event.**

There's no order of the two writes that produces consistency.

A transaction across DB **and** the broker is theoretically possible with 2PC (XA) — but Kafka, Redpanda, NATS, SNS/SQS, and EventBridge don't support it. So you can't.

## The Solution

Write the event into an `outbox` table **in the same DB transaction** as your business change. A relay (poller or change-data-capture process) reads new outbox rows and publishes them.

```
┌────────────────────────────────────────────┐
│              Service DB                    │
│  ┌──────────┐    ┌──────────────────────┐  │
│  │ orders   │    │ outbox               │  │
│  │  …       │    │ id, type, payload,   │  │
│  │          │    │ aggregate_id,        │  │
│  │          │    │ created_at,          │  │
│  │          │    │ published_at         │  │
│  └──────────┘    └──────────┬───────────┘  │
└─────────────────────────────┼──────────────┘
                              │ poll / CDC
                              ▼
                       ┌─────────────┐
                       │   Relay     │
                       └──────┬──────┘
                              │ publish
                              ▼
                       ┌─────────────┐
                       │   Broker    │
                       └─────────────┘
```

## Implementation

### Schema

```sql
CREATE TABLE outbox (
  id            BIGSERIAL PRIMARY KEY,
  aggregate_id  TEXT NOT NULL,           -- e.g., order_id; used for partitioning
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  headers       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ                -- null = unpublished
);

CREATE INDEX outbox_unpublished_idx
  ON outbox (id) WHERE published_at IS NULL;
```

### Write side: enqueue inside the transaction

```typescript
type DomainEvent = {
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

interface Outbox {
  enqueue(tx: Tx, event: DomainEvent): Promise<void>;
}

class PgOutbox implements Outbox {
  async enqueue(tx: Tx, e: DomainEvent): Promise<void> {
    await tx.query(
      `INSERT INTO outbox (aggregate_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [e.aggregateId, e.type, JSON.stringify(e.payload)],
    );
  }
}

class OrderService {
  constructor(private readonly db: Db, private readonly outbox: Outbox) {}

  async placeOrder(input: OrderInput): Promise<string> {
    return this.db.tx(async (tx) => {
      const order = await tx.query<Order>(
        `INSERT INTO orders (id, …) VALUES (…) RETURNING *`,
        [/* … */],
      );

      await this.outbox.enqueue(tx, {
        type: "order.placed",
        aggregateId: order.id,
        payload: { orderId: order.id, customerId: order.customerId, total: order.total },
      });

      return order.id;
    });
    // Commit guarantees: either both rows exist, or neither does.
  }
}
```

### Read side: the relay

A separate process (or scheduled job) polls unpublished rows:

```typescript
class OutboxRelay {
  constructor(
    private readonly db: Db,
    private readonly producer: KafkaProducer,
    private readonly opts = { batchSize: 100, pollMs: 200 },
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const batch = await this.fetchBatch();
      if (batch.length === 0) {
        await sleep(this.opts.pollMs);
        continue;
      }
      await this.publishBatch(batch);
    }
  }

  private async fetchBatch(): Promise<OutboxRow[]> {
    // SKIP LOCKED keeps multiple relays from grabbing the same rows.
    return this.db.query<OutboxRow>(
      `SELECT id, aggregate_id, event_type, payload, headers
       FROM outbox
       WHERE published_at IS NULL
       ORDER BY id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [this.opts.batchSize],
    );
  }

  private async publishBatch(batch: OutboxRow[]): Promise<void> {
    for (const row of batch) {
      try {
        await this.producer.send({
          topic: row.event_type,
          messages: [{
            key:   row.aggregate_id,         // ordering by aggregate
            value: JSON.stringify(row.payload),
            headers: {
              "outbox-id": String(row.id),
              "event-type": row.event_type,
              ...row.headers,
            },
          }],
        });
        await this.markPublished(row.id);
      } catch (err) {
        // Don't mark; next poll picks it up.
        log.warn(`outbox publish failed for id=${row.id}`, err);
        return; // back off; don't stampede
      }
    }
  }

  private markPublished(id: number): Promise<void> {
    return this.db.query(`UPDATE outbox SET published_at = now() WHERE id = $1`, [id]).then(() => {});
  }
}
```

### Consumer side: handle duplicates

The relay guarantees **at-least-once** delivery. Consumers must be idempotent. Use the `outbox-id` header as a deduplication key:

```typescript
async function handleOrderPlaced(msg: KafkaMessage) {
  const outboxId = msg.headers["outbox-id"]?.toString();
  if (await dedupe.alreadyProcessed(outboxId)) return;

  const event = JSON.parse(msg.value!.toString());
  await processOrderPlaced(event);

  await dedupe.markProcessed(outboxId);
}
```

## Modern TypeScript Twist

### Tightly typed events

```typescript
type DomainEvent =
  | { type: "order.placed";     aggregateId: string; payload: OrderPlacedPayload }
  | { type: "order.cancelled";  aggregateId: string; payload: OrderCancelledPayload }
  | { type: "user.signed_up";   aggregateId: string; payload: UserSignedUpPayload };

interface Outbox {
  enqueue(tx: Tx, event: DomainEvent): Promise<void>;
}
```

The relay still serialises to JSON, but enqueueing is typed end-to-end.

### Schema validation at the boundary

Validate payloads when enqueueing — bad payloads stuck in the outbox poison the queue:

```typescript
const OrderPlaced = z.object({
  orderId: z.string(),
  customerId: z.string(),
  total: z.number().positive(),
});

await outbox.enqueue(tx, {
  type: "order.placed",
  aggregateId: order.id,
  payload: OrderPlaced.parse({ /* … */ }), // throws inside the transaction → rollback
});
```

### Change-Data-Capture relay

Instead of polling, use Debezium / Logical Replication / Postgres CDC. The relay reads the WAL directly:

```
Postgres → Debezium → Kafka
```

Pros: lower latency (single-digit ms), no polling load, no `SKIP LOCKED` contention. Cons: more infra; needs replication slot management.

For most teams, polling at 200ms is fine. For 100k+ events/sec, switch to CDC.

## Ordering Guarantees

| You want… | How |
| --- | --- |
| Total ordering | Single relay, single Kafka partition. **Limits throughput.** |
| Per-aggregate ordering | Use `aggregate_id` as the Kafka partition key. Different aggregates can be reordered. |
| No ordering | Multiple relays, hash-partition by `id`. Highest throughput. |

Per-aggregate ordering is usually what you want and is what the SQL above gives you (single relay) or what Debezium-with-key gives you (CDC).

## Tail of Inferences

| Property | Outbox gives you |
| --- | --- |
| Atomicity of (DB change + event) | **Yes**, via DB transaction |
| At-least-once delivery | **Yes** |
| Exactly-once delivery | **No** — consumers must dedupe |
| Ordering | Per-aggregate, if relay/key set up right |
| Throughput | Limited by the relay; CDC scales further |
| Resilience to broker outage | **Yes** — events accumulate in outbox |
| Resilience to DB outage | Same as the rest of your service |

## When to Use

**Use Outbox when:**

- A service writes to a DB **and** publishes events.
- You can't lose events or have phantom events.
- You can tolerate at-least-once + idempotent consumers.

**Don't use Outbox when:**

- You only publish events (no DB write to coordinate with).
- The broker writes the source of truth (event-sourced systems where the broker IS the storage).
- Latency is so tight that even CDC's millisecond delay is unacceptable.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Outbox table grows unbounded | Archive published rows (e.g., > 7 days) to cold storage; or delete |
| Two relays race → duplicate publishes | Use `FOR UPDATE SKIP LOCKED` or single-leader election |
| Bad payload poisons the queue | Validate at enqueue; have a "poison" status the relay can set |
| Relay can't keep up | Monitor `unpublished_count` and `publish_lag_seconds`; scale relays or move to CDC |
| Consumers aren't idempotent → duplicates re-process | Always dedupe by `outbox-id` |
| Forgetting to publish on app start | The relay runs continuously; don't tie publishing to specific user actions |

## Outbox vs. Inbox

The **Inbox pattern** is the receiver-side mirror:

```sql
CREATE TABLE inbox (
  message_id    TEXT PRIMARY KEY,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);
```

On receipt, insert into `inbox` in the same transaction as the side effect. Duplicate deliveries fail the `PRIMARY KEY` constraint — exactly-once processing.

Outbox at the producer + Inbox at the consumer = end-to-end exactly-once-effective delivery, without 2PC.

## Observability

Track:

- `outbox_unpublished_count` gauge — high values mean the relay is behind.
- `outbox_publish_lag_seconds` histogram — time between `created_at` and `published_at`.
- `outbox_publish_failures_total` — broker outage signals.
- `outbox_table_size_bytes` — schedule archival when it grows.

## Related Patterns

- **Saga** — choreography-style sagas need outbox to publish reliable events.
- **Event Sourcing** — outbox sometimes used as the "command log" feed.
- **Idempotency** — consumers of outbox events MUST be idempotent.
- **CQRS** — read models built by consuming outbox-published events.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("OrderService + Outbox", () => {
  it("atomically writes order and event", async () => {
    const db = await testDb();
    const orders = new OrderService(db, new PgOutbox());

    const id = await orders.placeOrder({ /* … */ });

    const order = await db.query("SELECT * FROM orders WHERE id = $1", [id]);
    const event = await db.query("SELECT * FROM outbox WHERE aggregate_id = $1", [id]);
    expect(order).toHaveLength(1);
    expect(event).toHaveLength(1);
  });

  it("rollback drops both", async () => {
    const db = await testDb();
    const failingOutbox: Outbox = { enqueue: async () => { throw new Error("boom"); } };
    const orders = new OrderService(db, failingOutbox);

    await expect(orders.placeOrder({ /* … */ })).rejects.toThrow("boom");

    const orderCount = await db.query("SELECT count(*) FROM orders");
    expect(Number(orderCount[0].count)).toBe(0);
  });
});
```

## Summary

> *If you have a database AND a message broker AND you write to both, you need an Outbox. There is no other correct answer.*

Write business data and events atomically to the same database. Let a relay forward the events. Make consumers idempotent. Don't dual-write.
