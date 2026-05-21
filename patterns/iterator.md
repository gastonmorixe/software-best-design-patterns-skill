# Iterator Pattern

## Intent

Provide a way to **access elements of a collection sequentially** without exposing its underlying representation. The collection decides the order; the client just walks it.

## The Problem

You expose the internal structure of a collection — clients depend on it:

```typescript
class UserGroup {
  // Exposed: clients now depend on `users` being an Array.
  users: User[] = [];
}

// Client knows the shape.
for (let i = 0; i < group.users.length; i++) {
  console.log(group.users[i].name);
}

// Switching to a Set, a paginated remote API, or a Tree breaks every caller.
```

You also want:

- Multiple concurrent walks of the same collection.
- Lazy traversal (don't build the whole result up front).
- Filter / map / take while iterating, without materializing intermediate arrays.

## The Solution

JavaScript and TypeScript have a **built-in** iterator protocol. Implement `[Symbol.iterator]` (sync) or `[Symbol.asyncIterator]` (async) and clients use `for…of`, spread, destructuring, and array helpers transparently.

```typescript
// ── Sync iterable ──────────────────────────────────────────
class UserGroup implements Iterable<User> {
  #users: User[] = [];

  add(u: User): void { this.#users.push(u); }

  // Generators give you state-machine iterators for free.
  *[Symbol.iterator](): Iterator<User> {
    for (const u of this.#users) yield u;
  }
}

const group = new UserGroup();
group.add({ name: "Ada" });
group.add({ name: "Linus" });

for (const u of group) console.log(u.name); // works
const names = [...group].map(u => u.name);  // works
const [first, ...rest] = group;              // works
```

The internal storage (`Array` vs `Set` vs `Tree`) is now an implementation detail.

## Structure

```
   ┌──────────────┐      iterator()      ┌──────────────────┐
   │  Iterable    │ ──────────────────▶  │   Iterator       │
   │              │                      │  + next() → IR   │
   │ + [Symbol    │                      │  + return?       │
   │   .iterator] │                      │  + throw?        │
   └──────────────┘                      └──────────────────┘
                                                  │
                                                  │ returns
                                                  ▼
                                       { value: T; done: boolean }
```

## Modern TypeScript Twist

### Generators

Generators are the right tool 95% of the time. They build the iterator state machine for you.

```typescript
function* range(start: number, end: number, step = 1): Generator<number> {
  for (let i = start; i < end; i += step) yield i;
}

for (const i of range(0, 10, 2)) console.log(i); // 0 2 4 6 8
const evens = [...range(0, 10, 2)];               // [0,2,4,6,8]
```

### Async iterators

For streams, paginated APIs, or anything that produces values over time:

```typescript
class PagedApi<T> implements AsyncIterable<T> {
  constructor(
    private readonly fetchPage: (cursor?: string) => Promise<{
      items: T[];
      nextCursor?: string;
    }>,
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let cursor: string | undefined;
    do {
      const { items, nextCursor } = await this.fetchPage(cursor);
      for (const item of items) yield item;
      cursor = nextCursor;
    } while (cursor);
  }
}

// Client:
const users = new PagedApi<User>((cur) => api.users({ cursor: cur }));

for await (const user of users) {
  if (user.banned) continue;
  await sendEmail(user);
}
```

This is the right shape for cursor-paged APIs: you never materialize the full list, but the consumer reads it as a single loop.

### Iterator helpers (TC39, available since Node 22 / Bun / modern browsers)

Standard methods on iterators, no library needed:

```typescript
const users = new PagedApi<User>(/* … */);

const adminEmails = users
  .values()
  .filter((u: User) => u.role === "admin")
  .map((u: User) => u.email)
  .take(10)
  .toArray();
```

For sync iterables there's `Iterator.from(iterable)`; for async there's `AsyncIterator.from(iterable)`.

> Available natively in Node 22+, Bun, Deno, and Chrome 122+. For older targets, the `iter-tools` library mirrors the API.

### Type-safe custom iterators

```typescript
type Tree<T> = { value: T; children: Tree<T>[] };

function* preorder<T>(node: Tree<T>): Generator<T> {
  yield node.value;
  for (const child of node.children) yield* preorder(child);
}

function* postorder<T>(node: Tree<T>): Generator<T> {
  for (const child of node.children) yield* postorder(child);
  yield node.value;
}

function* leaves<T>(node: Tree<T>): Generator<T> {
  if (node.children.length === 0) { yield node.value; return; }
  for (const c of node.children) yield* leaves(c);
}

const tree: Tree<string> = {
  value: "root",
  children: [
    { value: "a", children: [{ value: "a1", children: [] }] },
    { value: "b", children: [] },
  ],
};

[...preorder(tree)];  // ["root", "a", "a1", "b"]
[...postorder(tree)]; // ["a1", "a", "b", "root"]
[...leaves(tree)];    // ["a1", "b"]
```

Each traversal is its own generator — same collection, different orderings, no shared state.

### Lazy infinite sequences

```typescript
function* naturals(): Generator<number> {
  let n = 0;
  while (true) yield n++;
}

// Composable with iterator helpers:
const first10Squares = naturals()
  .map(n => n * n)
  .take(10)
  .toArray();
// [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]
```

## Real-World Applications

### 1. Streaming database query

```typescript
async function* queryUsers(db: Pool, batchSize = 100): AsyncGenerator<User> {
  const cursor = db.query(new Cursor("SELECT * FROM users"));
  while (true) {
    const rows: User[] = await new Promise((res, rej) =>
      cursor.read(batchSize, (err, rows) => err ? rej(err) : res(rows)),
    );
    if (rows.length === 0) break;
    for (const row of rows) yield row;
  }
  await cursor.close();
}

// 10M-row scan with constant memory:
for await (const u of queryUsers(db)) {
  if (u.lastLogin < oldThreshold) await archive(u);
}
```

### 2. File-system walk

```typescript
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

for await (const file of walk("/Users/me/code")) {
  if (file.endsWith(".ts")) console.log(file);
}
```

### 3. Server-sent events as an async iterable

```typescript
async function* sse<T>(url: string): AsyncGenerator<T> {
  const res = await fetch(url);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const event = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = event.replace(/^data: /m, "");
      yield JSON.parse(data) as T;
    }
  }
}

for await (const tick of sse<Tick>("/api/ticks")) {
  updateChart(tick);
}
```

## When to Use

**Use Iterator when:**

- You want to hide a collection's internal representation.
- You need lazy traversal (don't materialize the whole result).
- You're producing values over time (paged API, file walk, stream).
- You want multiple traversal orders (preorder, postorder, leaves-only) on the same data.

**Don't use Iterator when:**

- The collection is small, plain, and won't change shape — a plain array is enough.
- Random access matters — iterators are forward-only.
- You need to traverse the same data many times and the generator is expensive — materialize once, cache.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Re-iterating an iterator returns nothing | Iterables (which build a fresh iterator per loop) ≠ Iterators (one-shot). Implement `[Symbol.iterator]`, not just `next()`. |
| Forgetting `await` on async iterators | Use `for await…of`, not `for…of`. TS will warn if `--strict`. |
| Generator cleanup not running on early `break` | `return()` is called automatically by `for…of` on `break`/`throw`, but only if you `break` — manual iteration with `.next()` must call `.return()` yourself. |
| Mutating the collection mid-iteration | Snapshot first (`[...coll]`) or document the unsafety. |

## Iterator vs. Observable / Stream

| Aspect | Iterator (pull) | Observable (push) |
| --- | --- | --- |
| Who drives | Consumer | Producer |
| Backpressure | Implicit (consumer awaits) | Manual or buffered |
| Cancellation | `break` or `return()` | `unsubscribe()` |
| Standard library | `Iterator`, `AsyncIterator` | RxJS, Web Streams |

If you can pull, prefer Iterator: it has language-level support and natural backpressure.

## Related Patterns

- **Composite** — Iterators traverse Composite trees in defined orders.
- **Factory Method** — `[Symbol.iterator]()` *is* a factory method that creates iterators.
- **Visitor** — Visitor processes elements; the Iterator is what feeds them in.
- **Observer** — Push-based dual of pull-based Iterator.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("walk", () => {
  it("yields files recursively", async () => {
    const found: string[] = [];
    for await (const f of walk("./fixtures")) found.push(f);
    expect(found).toContain("./fixtures/a/b/c.txt");
  });

  it("is restartable", async () => {
    const w1: string[] = []; for await (const f of walk("./fixtures")) w1.push(f);
    const w2: string[] = []; for await (const f of walk("./fixtures")) w2.push(f);
    expect(w1).toEqual(w2);
  });
});
```
