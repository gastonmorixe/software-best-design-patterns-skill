# Reducer Pattern

> Modern pattern. Popularised by Redux (2015) and the React `useReducer` hook. Functional cousin of **State** + **Command**.

## Intent

Express state evolution as a **pure function**: `(state, action) → state`. The function (the reducer) is the only place state changes; everything else dispatches actions and reads the resulting state.

## The Problem

State scattered across setters becomes impossible to reason about:

```typescript
class Cart {
  items: Item[] = [];
  coupon: Coupon | null = null;
  shipping: Address | null = null;

  addItem(i: Item) {
    this.items.push(i);
    this.recomputeTotal();
    this.maybeClearCoupon();
    this.notify();
  }

  removeItem(id: string) { /* … similar fanout … */ }
  applyCoupon(c: Coupon) { /* … */ }
  setShipping(a: Address) { /* … */ }
}
```

**Problems:**

- No single source of truth for "what changed and why".
- Replay/undo/persistence require reverse-engineering.
- Hard to test transitions in isolation.
- Side effects intertwined with state changes.

## The Solution

Express every state change as an **action** (a value describing intent). A reducer maps `(state, action)` to a new state. Actions are pure data; the reducer is a pure function; side effects live elsewhere.

```typescript
// ── State as discriminated union or plain object ───────────
type CartState = {
  readonly items: ReadonlyArray<Item>;
  readonly coupon: Coupon | null;
  readonly shipping: Address | null;
};

// ── Actions as a discriminated union ───────────────────────
type CartAction =
  | { type: "items/add";        item: Item }
  | { type: "items/remove";     id: string }
  | { type: "items/clear" }
  | { type: "coupon/apply";     coupon: Coupon }
  | { type: "coupon/clear" }
  | { type: "shipping/set";     address: Address };

// ── Reducer: pure (state, action) → state ─────────────────
function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "items/add":
      return { ...state, items: [...state.items, action.item] };
    case "items/remove":
      return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case "items/clear":
      return { ...state, items: [] };
    case "coupon/apply":
      return { ...state, coupon: action.coupon };
    case "coupon/clear":
      return { ...state, coupon: null };
    case "shipping/set":
      return { ...state, shipping: action.address };
  }
}

// ── Use ────────────────────────────────────────────────────
let state: CartState = { items: [], coupon: null, shipping: null };
state = cartReducer(state, { type: "items/add", item: { id: "i_1", qty: 1, price: 10 } });
state = cartReducer(state, { type: "coupon/apply", coupon: { code: "WINTER10", off: 0.1 } });
```

Three properties make this powerful:

1. **Purity.** Same `(state, action)` always produces the same output. Logging, replay, time-travel debugging are free.
2. **Single mutation point.** Only the reducer touches state; all changes are auditable.
3. **Data-only actions.** Persist them, ship them across the wire, replay them. Actions = event log.

## Combining Reducers

For larger state, compose reducers per slice:

```typescript
type AppState = {
  cart: CartState;
  auth: AuthState;
  ui:   UiState;
};

type AppAction = CartAction | AuthAction | UiAction;

function appReducer(state: AppState, action: AppAction): AppState {
  return {
    cart: cartReducer(state.cart, action as CartAction),
    auth: authReducer(state.auth, action as AuthAction),
    ui:   uiReducer(state.ui,   action as UiAction),
  };
}
```

Each slice ignores actions it doesn't recognise. This is how Redux's `combineReducers` works.

## Modern TypeScript Twist

### Action creators via const tuples

```typescript
const CartActions = {
  add:    (item: Item)    => ({ type: "items/add",    item    } as const),
  remove: (id: string)    => ({ type: "items/remove", id      } as const),
  clear:  ()              => ({ type: "items/clear"           } as const),
  apply:  (coupon: Coupon)=> ({ type: "coupon/apply", coupon  } as const),
} satisfies Record<string, (...a: never[]) => { type: string }>;

type CartAction = ReturnType<typeof CartActions[keyof typeof CartActions]>;
```

The action union is derived from the creators — single source of truth.

### Exhaustive matching

```typescript
function assertNever(x: never): never {
  throw new Error(`unhandled action: ${JSON.stringify(x)}`);
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "items/add":     return { ...state, items: [...state.items, action.item] };
    case "items/remove":  return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case "items/clear":   return { ...state, items: [] };
    case "coupon/apply":  return { ...state, coupon: action.coupon };
    case "coupon/clear":  return { ...state, coupon: null };
    case "shipping/set":  return { ...state, shipping: action.address };
    default:              return assertNever(action);
  }
}
```

Adding a new `CartAction` variant turns the reducer into a compile-time error until handled.

### Immer-powered reducers

Spread syntax becomes painful with nested updates. **Immer** lets you write apparently-mutating code that yields immutable results:

```typescript
import { produce } from "immer";

const cartReducer = (state: CartState, action: CartAction): CartState =>
  produce(state, (draft) => {
    switch (action.type) {
      case "items/add":    draft.items.push(action.item); break;
      case "items/remove": draft.items = draft.items.filter(i => i.id !== action.id); break;
      case "items/clear":  draft.items = []; break;
      case "coupon/apply": draft.coupon = action.coupon; break;
      case "coupon/clear": draft.coupon = null; break;
      case "shipping/set": draft.shipping = action.address; break;
    }
  });
```

Redux Toolkit's `createSlice` uses Immer under the hood; you don't even import it.

### With `useReducer` (React)

```typescript
const [cart, dispatch] = useReducer(cartReducer, initial);

return (
  <button onClick={() => dispatch({ type: "items/add", item: someItem })}>
    Add
  </button>
);
```

For complex component state, `useReducer` beats multiple `useState`s once you have more than two related fields. The discriminated-union action gives you ESLint-/TS-checked transitions.

## Side Effects

A reducer must be pure. Side effects (API calls, timers, navigation) live in **middleware** or **effects**:

```typescript
// Redux middleware (sketch)
const logger: Middleware = (store) => (next) => (action) => {
  console.log("→", action);
  const result = next(action);
  console.log("←", store.getState());
  return result;
};

// Thunks: dispatch a function that may dispatch more actions
const placeOrder = (cart: CartState) => async (dispatch: Dispatch) => {
  dispatch({ type: "order/placing" });
  try {
    const id = await api.placeOrder(cart);
    dispatch({ type: "order/placed", id });
  } catch (e) {
    dispatch({ type: "order/failed", error: e });
  }
};
```

In modern Redux Toolkit this is `createAsyncThunk`. In Zustand it's a method on the store. In XState it's an action/service. The point is: **the reducer stays pure**; effects orchestrate dispatches.

## Real-World Applications

### 1. Application state stores

Redux, Zustand, Pinia, ngrx, Effector — all are reducer-based at the core. Even Zustand's "set merge" model is a reducer with implicit action types.

### 2. React component state

```typescript
type Phase = "idle" | "loading" | "error" | "success";
type State = { phase: Phase; data?: User; error?: string };
type Action =
  | { type: "fetch" }
  | { type: "ok"; data: User }
  | { type: "fail"; error: string };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "fetch": return { phase: "loading" };
    case "ok":    return { phase: "success", data: a.data };
    case "fail":  return { phase: "error", error: a.error };
  }
}

function UserCard({ id }: { id: string }) {
  const [s, dispatch] = useReducer(reducer, { phase: "idle" });

  useEffect(() => {
    dispatch({ type: "fetch" });
    api.getUser(id).then(
      (d) => dispatch({ type: "ok", data: d }),
      (e) => dispatch({ type: "fail", error: String(e) }),
    );
  }, [id]);

  /* render based on s.phase */
}
```

### 3. Event-sourced systems

In event sourcing, the system stores actions (events), and state is replayed from them — a long-running reducer over the event log:

```typescript
type DomainEvent = /* … */;

function applyEvent(state: AggregateState, ev: DomainEvent): AggregateState {
  // exactly a reducer
}

function rehydrate(events: DomainEvent[]): AggregateState {
  return events.reduce(applyEvent, initialState);
}
```

This is the deep version of the reducer pattern: actions persist forever, state is just a fold.

### 4. Undo/redo

History is two stacks of actions (or states):

```typescript
const past:   Action[] = [];
const future: Action[] = [];

function dispatch(a: Action) {
  past.push(a);
  future.length = 0;
  state = reducer(state, a);
}

function undo() {
  const last = past.pop(); if (!last) return;
  future.push(last);
  // Replay from the start (cheap if state is small) — or store inverse actions
  state = past.reduce(reducer, initialState);
}
```

## Reducer vs. State Machine

A reducer with a fully enumerated `(state.kind × action.type)` table **is** a state machine. The two patterns are duals:

| Reducer | State Machine |
| --- | --- |
| `(state, action) → state` | `(state, event) → state` |
| Action types are open | Event types are part of the chart |
| Transitions implicit in switch | Transitions explicit in the chart |
| No notion of "invalid in this state" | Events are simply ignored in inapplicable states |

For non-trivial machines (auth, checkout, drag-and-drop), **XState** turns the chart into a typed reducer with visualisation, history, and parallel states.

## When to Use

**Use a reducer when:**

- State changes follow a finite set of named operations.
- You want a single auditable point of mutation.
- You need undo/redo, replay, time travel, or persistence of actions.
- Multiple components or services dispatch into the same state.
- The component would otherwise have 4+ related `useState`s.

**Don't use a reducer when:**

- The state is one value with one setter — `useState` is enough.
- Every action is unique and one-shot — the reducer becomes a switch that calls 20 distinct functions. Use plain functions.
- The state model is genuinely tree-shaped with fine-grained dependencies — consider **signals**.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Reducer does side effects | Move them to middleware/thunks; keep reducer pure |
| Reducer mutates state | Use spread / Immer; freeze state with `Object.freeze` in dev |
| Action type strings collide across slices | Namespace with prefixes (`cart/add`, `auth/login`) |
| Reducer doubles as validation | Validate at the dispatch boundary or in the action creator; reducer assumes validity |
| Massive switch with shared logic | Extract pure helpers (`addItem(state)`) and call them from cases |
| State grows to one global blob | Slice by domain; combine; co-locate slice + actions + selectors |

## Reducer + Selectors

Reading from state goes through **selectors** — pure functions of state to derived values:

```typescript
const selectItemCount = (s: CartState) => s.items.length;
const selectSubtotal  = (s: CartState) => s.items.reduce((sum, i) => sum + i.price * i.qty, 0);
const selectTotal     = (s: CartState) => {
  const sub = selectSubtotal(s);
  const off = s.coupon?.off ?? 0;
  return sub * (1 - off);
};
```

Memoise the expensive ones (Reselect, `useMemo`, signals-as-computeds). This keeps derivations out of the reducer and out of the view.

## Related Patterns

- **State** — Reducer is the functional realisation of State.
- **Command** — Each action is a command (request encoded as data).
- **Memento** — Storing state snapshots after each reducer call gives you undo.
- **Discriminated Union State** — Often used for `state` in `(state, action) → state`.
- **Event Sourcing** — Reducer over a persistent event log.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("cartReducer", () => {
  const empty: CartState = { items: [], coupon: null, shipping: null };

  it("adds an item", () => {
    const next = cartReducer(empty, { type: "items/add", item: { id: "1", price: 5, qty: 1 } });
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).toBe("1");
  });

  it("ignores remove for missing item", () => {
    const next = cartReducer(empty, { type: "items/remove", id: "missing" });
    expect(next).toEqual(empty);
  });

  it("composes through a sequence", () => {
    const actions: CartAction[] = [
      { type: "items/add", item: { id: "1", price: 5, qty: 1 } },
      { type: "items/add", item: { id: "2", price: 7, qty: 2 } },
      { type: "items/remove", id: "1" },
    ];
    const final = actions.reduce(cartReducer, empty);
    expect(final.items.map(i => i.id)).toEqual(["2"]);
  });
});
```

Reducers are the easiest things in the world to test: pure functions.

## Summary

> *A reducer is the smallest, most testable, most replayable unit of state evolution.*

If you have state that grows, multiple ways to change it, and a need to reason about *what changed and why*, a reducer is the right shape. Pair it with discriminated-union state for type-checked transitions and middleware/effects for side effects.
