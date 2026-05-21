# Circuit Breaker Pattern

> Resilience pattern. Popularised by Michael Nygard's *Release It!* (2007). Standard in every modern microservices toolkit (Hystrix, Polly, Resilience4j, Cockatiel for TS).

## Intent

Stop hammering a failing dependency. When downstream errors exceed a threshold, **open** the circuit: subsequent calls fail fast (without hitting the dependency) for a cool-off period. Periodically try a probe call; if it succeeds, **close** the circuit and resume normal traffic.

## The Problem

A slow or failing dependency cascades:

```typescript
async function getRecommendations(userId: string): Promise<Item[]> {
  return recommendationsService.fetch(userId); // 10s timeout
}
```

If `recommendationsService` is down:

1. Every request hangs for 10s.
2. Connection pool fills with stuck requests.
3. Memory grows (queued requests).
4. **Your** service starts failing too.
5. Upstream callers, in turn, choke.

One slow dependency takes down a healthy fleet.

## The Solution

Wrap the call with a breaker that tracks failures. Three states:

| State | Behaviour |
| --- | --- |
| **Closed** | Calls pass through; failures counted. |
| **Open** | Calls fail immediately for `cooldownMs`. |
| **Half-open** | Allow one probe call. If it succeeds → Closed. If it fails → Open. |

```typescript
type BreakerState =
  | { kind: "closed";    failures: number }
  | { kind: "open";      openedAt: number }
  | { kind: "half-open" };

type BreakerOptions = {
  failureThreshold: number;  // open after N consecutive failures
  cooldownMs:       number;  // how long to stay open
  isFailure?:       (err: unknown) => boolean; // custom failure predicate
};

export class CircuitBreaker {
  private state: BreakerState = { kind: "closed", failures: 0 };
  private readonly opts: Required<BreakerOptions>;

  constructor(opts: BreakerOptions) {
    this.opts = {
      isFailure: () => true,
      ...opts,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.kind === "open") {
      const elapsed = Date.now() - this.state.openedAt;
      if (elapsed < this.opts.cooldownMs)
        throw new CircuitOpenError(this.opts.cooldownMs - elapsed);
      this.state = { kind: "half-open" };
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      if (this.opts.isFailure(err)) this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.state = { kind: "closed", failures: 0 };
  }

  private onFailure(): void {
    if (this.state.kind === "half-open") {
      this.state = { kind: "open", openedAt: Date.now() };
      return;
    }
    const failures = (this.state.kind === "closed" ? this.state.failures : 0) + 1;
    if (failures >= this.opts.failureThreshold) {
      this.state = { kind: "open", openedAt: Date.now() };
    } else {
      this.state = { kind: "closed", failures };
    }
  }

  get currentState(): BreakerState["kind"] { return this.state.kind; }
}

export class CircuitOpenError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`circuit open; retry after ${retryAfterMs}ms`);
  }
}
```

```typescript
// Usage
const recsBreaker = new CircuitBreaker({
  failureThreshold: 5,
  cooldownMs:       30_000,
});

async function getRecommendations(userId: string): Promise<Item[]> {
  try {
    return await recsBreaker.execute(() => recommendationsService.fetch(userId));
  } catch (e) {
    if (e instanceof CircuitOpenError) return getFallbackRecommendations(userId);
    throw e;
  }
}
```

When `recommendationsService` fails 5 times in a row, the breaker opens. The next 30 seconds of calls fall through to `getFallbackRecommendations` immediately — no timeouts, no resource exhaustion. After 30s, one probe call goes through; if it succeeds, normal traffic resumes.

## Modern TypeScript Twist

### Result-based fallbacks

Pair with the [Result pattern](./result.md):

```typescript
async function getRecommendations(
  userId: string,
): Promise<Result<Item[], "circuit_open" | "remote_error">> {
  try {
    const items = await recsBreaker.execute(() => recsApi.fetch(userId));
    return Ok(items);
  } catch (e) {
    if (e instanceof CircuitOpenError) return Err("circuit_open");
    return Err("remote_error");
  }
}
```

Callers handle both branches explicitly rather than rely on exceptions.

### Per-endpoint vs. per-instance

One breaker **per remote service**, not one global breaker. Failures at `users-svc` shouldn't cause `payments-svc` calls to fail fast.

```typescript
const breakers = new Map<string, CircuitBreaker>();
function breakerFor(service: string): CircuitBreaker {
  let b = breakers.get(service);
  if (!b) breakers.set(service, b = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 30_000 }));
  return b;
}

await breakerFor("users").execute(() => usersApi.get(id));
await breakerFor("payments").execute(() => paymentsApi.charge(p));
```

For multi-instance services (e.g., behind a load balancer), open the breaker per **(service, instance)** pair so one bad pod doesn't trip the whole service.

### Production libraries

Don't roll your own past the prototype stage. Use:

- **cockatiel** (TypeScript-native, by Microsoft) — `CircuitBreakerPolicy`, retries, bulkhead, timeout, fallback all in one.
- **opossum** (Node) — feature-rich, EventEmitter-based.
- **@fastify/circuit-breaker** if you're on Fastify.

Example with cockatiel:

```typescript
import { circuitBreaker, ConsecutiveBreaker, retry, handleAll, wrap } from "cockatiel";

const breaker = circuitBreaker(handleAll, {
  halfOpenAfter: 30_000,
  breaker: new ConsecutiveBreaker(5),
});

const policy = wrap(breaker, retry(handleAll, { maxAttempts: 3 }));

const items = await policy.execute(() => recsApi.fetch(userId));
```

## Tuning

| Knob | Trade-off |
| --- | --- |
| `failureThreshold` | Lower = trip sooner (less downstream load), more sensitive to transient blips. Typical: 5–10 consecutive failures, or 50% over a rolling window. |
| `cooldownMs` | Lower = recover faster, more probe traffic to a sick dependency. Typical: 10–60s. |
| Failure predicate | Distinguish *real* errors (5xx, timeout, connection refused) from *normal* failures (404, 422 validation). Don't trip on 4xx. |
| Probe interval | Continuous (cockatiel default) or back-off-style (try once at half-open, fail → wait 2× cooldown). |
| Rolling window vs. consecutive | Consecutive is simpler; rolling window (e.g., "50% of last 100 calls") handles intermittent dependencies better. |

## Failure Predicate

Critical: **not all exceptions count as failure**.

```typescript
function isInfraFailure(e: unknown): boolean {
  if (e instanceof TimeoutError) return true;
  if (e instanceof NetworkError) return true;
  if (e instanceof HttpError && e.status >= 500) return true;
  // 4xx (validation, not found, unauthorized) are not "the service is down".
  return false;
}

new CircuitBreaker({ failureThreshold: 5, cooldownMs: 30_000, isFailure: isInfraFailure });
```

A 404 is the system **working correctly** for a missing resource. Treating it as a failure means a thousand `findById("nope")` calls open the breaker for every healthy user.

## Combine with Retry, Timeout, Bulkhead

Resilience patterns layer:

```typescript
import { wrap, retry, timeout, circuitBreaker, bulkhead, handleAll } from "cockatiel";

const policy = wrap(
  bulkhead(20),                                          // max 20 concurrent
  circuitBreaker(handleAll, { halfOpenAfter: 30_000, breaker: new ConsecutiveBreaker(5) }),
  retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff() }),
  timeout(2_000, TimeoutStrategy.Aggressive),
);

const result = await policy.execute(() => recsApi.fetch(userId));
```

Order matters:

- **Outer → Inner.** `bulkhead → breaker → retry → timeout`. The breaker counts the *aggregated* failure (across retries); retry counts the timeout as a single attempt.
- Don't put `retry` outside `breaker` — you'll retry into an open breaker.

## When to Use

**Use Circuit Breaker when:**

- You call a remote dependency that can be down or slow.
- A failure cascades into resource exhaustion (connections, threads, memory).
- You have a sensible fallback (cached values, degraded experience, empty result).
- The dependency is not idempotent and you can't simply retry.

**Don't use Circuit Breaker when:**

- The dependency is in-process (function calls, in-memory cache) — no benefit.
- Failure is non-recoverable (programmer error, data corruption) — breaker just delays the inevitable.
- The cost of false-positive opens exceeds the benefit (rare, but consider critical paths with low traffic).

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Single global breaker for everything | One per dependency |
| Counting 4xx as failures | Customise `isFailure` |
| Cooldown so long that a brief blip hurts users for minutes | Tune; pair with retry for transient errors |
| No metric / alert on breaker state | Emit a gauge for `breaker_state{name}`; alert when open > 5min |
| Fallback is the same dependency | Fallback to cache, default value, or different service |
| Cold path: breaker never opens, never closes | Test with chaos engineering / fault injection |

## Observability

Expose breaker state as metrics:

```typescript
breaker.on?.("open",   () => metrics.gauge("circuit.open", 1, { name: "recs" }));
breaker.on?.("close",  () => metrics.gauge("circuit.open", 0, { name: "recs" }));
metrics.counter("circuit.calls", 1, { name: "recs", outcome: "rejected" });
```

You want to know:

- Time-series of breaker state per dependency.
- Rate of calls rejected by the breaker (`circuit_rejected_total`).
- Rate of probes during half-open and their outcomes.

## Related Patterns

- **Retry** — handles transient errors; breaker handles sustained ones.
- **Timeout** — bounds individual call latency; breaker bounds *systemic* damage.
- **Bulkhead** — limits concurrency to isolate failures.
- **Fallback** — what to do when the breaker is open.
- **Decorator** — Circuit Breaker is a Decorator around a function.

## Testing

```typescript
import { describe, it, expect, vi } from "vitest";

describe("CircuitBreaker", () => {
  it("opens after N consecutive failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000 });
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    for (let i = 0; i < 3; i++) await expect(cb.execute(fn)).rejects.toThrow("boom");
    expect(cb.currentState).toBe("open");

    // Fails fast without calling fn.
    fn.mockClear();
    await expect(cb.execute(fn)).rejects.toThrow(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("transitions open → half-open → closed on probe success", async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error("x")))).rejects.toThrow();
    expect(cb.currentState).toBe("open");

    vi.advanceTimersByTime(1_100);
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.currentState).toBe("closed");
    vi.useRealTimers();
  });
});
```

## Summary

> *A circuit breaker is a panic stop. It doesn't fix the dependency — it stops you from making things worse.*

Always wrap remote calls. One breaker per dependency. Tune thresholds with care. Combine with retry, timeout, and fallback to build a resilient pipeline.
