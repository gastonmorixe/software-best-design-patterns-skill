# Idempotency Pattern

> Distributed-systems pattern. The contract that makes retries, replays, and at-least-once delivery safe.

## Intent

Design operations so that running them **once** has the same observable effect as running them **N times** with the same input. Once an operation is idempotent, the caller and the network can retry freely without fear of duplicates.

## Definitions

An operation `f(input)` is **idempotent** iff:

```
f(input); f(input); ... f(input)   ≡   f(input)
```

after the first successful execution. Subsequent calls may be silent no-ops, may return the cached result, or may verify the existing state — but they don't apply the effect twice.

Note the **same input** caveat: idempotency is "running THIS operation again is safe", not "doing roughly the same thing is safe".

## The Problem

Distributed systems retry. Retries happen because of:

- Network errors that look like failures (request reached the server, response was lost).
- Client-side timeouts on slow-but-successful operations.
- Worker process restarts that re-pick up the same job.
- At-least-once message delivery from any modern broker.

If `POST /charges` isn't idempotent, the customer gets charged twice.

## The Solution: Idempotency Keys

For mutating endpoints, accept a client-supplied **idempotency key**. The server:

1. Stores the key + result of the first successful execution.
2. On a duplicate with the same key, replays the stored result instead of re-executing.
3. Detects key reuse with a different request body and rejects it (key-conflict).

```typescript
// Client side:
const idemKey = crypto.randomUUID(); // generated once per logical operation

async function charge(input: ChargeInput): Promise<Receipt> {
  return retry(
    () =>
      api.post<Receipt>("/charges", input, {
        headers: { "Idempotency-Key": idemKey },
      }),
    { maxAttempts: 3 },
  );
}
```

```typescript
// Server side
type IdempotencyRecord = {
  key:          string;
  requestHash:  string;
  responseBody: unknown;
  responseStatus: number;
  createdAt:    Date;
};

interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  put(rec: IdempotencyRecord): Promise<void>;
  startProcessing(key: string, requestHash: string): Promise<"new" | "in_progress" | "duplicate" | "conflict">;
}

async function chargeEndpoint(req: Request): Promise<Response> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) return new Response("missing idempotency key", { status: 400 });

  const body = await req.json();
  const requestHash = await sha256(JSON.stringify(body));

  const state = await store.startProcessing(key, requestHash);
  switch (state) {
    case "duplicate": {
      const rec = (await store.get(key))!;
      return new Response(JSON.stringify(rec.responseBody), { status: rec.responseStatus });
    }
    case "in_progress":
      return new Response("retry-after a moment", { status: 409 });
    case "conflict":
      return new Response("idempotency key reused with different request body", { status: 422 });
    case "new":
      break;
  }

  const receipt = await chargeService.charge(body);
  const response = new Response(JSON.stringify(receipt), { status: 200 });
  await store.put({
    key, requestHash,
    responseBody: receipt, responseStatus: 200, createdAt: new Date(),
  });
  return response;
}
```

This is the contract used by Stripe, Square, AWS API Gateway, and most modern payment / order APIs.

## Schema

```sql
CREATE TABLE idempotency (
  key             TEXT PRIMARY KEY,
  request_hash    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('in_progress', 'done', 'failed')),
  response_status INT,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours'
);

CREATE INDEX idem_expires_idx ON idempotency (expires_at);
```

Run a job that deletes expired rows. 24 hours is typical; tune by usage patterns.

## Modern TypeScript Twist

### Atomic claim with UPSERT

The trickiest piece is "atomically claim or detect duplicate". With Postgres:

```sql
INSERT INTO idempotency (key, request_hash, status)
VALUES ($1, $2, 'in_progress')
ON CONFLICT (key) DO UPDATE
  SET key = idempotency.key  -- no-op, but returns the existing row
RETURNING
  (xmax = 0) AS inserted,    -- true = we inserted; false = it existed
  request_hash,
  status,
  response_status,
  response_body;
```

```typescript
async function startProcessing(key: string, requestHash: string) {
  const row = await db.queryOne(/* SQL above */, [key, requestHash]);
  if (row.inserted) return "new";
  if (row.request_hash !== requestHash) return "conflict";
  if (row.status === "in_progress") return "in_progress";
  return "duplicate";
}
```

Single round trip; no race window.

### Idempotent INSERTs via primary keys

If the operation is "create record with deterministic ID", make the ID a function of the request:

```typescript
const orderId = `order_${customerId}_${crypto.createHash("sha256").update(canonicalize(input)).digest("hex").slice(0, 16)}`;

// INSERT will fail on duplicate; treat as success.
try {
  await db.orders.insert({ id: orderId, ...input });
} catch (e) {
  if (isUniqueViolation(e)) {
    // Already inserted; return the existing record.
    return db.orders.findOne({ id: orderId });
  }
  throw e;
}
```

Cheaper than an idempotency table when the ID is naturally deterministic.

### Idempotent UPDATEs via guards

```sql
-- Charge the order, but only if it isn't already charged.
UPDATE orders
SET status = 'paid', paid_at = now()
WHERE id = $1
  AND status = 'pending';
```

If two retries race, one updates 1 row, the other updates 0. Both can safely report success.

Add a *paid_at* check so subsequent retries become no-ops without surprising side effects.

### `If-Match` / version-based updates

```sql
UPDATE document
SET body = $1, version = version + 1
WHERE id = $2 AND version = $3;
```

Retrying the same `version=$3` succeeds at most once. The second attempt sees a different version and updates 0 rows — caller knows to refresh and re-decide.

## Idempotency by Design

Some operations are **naturally idempotent**:

| Operation | Idempotent? | Why |
| --- | --- | --- |
| `SELECT` | Yes | Reads don't mutate |
| `PUT /resource/{id}` with full body | Yes | Same body → same final state |
| `DELETE /resource/{id}` | Yes-ish | Subsequent DELETEs are 404, not duplicate deletes |
| `POST /collection` (create new ID) | **No** | Each call creates a new resource |
| `POST /charge` | **No** unless keyed | Each call moves money |
| `PATCH /resource/{id}` with delta (`{ likes: { increment: 1 } }`) | **No** | Increments compose |
| `PATCH /resource/{id}` with absolute (`{ likes: 42 }`) | Yes | Same result regardless of count |

Prefer the right-hand column when designing APIs. Use idempotency keys to *upgrade* the left-hand column.

## When to Use

**Use idempotency keys when:**

- The endpoint mutates state (POST, PUT, PATCH, DELETE).
- The client can retry (network, timeout, broker redelivery).
- A duplicate execution has a real cost (money, email, inventory).
- You're building a public API — callers WILL retry.

**Don't use idempotency keys when:**

- The operation is pure (`GET`, `HEAD`, `OPTIONS`).
- The operation is naturally idempotent (PUT-with-full-body).
- The cost of a duplicate is zero (writing to a CRDT, posting to a deduplicating queue).

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Different request body, same key → silently replays old result | Hash the request, reject conflict (422) |
| Key reused across users → privacy leak | Scope keys per user/account |
| Key collisions (UUID v4 is fine; sequential ints are not) | Use UUIDs or `crypto.randomUUID()` |
| Storing keys forever | TTL them (24h–7d) |
| Storing the full response forever | Store enough to replay; consider compressing |
| Race: two parallel requests with same key | `in_progress` status + return 409; client should retry |
| Partial failure mid-operation | Persist the result *atomically* with the side effect (DB transaction) |
| Side effects can't be replayed (e.g., sent email) | Persist the side-effect result; replay returns it, doesn't re-execute |

## Operations That Can't Be Replayed

Sending an email or a webhook can't be undone, but the **decision** can be idempotent: "this notification, identified by `(user, type, dedup-key)`, has been queued once and only once". Then the queue side delivers at-least-once with a consumer dedupe.

```typescript
async function notify(userId: string, kind: NotifKind, dedupeKey: string, body: string) {
  // Insert into a "notifications" table; primary key (userId, kind, dedupeKey).
  // Conflict = already queued, ignore.
  try {
    await db.notifications.insert({ userId, kind, dedupeKey, body, status: "queued" });
    await queue.enqueue({ userId, kind, dedupeKey });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}
```

The user gets one notification, even if the API was retried five times.

## Idempotency in Workflow Engines

Temporal / Restate / Step Functions give you idempotency "for free" via:

- **Workflow IDs** (deduped): submitting the same workflow ID is a no-op.
- **Activity attempts** (replayed deterministically): a crashed activity replays from journaled inputs.
- **Side-effect APIs** (`workflow.sideEffect`): wrap one-shot calls so they only run once.

If you're on a workflow engine, leverage these instead of rolling your own idempotency store.

## Related Patterns

- **Outbox** — events stored in the outbox can include a key; the relay sets it as a Kafka header.
- **Retry + Backoff** — pairs with idempotency: retries are safe only if the operation is idempotent.
- **Saga** — every compensation must be idempotent.
- **Optimistic Locking** — version-based update is a flavour of idempotency for updates.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("charge endpoint idempotency", () => {
  it("returns the cached result on duplicate key", async () => {
    const key = "test-key-1";
    const body = { amount: 1000, currency: "USD", source: "tok_visa" };

    const r1 = await fetch("/charges", {
      method: "POST",
      headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(r1.status).toBe(200);
    const receipt1 = await r1.json();

    const r2 = await fetch("/charges", {
      method: "POST",
      headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(r2.status).toBe(200);
    const receipt2 = await r2.json();

    expect(receipt2).toEqual(receipt1); // same response, not a second charge
  });

  it("rejects same key with different body", async () => {
    const key = "test-key-2";
    await fetch("/charges", {
      method: "POST",
      headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1000, currency: "USD", source: "tok_visa" }),
    });

    const r = await fetch("/charges", {
      method: "POST",
      headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 9999, currency: "USD", source: "tok_visa" }),
    });
    expect(r.status).toBe(422);
  });
});
```

## Summary

> *Idempotency is the prerequisite for every other resilience pattern.*

If your operations aren't idempotent, retries are unsafe, sagas can't compensate, message queues lie. Design idempotency in from the start — for every mutating endpoint, every queue consumer, every workflow step. Use deterministic IDs when possible; use idempotency keys when not.
