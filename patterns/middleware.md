# Middleware (Onion) Pattern

> Modern pattern. Not in GoF — but a synthesis of **Decorator** + **Chain of Responsibility** + dependency inversion. The default extension model in Express, Koa, Fastify, Hono, Elysia, NestJS interceptors, Redux middleware, and HTTP frameworks across every language.

## Intent

Build a pipeline of composable, single-purpose handlers around a core operation. Each layer can:

1. Inspect or transform the **incoming** request before passing it inward.
2. Inspect or transform the **outgoing** response before sending it outward.
3. Short-circuit the chain entirely.
4. Add side effects (logging, metrics) without coupling them to the core.

Hence the "onion": you peel the request through layers; the response unfolds back out.

## The Problem

Cross-cutting concerns (auth, logging, validation, rate-limiting, telemetry) want to apply to many routes but live separately. Inlining them yields spaghetti:

```typescript
async function listUsers(req: Request, res: Response) {
  const start = Date.now();
  log.info(`→ ${req.method} ${req.url}`);

  // Auth
  const token = req.headers.authorization?.replace("Bearer ", "");
  const user = token ? await verifyJwt(token) : null;
  if (!user) { res.status(401).end(); log.info(`401 ${Date.now() - start}ms`); return; }

  // Rate limit
  const allowed = await rateLimiter.check(user.id);
  if (!allowed) { res.status(429).end(); log.info(`429 ${Date.now() - start}ms`); return; }

  // Actual work
  try {
    const users = await db.users.list();
    res.json(users);
    log.info(`200 ${Date.now() - start}ms`);
  } catch (e) {
    log.error(e);
    res.status(500).end();
    log.info(`500 ${Date.now() - start}ms`);
  }
}
```

Every handler repeats this. Adding a new concern (audit log, idempotency keys) touches every file.

## The Solution

Extract each concern as a middleware: a function that wraps the next handler.

```typescript
// ── Type ───────────────────────────────────────────────────
type Handler<Ctx, Out> = (ctx: Ctx) => Promise<Out>;
type Middleware<Ctx, Out> = (next: Handler<Ctx, Out>) => Handler<Ctx, Out>;

// ── Compose: outermost first ──────────────────────────────
function compose<Ctx, Out>(...mws: Middleware<Ctx, Out>[]): Middleware<Ctx, Out> {
  return (terminal) => mws.reduceRight((next, mw) => mw(next), terminal);
}
```

```typescript
// ── A middleware: logging ─────────────────────────────────
const logging: Middleware<Ctx, Response> = (next) => async (ctx) => {
  const start = Date.now();
  ctx.logger.info(`→ ${ctx.req.method} ${ctx.req.url}`);
  const res = await next(ctx);
  ctx.logger.info(`← ${res.status} ${Date.now() - start}ms`);
  return res;
};

// ── A middleware: auth ────────────────────────────────────
const auth: Middleware<Ctx, Response> = (next) => async (ctx) => {
  const token = ctx.req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return new Response(null, { status: 401 });
  ctx.user = await verifyJwt(token);
  return next(ctx);
};

// ── A middleware: rate limit ──────────────────────────────
const rateLimit = (limiter: RateLimiter): Middleware<Ctx, Response> =>
  (next) => async (ctx) => {
    if (!ctx.user) return next(ctx);
    if (!(await limiter.check(ctx.user.id)))
      return new Response(null, { status: 429 });
    return next(ctx);
  };

// ── A middleware: error handling ──────────────────────────
const errorBoundary: Middleware<Ctx, Response> = (next) => async (ctx) => {
  try { return await next(ctx); }
  catch (e) {
    ctx.logger.error("unhandled", e);
    return new Response("Internal error", { status: 500 });
  }
};

// ── Terminal handler: the actual route ────────────────────
const listUsers: Handler<Ctx, Response> = async (ctx) => {
  const users = await ctx.db.users.list();
  return Response.json(users);
};

// ── Pipeline ──────────────────────────────────────────────
const handle = compose(
  errorBoundary,
  logging,
  auth,
  rateLimit(redisLimiter),
)(listUsers);
```

Calling `handle(ctx)` walks **inward** through `errorBoundary → logging → auth → rateLimit → listUsers`, then **outward** in reverse order. Each middleware sees the request on the way in and the response on the way out.

## Onion Visualization

```
client
   │ request
   ▼
┌── errorBoundary ─────────────────────────────────────────────┐
│ ┌── logging ───────────────────────────────────────────────┐ │
│ │ ┌── auth ──────────────────────────────────────────────┐ │ │
│ │ │ ┌── rateLimit ─────────────────────────────────────┐ │ │ │
│ │ │ │                                                  │ │ │ │
│ │ │ │        listUsers (terminal handler)              │ │ │ │
│ │ │ │                                                  │ │ │ │
│ │ │ └──────────────────────────────────────────────────┘ │ │ │
│ │ └──────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
   │ response
   ▼
client
```

## Modern TypeScript Twist

### Strongly-typed context evolution

Middleware that adds to the context can refine the type:

```typescript
type Ctx = { req: Request; logger: Logger; db: Db };
type AuthedCtx = Ctx & { user: User };

const auth = (ctx: Ctx, next: (ctx: AuthedCtx) => Promise<Response>): Promise<Response> => {
  /* …verify token… */
  return next({ ...ctx, user });
};

// Now downstream handlers can require AuthedCtx and the type system enforces ordering:
const onlyAuthed: Handler<AuthedCtx, Response> = async (ctx) => {
  ctx.user; // OK
  return new Response("hello, " + ctx.user.name);
};

// Calling onlyAuthed without `auth` upstream is a type error.
```

Hono, Elysia, and tRPC all do this — the type of the context evolves as you `.use()` middleware.

### Per-route middleware vs. global

```typescript
// Global (every route):
app.use(logging);
app.use(auth);

// Per route (only this one):
app.get("/admin", compose(requireAdmin)(adminHandler));
```

Most frameworks let you do both. Keep auth scoped to the routes that need it, not global, so health checks and public assets aren't gated.

### Branching middleware

```typescript
const ifMethod = (method: string, mw: Middleware<Ctx, Response>): Middleware<Ctx, Response> =>
  (next) => async (ctx) => (ctx.req.method === method ? mw(next)(ctx) : next(ctx));

// Only validate body on POST/PUT:
app.use(ifMethod("POST", validateBody(schema)));
```

### Streaming-aware middleware

For frameworks that use `Response` objects (Hono, Bun, Deno, Cloudflare Workers, Edge runtime), middleware can wrap streaming bodies:

```typescript
const compression: Middleware<Ctx, Response> = (next) => async (ctx) => {
  const res = await next(ctx);
  if (!ctx.req.headers.get("accept-encoding")?.includes("gzip")) return res;
  if (!res.body) return res;
  const compressed = res.body.pipeThrough(new CompressionStream("gzip"));
  const headers = new Headers(res.headers);
  headers.set("content-encoding", "gzip");
  return new Response(compressed, { status: res.status, headers });
};
```

## Real-World Applications

### 1. HTTP frameworks

```typescript
// Express
app.use(helmet());
app.use(express.json());
app.use(cors());
app.use(rateLimiter);
app.use("/api", router);
app.use(errorHandler); // last; catches errors from above

// Hono (Cloudflare Workers / Bun / Node / Deno)
import { Hono } from "hono";
import { cors, logger, secureHeaders } from "hono/middleware";

const app = new Hono<{ Variables: { user: User } }>();
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", cors());
app.use("/api/*", async (c, next) => {
  const token = c.req.header("Authorization")?.slice(7);
  c.set("user", await verifyJwt(token));
  await next();
});
app.get("/api/me", (c) => c.json(c.var.user));
```

### 2. Redux middleware

```typescript
type ReduxMiddleware<S, A> =
  (store: { getState: () => S; dispatch: (a: A) => A }) =>
    (next: (a: A) => A) =>
      (action: A) => A;

const logger: ReduxMiddleware<AppState, Action> = (store) => (next) => (action) => {
  console.log("→", action);
  const result = next(action);
  console.log("←", store.getState());
  return result;
};

const thunk: ReduxMiddleware<AppState, Action> = (store) => (next) => (action) =>
  typeof action === "function" ? action(store.dispatch, store.getState) : next(action);

const store = configureStore({ reducer, middleware: () => [thunk, logger] });
```

Same onion shape, applied to actions instead of HTTP requests.

### 3. Database / repository decorators

```typescript
type Tx<T> = () => Promise<T>;
type TxMiddleware = <T>(next: Tx<T>) => Tx<T>;

const withRetries: TxMiddleware = (next) => async () => {
  for (let attempt = 0; ; attempt++) {
    try { return await next(); }
    catch (e) {
      if (!isRetryable(e) || attempt >= 3) throw e;
      await sleep(2 ** attempt * 100);
    }
  }
};

const withCircuitBreaker = (cb: CircuitBreaker): TxMiddleware => (next) => async () => {
  if (cb.isOpen()) throw new Error("circuit open");
  try {
    const r = await next();
    cb.onSuccess();
    return r;
  } catch (e) {
    cb.onFailure();
    throw e;
  }
};
```

### 4. NestJS interceptors

NestJS interceptors are middleware with a different name — they take a handler that returns an `Observable`, allow `tap`/`map` over it.

### 5. gRPC interceptors

`grpc-js` and `connect-rpc` both use the middleware shape for client and server hooks.

## Order Matters

Outer middleware sees the request **first** and the response **last**. Get the order wrong and:

- `errorBoundary` outside `logging` ⇒ errors are logged.
- `errorBoundary` inside `logging` ⇒ errors *might* short-circuit before logging happens (depending on the implementation).
- `auth` before `rateLimit` ⇒ rate limit keyed by user (good if you trust the user, bad if attacker spams logins).
- `rateLimit` before `auth` ⇒ rate limit keyed by IP (good for login endpoints).

Document the ordering invariants. Reordering by accident is a security bug.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Middleware mutates request/response and downstream depends on the mutation | Make context evolution typed (`Ctx → AuthedCtx`); prefer new objects to in-place mutation |
| Middleware order is implicit, hard to reason about | Centralise composition; test the full chain |
| Forgetting `await next()` swallows the rest of the chain | TS warns with `--strict`; ESLint rule `require-await` catches some |
| Error in middleware crashes process | Wrap with an outer `errorBoundary` |
| Per-request state leaks via closure-captured globals | Use the framework's context object; avoid module-level mutable state |
| Middleware bypasses auth for a "public" route accidentally | Make auth opt-out (default deny), not opt-in |

## Middleware vs. Decorator

| | Middleware | Decorator |
| --- | --- | --- |
| Shape | `(next) => (input) => output` | `(input) => output` wrapping another `(input) => output` |
| Sequencing | Chain composed at startup | Composed per call site |
| Typical scope | Cross-cutting (request pipeline) | Per-object enhancement |

Structurally identical; middleware is a Decorator that wraps a `next` function rather than an object.

## Middleware vs. Chain of Responsibility

| | Middleware | CoR |
| --- | --- | --- |
| Each layer's job | Wrap the rest of the pipeline | Decide to handle or pass |
| Sees response on the way out | Yes | No (one-way) |
| Short-circuit semantics | Return early instead of `next()` | Same |

Middleware = CoR with a return path.

## When to Use

**Use Middleware when:**

- You have cross-cutting concerns (auth, logging, rate limit, tracing, error handling) across many handlers.
- You want to add behaviour without modifying the core handler.
- You want to reorder/replace concerns in different environments (e.g., add audit logging in prod only).
- You're building a framework or SDK that needs extension points.

**Don't use Middleware when:**

- A concern applies to exactly one handler — inline it.
- Order is irrelevant — middleware ceremony is wasted; use plain function calls.
- You need parallel fan-out — middleware is sequential by design.

## Related Patterns

- **Decorator** — Middleware *is* Decorator, applied to functions instead of objects.
- **Chain of Responsibility** — Middleware extends CoR by adding the return path.
- **Pipeline** — Middleware is a pipeline where each stage is a function-wrapping function.
- **Hexagonal Architecture** — Middleware lives in adapters; the domain core sits behind them.

## Testing

```typescript
import { describe, it, expect, vi } from "vitest";

describe("auth middleware", () => {
  it("401s without token", async () => {
    const handler = auth(async () => new Response("ok"));
    const res = await handler({
      req: new Request("https://x/"),
      logger: silent,
      db: {} as Db,
    });
    expect(res.status).toBe(401);
  });

  it("calls next with attached user when token is valid", async () => {
    const next = vi.fn(async (c) => new Response(`hello ${c.user.name}`));
    const handler = auth(next);
    const res = await handler({
      req: new Request("https://x/", { headers: { authorization: "Bearer good" } }),
      logger: silent,
      db: {} as Db,
    });
    expect(next).toHaveBeenCalled();
    expect(await res.text()).toBe("hello Ada");
  });
});
```

Each middleware tests in isolation with a fake `next`. Full chains test by composing the real middlewares and asserting end-to-end.

## Summary

> *Middleware is how cross-cutting concerns stay out of business code.*

Compose your pipeline at the edges of your system. Keep middleware small, single-purpose, and ordered with intent. The result is a request handler whose source reads like a recipe: each ingredient is one line, each step does one thing.
