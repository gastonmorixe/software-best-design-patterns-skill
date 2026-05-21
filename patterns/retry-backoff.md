# Retry with Exponential Backoff + Jitter

> Resilience pattern. The first thing every distributed system needs and the easiest one to get wrong.

## Intent

Retry **transient** failures automatically, with delays that grow exponentially and include randomness ("jitter") so retries from many clients don't synchronise into a thundering herd.

## The Problem

```typescript
async function fetchUser(id: string): Promise<User> {
  return api.get(`/users/${id}`); // network error or 503 → throws
}
```

A transient network blip or a brief 503 fails this call. The user sees an error for a problem that would have resolved on its own.

The naive fix is just as bad:

```typescript
async function fetchUser(id: string): Promise<User> {
  while (true) {
    try { return await api.get(`/users/${id}`); }
    catch { /* try again */ }
  }
}
```

Now you've built a denial-of-service tool against the upstream service.

## The Solution

Retry — but with bounded attempts, growing delays, and jitter.

```typescript
type RetryOptions = {
  maxAttempts:        number;    // total attempts incl. the first
  baseMs:             number;    // initial delay
  maxMs:              number;    // cap
  jitterStrategy?:    "full" | "equal" | "decorrelated" | "none";
  isRetryable?:       (err: unknown, attempt: number) => boolean;
  onRetry?:           (err: unknown, attempt: number, delayMs: number) => void;
};

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    baseMs,
    maxMs,
    jitterStrategy = "full",
    isRetryable = () => true,
    onRetry = () => {},
  } = opts;

  let lastDelay = baseMs;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryable(err, attempt)) throw err;

      const expDelay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delay = computeJitter(expDelay, lastDelay, jitterStrategy, maxMs);
      lastDelay = delay;

      onRetry(err, attempt, delay);
      await sleep(delay);
    }
  }
}

function computeJitter(
  exp: number,
  last: number,
  strategy: "full" | "equal" | "decorrelated" | "none",
  cap: number,
): number {
  const rand = Math.random();
  switch (strategy) {
    case "none":         return exp;
    case "full":         return rand * exp;
    case "equal":        return exp / 2 + (rand * exp) / 2;
    case "decorrelated": return Math.min(cap, baseMsLike(last, rand));
  }
}

function baseMsLike(last: number, rand: number): number {
  // AWS Architecture Blog "Exponential Backoff and Jitter" — decorrelated.
  return Math.floor(rand * (last * 3 - 1)) + 1;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
```

```typescript
// Usage
const user = await retry(
  () => api.get<User>(`/users/${id}`),
  {
    maxAttempts: 5,
    baseMs: 100,
    maxMs: 5_000,
    jitterStrategy: "full",
    isRetryable(err) {
      if (err instanceof TimeoutError) return true;
      if (err instanceof NetworkError) return true;
      if (err instanceof HttpError) {
        if (err.status >= 500) return true;
        if (err.status === 429) return true; // rate-limited
        return false;                          // 4xx → caller error
      }
      return false;
    },
    onRetry(err, attempt, delay) {
      logger.warn(`retry #${attempt} after ${delay}ms`, err);
    },
  },
);
```

## Jitter Strategies

> *"Jitter saves the world."* — AWS Architecture Blog

Without jitter, retries from many clients align and hit the server in waves. Jitter spreads them.

| Strategy | Delay formula | When to use |
| --- | --- | --- |
| **none** | `base * 2^attempt` | Single client; mostly for tests |
| **full** | `random(0, base * 2^attempt)` | Default. Maximises spread. |
| **equal** | `base * 2^attempt / 2 + random(0, base * 2^attempt / 2)` | Want a minimum delay between retries |
| **decorrelated** | `min(cap, random(base, prevDelay * 3))` | AWS recommendation for high-contention systems |

**Use `full` by default.** The math is simple, the spread is excellent, and you only revisit this if your dependency tells you otherwise.

## Modern TypeScript Twist

### Result-based, no exceptions

```typescript
async function retryResult<T, E>(
  fn: () => Promise<Result<T, E>>,
  opts: RetryOptions & { isRetryable: (e: E, attempt: number) => boolean },
): Promise<Result<T, E>> {
  for (let attempt = 1; ; attempt++) {
    const r = await fn();
    if (r.ok) return r;
    if (attempt >= opts.maxAttempts || !opts.isRetryable(r.error, attempt)) return r;
    const delay = computeJitter(/* … */);
    await sleep(delay);
  }
}
```

### AbortSignal awareness

A retry loop must respect cancellation:

```typescript
async function retry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions & { signal?: AbortSignal },
): Promise<T> {
  const { signal } = opts;
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      return await fn(signal!);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt >= opts.maxAttempts || !opts.isRetryable!(err, attempt)) throw err;
      await sleepAbortable(computeJitter(/* … */), signal);
    }
  }
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}
```

Calls to `fetch` with an `AbortSignal` propagate cancellation through the retry loop.

### Respecting `Retry-After`

For HTTP 429 / 503 with a `Retry-After` header, follow the server's hint instead of your own backoff:

```typescript
onRetry(err, attempt, delay) {
  if (err instanceof HttpError) {
    const ra = err.response.headers.get("retry-after");
    if (ra) {
      const ms = /^\d+$/.test(ra) ? Number(ra) * 1000 : new Date(ra).getTime() - Date.now();
      return Math.max(0, ms);
    }
  }
  return delay;
},
```

(Implementation idea — the function shown above doesn't yet support returning an override; in production use a library that does, like cockatiel.)

### Production libraries

| Library | Notes |
| --- | --- |
| **cockatiel** | TS-native, composable with circuit breaker / timeout / bulkhead |
| **p-retry** | Tiny, focused on promises; covers basic exponential backoff |
| **async-retry** | Older but widely used |
| **node-fetch-retry** | `fetch` wrapper |
| **@aws-sdk/middleware-retry** | If you're in AWS-land, use the SDK's policy |

Example with cockatiel:

```typescript
import { retry, ExponentialBackoff, handleAll } from "cockatiel";

const policy = retry(handleAll, {
  maxAttempts: 5,
  backoff: new ExponentialBackoff({
    initialDelay: 100,
    maxDelay:     5_000,
  }),
});

const user = await policy.execute(() => api.get(`/users/${id}`));
```

## What Counts as "Retryable"

Default to **no**. Add specific cases.

| Class of error | Retryable? | Why |
| --- | --- | --- |
| Network error (ECONNREFUSED, ECONNRESET) | Yes | Transient |
| Timeout | Yes | Maybe the server was slow once |
| HTTP 5xx | Yes (mostly) | Server-side; might be transient |
| HTTP 429 | Yes (after `Retry-After`) | You're being throttled |
| HTTP 400 / 422 | **No** | Caller error; retry won't fix |
| HTTP 401 / 403 | **No** | Auth problem; refresh token first |
| HTTP 404 | **No** | Missing resource; not coming back |
| `DNSError` | Sometimes | If recent DNS rotation, retry once |
| Out of memory | **No** | Will recur |
| Programmer error (TypeError, ReferenceError) | **No** | Bug, not a transient failure |

## Idempotency — Critical for POST/PATCH

Retrying a non-idempotent call can charge a card twice, send two emails, or insert two rows.

For mutating operations, **require an idempotency key** and have the server deduplicate:

```typescript
const response = await retry(() =>
  api.post("/payments", body, { headers: { "Idempotency-Key": orderId } }),
  { maxAttempts: 3, baseMs: 200, maxMs: 5_000 },
);
```

Stripe, Square, and most modern payment APIs implement this. If your own API doesn't, build it (see [idempotency.md](./idempotency.md)).

Never retry a write without an idempotency story.

## When to Use

**Use retry+backoff when:**

- The dependency has transient failures (most do).
- The operation is idempotent (or has an idempotency key).
- A retry is cheaper than failing back to the caller.
- The dependency has bounded capacity (you must throttle yourself).

**Don't use when:**

- The error is permanent (4xx caller errors, bug).
- Latency budget is tighter than the first backoff (real-time auth checks).
- The operation is destructive and not idempotent.
- The caller can retry themselves (browser → API: let the browser do it; API → DB: retry yourself).

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Retrying everything | Strict `isRetryable` predicate |
| Retrying without jitter | Always jitter (full or decorrelated) |
| Retrying without a cap | Always bound `maxAttempts` AND `maxMs` |
| Retrying inside a retry (compounding) | One retry layer per logical operation |
| Retrying non-idempotent writes | Idempotency keys at the server, exposed to clients |
| Retry loop blocks event loop | `await` between attempts; never `while + Date.now()` |
| Burning retry budget on auth failures | Catch 401, refresh token, then retry once |

## Pair With

- **[Circuit Breaker](./circuit-breaker.md)** — when retries don't help (sustained outage), break the circuit.
- **Timeout** — bound each attempt; without it, "five 30s retries" is "two and a half minutes".
- **Bulkhead** — limit concurrent retries so the failed dependency doesn't get amplified traffic.
- **Idempotency Key** — required for mutating retries.
- **Fallback** — what to return when all retries fail.

```typescript
import { wrap, retry, timeout, circuitBreaker, handleAll, ConsecutiveBreaker, ExponentialBackoff } from "cockatiel";

const policy = wrap(
  circuitBreaker(handleAll, { halfOpenAfter: 30_000, breaker: new ConsecutiveBreaker(5) }),
  retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff({ initialDelay: 100, maxDelay: 5_000 }) }),
  timeout(2_000),
);
```

## Observability

Track:

- `retry_attempts_total{outcome=success|failure}` — how often retries help.
- `retry_attempt_count` histogram — distribution of how many attempts succeeded calls needed.
- `retry_delay_ms` histogram — confirm your backoff distribution.
- Per-error-type retry rate — to see if you're retrying things you shouldn't.

If 90% of retries succeed on attempt 1, your retries are pointless. If 90% need attempt 5, your dependency is broken.

## Testing

```typescript
import { describe, it, expect, vi } from "vitest";

describe("retry", () => {
  it("succeeds on second attempt", async () => {
    let count = 0;
    const fn = vi.fn(async () => {
      if (++count < 2) throw new Error("transient");
      return "ok";
    });

    const result = await retry(fn, {
      maxAttempts: 3, baseMs: 1, maxMs: 10, jitterStrategy: "none",
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("propagates non-retryable errors immediately", async () => {
    const err = new Error("client error");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retry(fn, {
      maxAttempts: 5, baseMs: 1, maxMs: 10, isRetryable: () => false,
    })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backs off (verify with fake timers + a probe)", async () => {
    vi.useFakeTimers();
    /* … similar pattern, advance timers, assert delay growth … */
    vi.useRealTimers();
  });
});
```

## Summary

> *Retries fix problems caused by the network. They cause problems caused by everything else.*

Bound attempts and total time. Jitter every delay. Retry only what's transient. Require idempotency on writes. Combine with circuit breakers so you don't retry into a dead service.
