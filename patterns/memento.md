# Memento Pattern

## Intent

Capture an object's internal state so it can be **restored later**, without violating encapsulation. The originator produces and consumes mementos; a caretaker holds them but never inspects them.

## The Problem

You need undo/redo, snapshots, or transactional rollback, but exposing every field via getters/setters defeats encapsulation:

```typescript
class TextEditor {
  text = "";
  selectionStart = 0;
  selectionEnd = 0;
  // 30 more fields…

  // Saving state requires reading every field externally.
  // Restoring requires writing them all back.
}

// Caller has to know every field — and updates here break the editor.
const snapshot = {
  text: editor.text,
  selectionStart: editor.selectionStart,
  selectionEnd: editor.selectionEnd,
  /* 30 more… */
};
```

Add a field to `TextEditor` and every snapshot/restore call site breaks.

## The Solution

Three roles:

| Role | Responsibility |
| --- | --- |
| **Originator** | Produces a memento of its state; restores from one. |
| **Memento** | Opaque snapshot. Only the originator can read it. |
| **Caretaker** | Holds mementos. Treats them as a black box. |

```typescript
// ── Memento: opaque snapshot ──────────────────────────────
class EditorMemento {
  // Package-private feel via #private: only EditorMemento itself can read.
  // Tests can still call originator.restore(memento) to verify behavior.
  #text: string;
  #selectionStart: number;
  #selectionEnd: number;
  readonly capturedAt: Date;

  constructor(text: string, start: number, end: number) {
    this.#text = text;
    this.#selectionStart = start;
    this.#selectionEnd = end;
    this.capturedAt = new Date();
  }

  // Friend-style access: only TextEditor calls these.
  _text(): string         { return this.#text; }
  _selStart(): number     { return this.#selectionStart; }
  _selEnd(): number       { return this.#selectionEnd; }
}

// ── Originator ────────────────────────────────────────────
class TextEditor {
  #text = "";
  #selectionStart = 0;
  #selectionEnd = 0;

  type(s: string): void {
    const before = this.#text.slice(0, this.#selectionStart);
    const after  = this.#text.slice(this.#selectionEnd);
    this.#text = before + s + after;
    this.#selectionStart = this.#selectionEnd = before.length + s.length;
  }

  select(start: number, end: number): void {
    this.#selectionStart = start;
    this.#selectionEnd = end;
  }

  // Save: opaque to caller
  save(): EditorMemento {
    return new EditorMemento(this.#text, this.#selectionStart, this.#selectionEnd);
  }

  // Restore: only the originator unpacks the memento
  restore(m: EditorMemento): void {
    this.#text = m._text();
    this.#selectionStart = m._selStart();
    this.#selectionEnd = m._selEnd();
  }

  get text(): string { return this.#text; }
}

// ── Caretaker ─────────────────────────────────────────────
class History {
  private readonly stack: EditorMemento[] = [];
  private readonly redo: EditorMemento[] = [];

  push(m: EditorMemento): void {
    this.stack.push(m);
    this.redo.length = 0; // new edit invalidates redo
  }

  undo(): EditorMemento | undefined {
    const top = this.stack.pop();
    if (top) this.redo.push(top);
    return this.stack.at(-1);
  }

  redoNext(): EditorMemento | undefined {
    const m = this.redo.pop();
    if (m) this.stack.push(m);
    return m;
  }
}

// ── Wiring ────────────────────────────────────────────────
const editor = new TextEditor();
const history = new History();
history.push(editor.save()); // initial empty state

editor.type("Hello");        history.push(editor.save());
editor.type(", world");      history.push(editor.save());

// Undo
const prev = history.undo();
if (prev) editor.restore(prev);
console.log(editor.text); // "Hello"
```

The caretaker (`History`) never touches the memento internals. Adding a field to `TextEditor` only changes `EditorMemento` and `save()`/`restore()`; the caretaker is untouched.

## Structure

```
┌──────────────────┐             ┌────────────────────┐          ┌─────────────┐
│ Originator       │ save()      │ Memento            │          │ Caretaker   │
│                  │ ──────────▶ │ (opaque)           │   holds  │             │
│                  │             │                    │ ◀────────│             │
│ - state          │ ◀────────── │ - state'           │          │ - stack[]   │
│                  │  restore(m) │                    │          │             │
└──────────────────┘             └────────────────────┘          └─────────────┘
```

## Modern TypeScript Twist

### Immutable state + structural cloning

For plain data, the entire pattern collapses into one line: the state itself is immutable, and the memento is just that value.

```typescript
type EditorState = {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

class TextEditor {
  // single source of truth; everything is derived
  private state: EditorState = { text: "", selectionStart: 0, selectionEnd: 0 };

  type(s: string): void {
    const { text, selectionStart, selectionEnd } = this.state;
    const next = text.slice(0, selectionStart) + s + text.slice(selectionEnd);
    const cursor = selectionStart + s.length;
    this.state = { text: next, selectionStart: cursor, selectionEnd: cursor };
  }

  snapshot(): EditorState { return this.state; }            // already frozen-shape
  restore(s: EditorState): void { this.state = s; }
}
```

This is the React/Redux/Zustand model. The "memento" is just the state value; history is a list of states.

### Branded snapshots

If you want to be strict that snapshots can't be hand-crafted by callers:

```typescript
type Brand<T, B> = T & { readonly __brand: B };
type Snapshot<T> = Brand<T, "snapshot">;

class TextEditor {
  private state: EditorState = { /* … */ };

  snapshot(): Snapshot<EditorState> {
    return structuredClone(this.state) as Snapshot<EditorState>;
  }

  restore(s: Snapshot<EditorState>): void {
    this.state = s;
  }
}
```

Callers can't pass arbitrary objects to `restore` — only values produced by `snapshot()`.

### Persistent data structures

For large state, full copies are wasteful. Libraries like **Immer** (writes a draft, produces a frozen patch) and **immutable.js** (structural sharing) make snapshots O(log n) instead of O(n).

```typescript
import { produce } from "immer";

class Editor {
  private state: EditorState = initialState;

  edit(fn: (draft: EditorState) => void): void {
    this.state = produce(this.state, fn);
  }

  snapshot(): EditorState { return this.state; }
  restore(s: EditorState): void { this.state = s; }
}
```

## Real-World Applications

### 1. Undo / redo

Already covered above. Stack of mementos; undo pops, redo replays.

### 2. Transactional rollback

```typescript
class Aggregate {
  private state: State = initial;

  /** Tries to mutate; rolls back if `op` throws. */
  transact(op: (s: State) => State): void {
    const memento = this.state; // immutable, so this IS the snapshot
    try {
      this.state = op(this.state);
    } catch (e) {
      this.state = memento;     // rollback
      throw e;
    }
  }
}
```

### 3. Time-travel debugging

Redux DevTools, Replay.io, and similar tools work by capturing a memento per action. Replay restores them in order to step through history.

### 4. Game save/load

`save()` serializes the entire world state; `restore()` reinstates it. Save files are exactly mementos that happen to live on disk.

```typescript
class GameWorld {
  snapshot(): WorldState { return structuredClone(this.state); }
  restore(s: WorldState): void { this.state = s; }

  async saveToDisk(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.snapshot()));
  }
  async loadFromDisk(path: string): Promise<void> {
    this.restore(JSON.parse(await readFile(path, "utf8")));
  }
}
```

## When to Use

**Use Memento when:**

- You need undo/redo or transactional rollback.
- You want save/load semantics.
- The originator's state is non-trivial and you want to preserve encapsulation.
- You're building time-travel debugging or replay.

**Don't use Memento when:**

- The state is small and already public (just copy it).
- Snapshots are huge and frequent — consider event sourcing (store **changes**, not states).
- You can re-derive state cheaply from inputs.

## Memento vs. Event Sourcing

| | Memento | Event Sourcing |
| --- | --- | --- |
| What's stored | Full snapshots | Sequence of state changes (events) |
| Storage cost | O(state × snapshots) | O(events) — usually smaller |
| Reconstruction | Replace state directly | Replay events from a base |
| Audit trail | No (just states) | Yes (every change is recorded) |
| Best for | Local undo/redo, save games | Event-driven systems, audit-heavy domains |

Often combined: take a memento every N events as a "checkpoint", replay events forward from there.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Memento exposes internals via public getters | Use `#private` fields; expose only `restore()` on the originator |
| Memento accumulates unbounded memory | Cap history depth, or compress old mementos, or move to event sourcing |
| Restoring a stale memento corrupts shared references | Deep-clone or use immutable data |
| Storing live references (sockets, file handles) in a memento | Mementos hold **data**, not resources. Reconstruct resources on restore |

## Related Patterns

- **Command** — Commands often capture their inverse via a memento; together they implement undo.
- **Iterator** — Walks of mementos give you replay/time-travel.
- **Prototype** — A prototype is conceptually a "fresh memento" reused for each new instance.
- **Snapshot Isolation** — DB-level equivalent: every transaction sees a memento of the data.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("TextEditor + History", () => {
  it("undoes the last edit", () => {
    const e = new TextEditor();
    const h = new History();
    h.push(e.save());

    e.type("Hello");
    h.push(e.save());

    const prev = h.undo();
    expect(prev).toBeDefined();
    e.restore(prev!);
    expect(e.text).toBe("");
  });

  it("redo restores undone edit", () => {
    const e = new TextEditor();
    const h = new History();
    h.push(e.save());
    e.type("Hi");
    h.push(e.save());

    e.restore(h.undo()!);
    expect(e.text).toBe("");

    const redo = h.redoNext();
    e.restore(redo!);
    expect(e.text).toBe("Hi");
  });
});
```
