# Testing Patterns

Good design and good tests reinforce each other. When tests are hard to write, the design is usually broken. The patterns in this catalog were chosen partly because they make code testable — but testing has its own vocabulary, and getting it right is a force multiplier.

## Table of Contents

1. [Test Pyramid (2026 edition)](#test-pyramid-2026-edition)
2. [Arrange–Act–Assert](#arrangeactassert)
3. [Test Doubles: Dummy, Stub, Fake, Spy, Mock](#test-doubles-dummy-stub-fake-spy-mock)
4. [London vs. Detroit](#london-vs-detroit)
5. [Fixtures, Builders, ObjectMother](#fixtures-builders-objectmother)
6. [Snapshot testing](#snapshot-testing)
7. [Property-based testing](#property-based-testing)
8. [Contract testing](#contract-testing)
9. [Time, randomness, environment](#time-randomness-environment)
10. [Test isolation & ordering](#test-isolation--ordering)
11. [Tooling (Vitest, Playwright, MSW)](#tooling-vitest-playwright-msw)
12. [Anti-patterns](#anti-patterns)

---

## Test Pyramid (2026 edition)

The classical pyramid is still mostly right: lots of fast unit tests, some integration tests, a few end-to-end tests.

```
                    ┌─────────────┐
                    │   E2E       │   slow, brittle, expensive — but irreplaceable
                    ├─────────────┤
                    │ Integration │   medium speed, real adapters
                    ├─────────────┤
                    │   Unit      │   fast, isolated, abundant
                    └─────────────┘
```

The 2026 amendments:

- **The trophy** (Kent C. Dodds): for frontend, integration ≈ unit count; E2E stays small. The argument: testing a React component in isolation often tests implementation; testing the page with React Testing Library catches more real bugs per second.
- **The honeycomb** (André Schaffer): for microservices, fewer unit tests, more contract + integration tests. The argument: most production bugs are at the wire, not in functions.

In both cases the **top** of the pyramid stays small. End-to-end is the slowest, brittlest, most expensive layer.

### What goes where

| Layer | Tests | Examples |
| --- | --- | --- |
| **Unit** | Pure functions, single class, single hook | reducer, formatter, parser, branded-type constructor |
| **Integration** | Many components together, fakes for external IO | repository + DB, API route + handler, slice |
| **Contract** | "The shape my caller expects matches the shape I produce" | OpenAPI / Pact / consumer-driven contracts |
| **E2E** | Real browser, real backend, real database | Playwright in CI |

---

## Arrange–Act–Assert

The structure of a unit test.

```typescript
it("places an order", async () => {
  // Arrange: set up the world
  const fakeUsers = new Map([["u_1", { id: "u_1", email: "a@x.com" }]]);
  const repo = makeFakeUserRepo(fakeUsers);
  const sender = vi.fn();
  const svc = new OrderService(repo, sender);

  // Act: do the one thing under test
  const id = await svc.place({ userId: "u_1", items: [/* … */] });

  // Assert: verify outcome
  expect(id).toBeDefined();
  expect(sender).toHaveBeenCalledWith("a@x.com", "order-confirmation", expect.any(Object));
});
```

One **act** per test. Multiple asserts are fine if they verify the same outcome.

Variations: **Given–When–Then** (BDD), same shape.

---

## Test Doubles: Dummy, Stub, Fake, Spy, Mock

The classic taxonomy (Gerard Meszaros, *xUnit Test Patterns*) — TypeScript-flavoured:

| Type | Purpose |
| --- | --- |
| **Dummy** | Placeholder; passed but not used. `null as unknown as Logger` |
| **Stub** | Returns hard-coded answers. `{ findById: () => Promise.resolve(user) }` |
| **Fake** | Working implementation, simpler than production. In-memory repo. |
| **Spy** | Records calls. `vi.fn()` |
| **Mock** | Spy + expectations set in advance. `vi.fn().mockImplementation(...)` |

### Dummy

```typescript
const dummyLogger = {} as Logger; // never called in this test
```

### Stub

```typescript
const stubRepo: UserRepo = {
  findById: async () => ({ id: "u_1", email: "a@x.com" } as User),
};
```

### Fake (often best)

```typescript
class InMemoryUserRepo implements UserRepo {
  private users = new Map<string, User>();
  async findById(id: string) { return this.users.get(id) ?? null; }
  async save(u: User) { this.users.set(u.id, u); }
  seed(users: User[]) { users.forEach((u) => this.users.set(u.id, u)); }
}
```

A fake feels like the real thing but lives in memory. Excellent for integration tests: you get realistic behaviour without DB setup overhead.

### Spy

```typescript
const sendSpy = vi.fn<typeof mailer.send>();
const svc = new OrderService(repo, { send: sendSpy });
await svc.place(input);
expect(sendSpy).toHaveBeenCalledWith("a@x.com", "confirmation", expect.any(Object));
```

### Mock (with expectations)

```typescript
const mailer = {
  send: vi.fn().mockResolvedValue(undefined),
};
// Assert as part of the test
expect(mailer.send).toHaveBeenCalledTimes(1);
```

**Default:** stubs and fakes. Spy when you need to verify *that* something happened. Mock with strict expectations only when "exactly this happens, in this order, with these args" is the contract.

---

## London vs. Detroit

Two schools of unit-testing, especially relevant for object-oriented designs.

| | London (mockist) | Detroit (classical) |
| --- | --- | --- |
| Boundaries | Mock all collaborators | Use real collaborators when possible |
| Verifies | Behaviour (interactions) | State (outputs) |
| Test count | More tests, smaller scope | Fewer tests, broader scope |
| Refactoring | Brittle (changes to internal interactions break tests) | Robust (only output changes break tests) |
| Best for | Workflow code, orchestration | Computation, transformations |

**Pragmatic mix:** Detroit by default; London at architectural seams (between modules / aggregates) where mocking enforces the contract.

The patterns in this catalog usually nudge you toward Detroit — pure functions, value objects, and discriminated-union state are state-based by nature. Reach for London only when interactions are the actual product (middleware order, lifecycle hooks, retry behaviour).

---

## Fixtures, Builders, ObjectMother

Setting up test data is half the work.

### Inline fixtures (default)

```typescript
const aUser: User = { id: "u_1", email: "a@x.com", name: "Ada", role: "user" };
```

Fine for one-off tests. Becomes tedious when a User has 20 fields and most tests need just one to differ.

### Test data builder

```typescript
class UserBuilder {
  private u: User = { id: "u_default", email: "default@x.com", name: "Default", role: "user" };

  withId(id: string)    { return Object.assign(new UserBuilder(), this, { u: { ...this.u, id } }); }
  withRole(r: User["role"])      { return Object.assign(new UserBuilder(), this, { u: { ...this.u, role: r } }); }
  banned()              { return Object.assign(new UserBuilder(), this, { u: { ...this.u, banned: true } }); }

  build(): User { return this.u; }
}

const admin = new UserBuilder().withRole("admin").build();
const banned = new UserBuilder().banned().build();
```

Or the functional equivalent:

```typescript
const defaults: User = { id: "u_default", email: "default@x.com", name: "Default", role: "user" };
const aUser = (overrides: Partial<User> = {}): User => ({ ...defaults, ...overrides });

const admin  = aUser({ role: "admin" });
const banned = aUser({ banned: true });
```

The functional form is shorter and reads well in TypeScript. The class form is preferred when the construction has invariants.

### ObjectMother

A named factory per scenario.

```typescript
class TestUsers {
  static admin(): User           { return aUser({ id: "u_admin", role: "admin" }); }
  static bannedUser(): User      { return aUser({ id: "u_banned", banned: true }); }
  static premiumCustomer(): User { return aUser({ id: "u_prem", subscription: "pro" }); }
}

// In tests:
const ctx = await placeOrder({ user: TestUsers.premiumCustomer(), items: [/* … */] });
```

Pairs well with builders: `TestUsers.admin()` returns a sensible default; callers can `.with(...)` more.

---

## Snapshot testing

```typescript
expect(renderUserCard(user)).toMatchInlineSnapshot();
```

**Use sparingly.** Good for stable output shapes (formatted HTML, generated SQL, configuration). Bad for changing UIs (every cosmetic change forces a snapshot update; tests stop catching real regressions).

Inline snapshots (`toMatchInlineSnapshot`) are easier to review than external `.snap` files.

---

## Property-based testing

Instead of writing N specific examples, define a **property** that should hold for **all** inputs, then let the library generate inputs.

```typescript
import { test, fc } from "@fast-check/vitest";

test.prop([fc.array(fc.integer())])("sorting is idempotent", (xs) => {
  const a = [...xs].sort((a, b) => a - b);
  const b = [...a].sort((a, b) => a - b);
  expect(b).toEqual(a);
});

test.prop([fc.array(fc.integer())])("sorting yields the same elements", (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  expect(sorted.length).toBe(xs.length);
  expect(sorted.toSorted()).toEqual([...xs].toSorted()); // same multiset
});
```

`fast-check` is the standard TS property-testing library. Especially valuable for:

- Parsers, serializers (round-tripping properties).
- State machines (any sequence of transitions leaves the state consistent).
- Algebraic laws (associativity, commutativity, identity).

Catches edge cases your example-based tests would miss: empty inputs, max integers, Unicode oddities, surrogate pairs.

---

## Contract testing

When two services talk over HTTP / gRPC / events, verify the *shape of the conversation*.

Two flavours:

### Schema-first

OpenAPI / GraphQL schema / Protobuf is the contract. Both sides generate code; tests verify the implementations conform.

```typescript
// schema.openapi.yaml
//   paths:
//     /users/{id}: …
//
// Server: zod-openapi generates request/response validators.
// Client: openapi-fetch generates a typed client.
// Tests assert request/response match the schema.
```

### Consumer-driven contracts (Pact)

Consumer writes "this is what I'll send and what I expect back". Pact captures it. Provider tests its implementation against the captured contract.

```typescript
// consumer.test.ts
provider.given("a user with id u_1 exists")
        .uponReceiving("a request for user u_1")
        .withRequest({ method: "GET", path: "/users/u_1" })
        .willRespondWith({ status: 200, body: { id: "u_1", email: "a@x.com" } });
```

Pact files are versioned and shared between consumer and provider CIs. Catches breaking changes before integration.

For microservices, contract tests + a thin layer of E2E is usually better than a thick layer of E2E.

---

## Time, randomness, environment

Side effects that aren't I/O — the clock, `Math.random()`, env vars — sabotage determinism unless you inject them.

### Inject a clock

```typescript
interface Clock { now(): Date; }

class OrderService {
  constructor(private clock: Clock) {}
  place(o: Order) {
    o.placedAt = this.clock.now();
  }
}

// Production:
const clock: Clock = { now: () => new Date() };

// Tests:
const fixed: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
```

### Inject randomness

```typescript
interface Random { uuid(): string; int(min: number, max: number): number; }

class IdGenerator {
  constructor(private rng: Random) {}
  next(): string { return this.rng.uuid(); }
}

// Tests: a deterministic Random that yields a known sequence.
```

### Vitest fake timers

For code that uses `setTimeout` / `setInterval`:

```typescript
import { vi } from "vitest";

it("fires after the delay", async () => {
  vi.useFakeTimers();
  const cb = vi.fn();
  setTimeout(cb, 1000);

  vi.advanceTimersByTime(1000);
  expect(cb).toHaveBeenCalled();

  vi.useRealTimers();
});
```

---

## Test isolation & ordering

Tests must be order-independent. If `test B` only passes after `test A`, you have a leak.

### Common leaks

- Module-level singleton with state (database connection pool, in-memory cache).
- Shared fixtures mutated by tests.
- Process-level env vars left in place.
- Files created in `/tmp` not cleaned up.

### Hygiene rules

- `beforeEach`: reset state. `afterEach`: clean up.
- One database/schema per test file (or use transactions that roll back).
- Pure tests > tests that touch any global.

### Parallel safety

Vitest runs tests in workers by default. Each worker has its own process — but they share the file system, ports, and external services. Allocate unique ports/schemas per worker:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    poolOptions: { workers: { isolate: true } },
  },
});

// In setup:
const port = 3000 + Number(process.env.VITEST_POOL_ID ?? 0);
```

---

## Tooling (Vitest, Playwright, MSW)

The mainstream 2026 stack.

### Vitest

Unit + integration tests. Compatible with Jest API but faster and ESM-native. Built on Vite.

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",           // or "jsdom" / "happy-dom" for browser-like
    setupFiles: ["./test/setup.ts"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
```

### Playwright

End-to-end browser tests. Replaces Cypress for new projects.

```typescript
import { test, expect } from "@playwright/test";

test("sign up flow", async ({ page }) => {
  await page.goto("/signup");
  await page.fill('input[name="email"]', "ada@example.com");
  await page.fill('input[name="password"]', "longenough12");
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/dashboard");
});
```

Multi-browser, parallel, auto-waits, video on failure. Pair with **`@playwright/test`** matchers (network mocking, accessibility).

### MSW (Mock Service Worker)

HTTP-level mocking that works in jsdom, browser, and Node. The same handlers cover unit tests and Storybook.

```typescript
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const server = setupServer(
  http.get("https://api.example.com/users/:id", ({ params }) => {
    return HttpResponse.json({ id: params.id, name: "Ada" });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

You test your real HTTP client against a fake server, not against a mocked client. The integration is more realistic.

---

## Anti-patterns

| Anti-pattern | Symptom | Fix |
| --- | --- | --- |
| **Testing implementation, not behaviour** | Tests break on any refactor | Test outputs / side effects, not method calls |
| **Excessive mocking** | Setup is bigger than the test | Use fakes; only mock at architectural seams |
| **Flaky tests** | Pass locally, fail in CI 5% of the time | Find the source of nondeterminism (time, random, async timing) |
| **Slow unit tests** | One test > 100ms | It's not a unit test; move it out of the fast suite |
| **No assertions** | Test "passes" without checking anything | Lint rule: `expect-expect` |
| **Snapshot abuse** | Hundreds of snapshots; nobody reviews changes | Limit to stable shapes |
| **One assertion per test religiously** | 10 nearly-identical tests | Group related assertions in one act |
| **Testing private methods directly** | Tests reach into internals; refactors break tests | Test the public seam; rewrite the design if you can't |
| **`it("should…")` with no clear "what"** | "should work correctly" | Name what you're actually verifying |
| **Skipping or ignoring failures** | `.skip`, `.todo` build up | Treat them like bugs; fix or delete weekly |

---

## Reference Reading

- *Growing Object-Oriented Software, Guided by Tests* — Freeman & Pryce (the source of the London school)
- *xUnit Test Patterns* — Gerard Meszaros (the test-double taxonomy)
- *Working Effectively with Legacy Code* — Michael Feathers (seams, characterisation tests)
- *Test-Driven Development by Example* — Kent Beck
- *Property-Based Testing with PropEr, Erlang, and Elixir* — Hébert (the model applies)
- **Tools docs:** Vitest, Playwright, MSW, fast-check

## Summary

> *Tests are the second user of your code. If they hate it, your design hates it.*

Design for testability and tests get easier. Use fakes by default, mocks at seams. Inject the impure dependencies (clock, random, env). Keep the pyramid weighted toward fast unit + integration. Verify contracts with the parties that share them, not with everyone.
