# Signals (Reactive Primitive) Pattern

> Modern pattern. Not in GoF. **Observer**, re-imagined with **fine-grained subscriptions** and an explicit dependency graph. Found in SolidJS (2021), Vue 3 reactivity, Svelte 5 runes, Preact Signals, Angular 17+ Signals, and the TC39 [signals proposal](https://github.com/tc39/proposal-signals) (stage 1, 2024).

## Intent

Represent a piece of mutable state as a value that **knows who reads it**. When the value changes, only the readers are re-evaluated — not the entire component tree, not the whole subscriber list.

## The Problem with Vanilla Observer

Classic Observer (and React's `useState`) re-runs **everything** subscribed to a store. To compute "is this component affected?", you have two bad options:

```typescript
// React: re-render component on every store change, then bail out via memo.
const Component = memo(({ store }) => {
  const slice = useStore(store, (s) => s.user.name); // selector
  return <h1>{slice}</h1>;
});

// Or: useEffect chain, manual subscriptions, painful.
```

For deep reactive graphs (spreadsheets, IDEs, dashboards), this re-evaluation is the bottleneck.

## The Solution

A **signal** is a `(get, set)` pair that tracks reads automatically. The runtime builds a dependency graph from the act of reading; when you write, only the nodes downstream of the changed signal recompute.

```typescript
// Conceptual API (the proposal + most libs converge on this).
const count = signal(0);          // mutable atom
const doubled = computed(() => count.value * 2); // derived

effect(() => {
  console.log("doubled is", doubled.value);
});

count.value = 1;  // prints "doubled is 2"
count.value = 5;  // prints "doubled is 10"
```

Three primitives:

| Primitive | Role |
| --- | --- |
| `signal(v)` | Mutable atom you write to. |
| `computed(fn)` | Derived value; recomputes only when its inputs change. |
| `effect(fn)` | Side effect; re-runs when any signal read inside changes. |

That's the whole vocabulary.

## How Tracking Works

When you read `count.value` inside `computed(…)` or `effect(…)`, the runtime records: *this computed/effect depends on `count`*. When `count.value = 1` runs, the runtime walks the dependency graph and invalidates only the downstream computeds/effects. Reads outside a tracking scope are untracked.

```typescript
const a = signal(1);
const b = signal(10);
const sum = computed(() => a.value + b.value); // tracked: a, b

effect(() => console.log("sum =", sum.value)); // tracked: sum (so transitively a, b)

a.value = 2; // sum invalidates → effect runs → "sum = 12"
b.value = 20;// sum invalidates → effect runs → "sum = 22"

// Untracked read:
console.log(untrack(() => sum.value)); // 22, no subscription added
```

## API Variations Across Libraries

```typescript
// SolidJS
const [count, setCount] = createSignal(0);
createEffect(() => console.log(count()));
setCount(5);

// Preact Signals
import { signal, computed, effect } from "@preact/signals-core";
const count = signal(0);
effect(() => console.log(count.value));
count.value = 5;

// Vue 3
import { ref, computed, watchEffect } from "vue";
const count = ref(0);
watchEffect(() => console.log(count.value));
count.value = 5;

// Angular 17+
import { signal, computed, effect } from "@angular/core";
const count = signal(0);
effect(() => console.log(count()));
count.set(5);

// Svelte 5 runes (in .svelte files)
let count = $state(0);
let doubled = $derived(count * 2);
$effect(() => console.log(doubled));
count = 5;

// TC39 Proposal (Polyfill: signal-polyfill)
import { Signal } from "signal-polyfill";
const count = new Signal.State(0);
const doubled = new Signal.Computed(() => count.get() * 2);
count.set(5);
```

Same model, surface-level naming differences. Pick by framework; the mental model carries.

## Modern TypeScript Twist

### Reading without tracking

You often need to peek at a signal without subscribing — for logs, validation, etc.:

```typescript
import { signal, untrack } from "preact/signals-core";

const data = signal<User[]>([]);

effect(() => {
  // Only re-run when `loadingDone.value` changes; ignore `data`.
  if (loadingDone.value) {
    const snapshot = untrack(() => data.value);
    saveToDisk(snapshot);
  }
});
```

### Batching writes

Multiple writes in a microtask should produce one re-eval downstream:

```typescript
import { batch } from "@preact/signals-core";

batch(() => {
  firstName.value = "Ada";
  lastName.value  = "Lovelace";
}); // one effect run, not two
```

### Type-safe writable / readonly signals

```typescript
type ReadSignal<T>  = { readonly value: T };
type WriteSignal<T> = ReadSignal<T> & { value: T };

function makeStore() {
  const _theme: WriteSignal<"light" | "dark"> = signal("light");
  return {
    theme: _theme as ReadSignal<"light" | "dark">,
    toggle() { _theme.value = _theme.value === "light" ? "dark" : "light"; },
  };
}

// Consumer can only read; the toggle is the public API.
```

### Resources (async signals)

Libraries layer "resource" on top: a signal whose value is fetched.

```typescript
// SolidJS
const [user] = createResource(userId, (id) => api.getUser(id));

return (
  <Show when={!user.loading} fallback={<Spinner />}>
    <UserCard user={user()} />
  </Show>
);
```

The resource emits `loading`, `error`, and the value as separate signal-like reads.

## Real-World Applications

### 1. Fine-grained reactive UI

```typescript
// Solid: rendering only re-evaluates JSX expressions whose signals changed.
function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  return (
    <div>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}
```

When `count` increments, only the two text nodes update. No virtual DOM diff, no component re-render.

### 2. Cross-component state without a global store

```typescript
// auth.ts
export const session = signal<Session | null>(null);

export function login(s: Session)   { session.value = s; }
export function logout()            { session.value = null; }
export const isLoggedIn = computed(() => session.value !== null);

// any.ts:
import { isLoggedIn } from "./auth";
effect(() => render(isLoggedIn.value ? <App /> : <Login />));
```

No provider, no context, no library. The signal *is* the store.

### 3. Reactive spreadsheet

```typescript
const a1 = signal(1);
const a2 = signal(2);
const a3 = computed(() => a1.value + a2.value);
const b1 = computed(() => a1.value * 10);
const total = computed(() => a3.value + b1.value);

effect(() => console.log("total =", total.value));

a1.value = 5;  // recompute a3, b1, total. Effect runs once.
```

The graph computes exactly the nodes affected. This is the basis of Excel-style propagation.

### 4. Form validation

```typescript
const email = signal("");
const password = signal("");

const emailValid    = computed(() => /^[^@]+@[^.]+\..+$/.test(email.value));
const passwordValid = computed(() => password.value.length >= 12);
const canSubmit     = computed(() => emailValid.value && passwordValid.value);
```

Each input only triggers the validators that depend on it.

## Signals vs. Hooks vs. Observer

| | Observer (classic) | React hooks + reducer | Signals |
| --- | --- | --- | --- |
| Granularity | Subscriber-level | Component-level | Read-site-level |
| Update propagation | Notify all subscribers | Schedule render of subscribed components | Walk dependency graph |
| Re-eval cost | O(subscribers) | O(component tree) | O(actually-affected reads) |
| Dependency discovery | Manual (`subscribe`) | Manual (`useEffect` deps) | Automatic (read tracking) |
| Compile-time deps | n/a | n/a | n/a (runtime) |

Signals shine when the read graph is rich and most updates touch a small subset.

## Gotchas / Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Reading a signal outside any tracking scope is silently untracked | Helpful for perf, surprising for newbies; document where tracking is active |
| Writing to a signal from inside an effect causes cascades | Move the write outside, or use `batch()` |
| Hot reloading replaces module-level signals → state loss | Use the framework's HMR boundary (Vite/SWC handle this) |
| Conditional reads create conditional subscriptions | Same as hooks: subscription set changes per run; usually OK |
| Cycles in computed graphs | Most libs throw; design out the cycle |
| Stale closures referencing old signal values | Read at the start of each effect run, not via `useRef` |

## When to Use

**Use Signals when:**

- Your framework supports them natively (Solid, Vue, Svelte 5, Angular 17+, Preact).
- You have a graph of derived state where most updates affect a small subset.
- You want surgical UI updates without manual `memo`/selector boilerplate.
- You're modelling spreadsheet-like or interactive-canvas state.

**Don't use Signals when:**

- Your framework is React without `@preact/signals` — use hooks + reducer instead, or fully migrate.
- The state is simple component-local — `useState`/`ref` is enough.
- You need referential equality semantics for diffing (e.g., classic Redux selectors).

## Migration: from Observer to Signals

1. Identify "read sites" (where the UI depends on state).
2. Replace each store value with a `signal` or `computed`.
3. Replace `subscribe()`/`onSnapshot()` callbacks with `effect()`.
4. Remove memoised selectors — signals already do that.
5. Remove manual dependency arrays — signals discover deps automatically.

## Related Patterns

- **Observer** — Signals *are* Observer with finer-grained subscription tracking.
- **Reducer** — Signals can hold reducer state via `signal(state)` + an `update(action)` function.
- **Hooks** — Hooks compose signals (`useSignal`, `createSignal`); signals power hooks under the hood in some frameworks.
- **Lazy Load** — Computeds are lazy by default; they don't run unless read.

## Testing

```typescript
import { signal, effect } from "@preact/signals-core";
import { describe, it, expect, vi } from "vitest";

describe("counter signals", () => {
  it("notifies effects only when value changes", () => {
    const count = signal(0);
    const fn = vi.fn();
    effect(() => { fn(count.value); });

    expect(fn).toHaveBeenCalledTimes(1); // initial
    count.value = 1;
    expect(fn).toHaveBeenCalledTimes(2);
    count.value = 1; // no change
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

Signals are observable values you write to. Tests look exactly like the production code, just shorter.

## Summary

> *Signals are Observer the way it should have been written.*

Signals collapse the "subscribe / unsubscribe / notify" ritual into reads and writes, with automatic dependency tracking and graph-precision updates. If your framework supports them, prefer signals over manual subscriptions and over coarse-grained state stores.
