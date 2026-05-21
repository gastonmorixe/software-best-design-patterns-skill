# Hooks Pattern

> Modern pattern. Not in GoF. Originated in React (2018); now in Vue 3 Composition API, Solid, Svelte 5 runes, Preact, and many libraries. Best understood as **Observer × Strategy × Template Method**, expressed as plain functions.

## Intent

Bundle reusable **stateful logic** into a function that can be composed into any component that needs it. The function returns the state and/or actions; the runtime owns the storage and lifecycle.

## The Problem

Sharing stateful logic between components without hooks meant inheritance, mixins, render props, or higher-order components — each with serious downsides:

```typescript
// HOC approach (React, pre-hooks).
function withWindowSize<P>(Wrapped: ComponentType<P & { size: Size }>) {
  return class extends Component<P, { size: Size }> {
    state = { size: getSize() };
    onResize = () => this.setState({ size: getSize() });
    componentDidMount()    { window.addEventListener("resize", this.onResize); }
    componentWillUnmount() { window.removeEventListener("resize", this.onResize); }
    render() { return <Wrapped {...this.props} size={this.state.size} />; }
  };
}

// Components wrapped in 5 HOCs become indecipherable.
export default withTheme(withAuth(withWindowSize(withRouter(withI18n(MyComponent)))));
```

**Symptoms:**

- Deeply nested wrapper hierarchies in DevTools.
- Prop-name collisions across HOCs.
- Hard to type-check correctly.
- Lifecycle logic gets scattered across `componentDidMount` / `componentWillUnmount`.

## The Solution

A hook is a function that:

1. Reads **runtime-provided state** through pre-defined primitives (`useState`, `useEffect`, …).
2. Is called **inside** the body of a component or another hook.
3. Composes with other hooks as plain function calls.

```typescript
function useWindowSize(): Size {
  const [size, setSize] = useState<Size>(getSize());

  useEffect(() => {
    const onResize = () => setSize(getSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return size;
}

function MyComponent() {
  const size = useWindowSize();
  const theme = useTheme();
  const user = useAuth();
  const t = useI18n();
  return <Layout {...{ size, theme, user, t }} />;
}
```

No wrappers, no nesting, no collisions.

## How a Hook Works (one paragraph)

When the framework renders a component, it associates that render with a **per-instance slot list**. Each hook call reads/writes one slot in order. That's why hooks must be called in the same order on every render: the framework matches the *N*-th hook call to the *N*-th slot. State, effects, refs, memoised values all live in those slots.

The contract:

- Same hooks, same order, every render.
- No conditional hook calls.
- Hooks may only be called from components or other hooks.

These three rules are the entire model.

## Modern TypeScript Twist

### Strongly-typed hooks

```typescript
function useLocalStorage<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const setAndPersist = useCallback((next: T) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
  }, [key]);

  return [value, setAndPersist];
}

// Usage:
const [theme, setTheme] = useLocalStorage<"light" | "dark">("theme", "light");
```

Generic, narrow types, no `any`. The hook is a small library function.

### Hooks as objects (Vue / Solid style)

In some frameworks the hook returns an object; the consumer destructures only what it needs:

```typescript
// Vue 3 Composition API
function useCounter(initial = 0) {
  const count = ref(initial);
  const increment = () => count.value++;
  const reset     = () => (count.value = initial);
  return { count, increment, reset };
}

const { count, increment } = useCounter();
```

```typescript
// Solid.js
function createCounter(initial = 0) {
  const [count, setCount] = createSignal(initial);
  return {
    count,
    increment: () => setCount((c) => c + 1),
    reset:     () => setCount(initial),
  };
}

const { count, increment } = createCounter();
```

The mechanism varies (slot-based vs. proxy-based vs. signal-based) but the **shape of the abstraction is the same**: a function that bundles stateful logic.

### Custom hooks for cross-cutting concerns

```typescript
// useDebouncedValue: emit value only after `delay` of no changes.
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}

// useAsync: a uniform interface for fetching.
type AsyncState<T, E = Error> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error";   error: E };

function useAsync<T, E = Error>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T, E> {
  const [s, setS] = useState<AsyncState<T, E>>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    setS({ status: "loading" });
    fn().then(
      (data) => { if (!cancelled) setS({ status: "success", data }); },
      (error) => { if (!cancelled) setS({ status: "error", error: error as E }); },
    );
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return s;
}

// Use:
function UserProfile({ id }: { id: string }) {
  const state = useAsync(() => api.getUser(id), [id]);

  switch (state.status) {
    case "idle":    return null;
    case "loading": return <Spinner />;
    case "error":   return <ErrorBox error={state.error} />;
    case "success": return <UserCard user={state.data} />;
  }
}
```

The component is now declarative. All the timing, cancellation, race-prevention logic lives in `useAsync`.

## Hook Composition

Hooks compose freely:

```typescript
// useQuery: lower-level
function useQuery<T>(key: string, fetcher: () => Promise<T>) { /* … */ }

// useUser: higher-level, built on useQuery
function useUser(id: string) {
  return useQuery(`user:${id}`, () => api.users.get(id));
}

// useCurrentUser: highest-level
function useCurrentUser() {
  const session = useSession();
  const userId  = session?.userId;
  return useUser(userId ?? "anonymous");
}
```

Each layer is testable in isolation.

## Real-World Applications

### 1. Form state + validation

```typescript
function useForm<T>(initial: T, validate: (t: T) => Issue[]) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const issues = useMemo(() => validate(values), [values, validate]);

  return {
    values,
    touched,
    issues,
    setField<K extends keyof T>(k: K, v: T[K]) {
      setValues((s) => ({ ...s, [k]: v }));
    },
    touch<K extends keyof T>(k: K) {
      setTouched((t) => ({ ...t, [k]: true }));
    },
    submit(onSubmit: (t: T) => void) {
      if (issues.length === 0) onSubmit(values);
    },
  };
}
```

### 2. Subscription lifecycle

```typescript
function useEventStream<T>(url: string, onMessage: (msg: T) => void) {
  useEffect(() => {
    const es = new EventSource(url);
    es.onmessage = (e) => onMessage(JSON.parse(e.data));
    return () => es.close();
  }, [url, onMessage]);
}
```

### 3. Permission gates

```typescript
function useCan(action: string, resource: string): boolean {
  const user = useUser();
  return useMemo(() => evaluatePolicy(user, action, resource), [user, action, resource]);
}

function DeleteButton({ resourceId }: { resourceId: string }) {
  const canDelete = useCan("delete", resourceId);
  if (!canDelete) return null;
  return <button onClick={() => api.delete(resourceId)}>Delete</button>;
}
```

### 4. Animation / timing

```typescript
function useInterval(callback: () => void, ms: number | null) {
  const saved = useRef(callback);
  useEffect(() => { saved.current = callback; }, [callback]);

  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
```

## Hooks as Patterns Combined

Hooks are simultaneously:

- **Strategy** — `useStorage`, `useTheme`, `useAuth` swap implementations behind the same interface.
- **Observer** — `useState` subscribes the component to state changes; `useEffect` to dependency changes.
- **Template Method** — the framework's render loop is the skeleton; hooks fill in the steps.
- **Service Locator** — `useContext(SomeCtx)` looks up an ambient value.

That overlap is why hooks feel different but achieve so much.

## When to Use

**Use Hooks when:**

- You're in a framework that supports them (React, Vue, Solid, Svelte 5, Preact).
- You need to reuse stateful logic across components.
- You want effects scoped to lifecycle.
- You'd otherwise reach for HOCs, render props, or mixins.

**Don't use Hooks when:**

- Your framework doesn't have them (Angular has services + DI; Lit uses reactive controllers).
- The logic is pure (just write a function — no hook needed).
- The hook would only be used in one place — inline it.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Calling a hook conditionally | Move the condition inside; hooks must run on every render |
| Forgetting dependency array → stale closures | Enable `react-hooks/exhaustive-deps` ESLint rule |
| `useEffect` with object/function deps re-runs every render | Wrap deps in `useMemo`/`useCallback`; or use refs |
| Effect race conditions (response arrives after unmount) | Capture `cancelled` flag; abort via `AbortController`; or use a query lib |
| Doing complex state with `useState` | Switch to `useReducer` + discriminated union state |
| Custom hook leaks subscriptions | Always return a cleanup function from `useEffect` |
| Hook that "looks like a function" but reads context | Prefix with `use…`; the ESLint rule enforces the rules of hooks |

## Hook Naming Convention

- Prefix with `use…`. Tooling (ESLint, frameworks) relies on the convention.
- Verb-noun: `useAsync`, `useDebouncedValue`, `useLocalStorage`, `useOnlineStatus`.
- Avoid `useGet…` or `useFetch…` for non-fetching utilities — be precise.

## Related Patterns

- **Strategy** — Hook arguments often select a strategy (e.g., `useAuth("password")` vs `useAuth("oauth")`).
- **Observer** — `useState`/`useEffect` subscribe to data sources.
- **Discriminated Union State** — Hooks like `useAsync` return one of these.
- **Dependency Injection** — `useContext` is DI for component trees.
- **Reducer** — `useReducer` is exactly the reducer pattern bound to a component.

## Testing

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";

describe("useCounter", () => {
  it("starts at the initial value", () => {
    const { result } = renderHook(() => useCounter(5));
    expect(result.current.count).toBe(5);
  });

  it("increments", () => {
    const { result } = renderHook(() => useCounter(0));
    act(() => result.current.increment());
    expect(result.current.count).toBe(1);
  });
});
```

`renderHook` gives you a hook instance without a component; `act` flushes updates. For framework-agnostic logic, refactor into pure functions and unit-test them outside the hook.

## Summary

> *Hooks are the modern packaging of stateful logic.*

Treat custom hooks as the primary unit of composition in any hook-capable framework. They are tiny, testable, type-safe libraries for whatever cross-cutting concern you encounter. Resist class-based mixin-style abstractions; resist HOCs. Reach for a hook first.
