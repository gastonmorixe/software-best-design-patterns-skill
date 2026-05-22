# Prototype Pattern

## Intent

Create new objects by **cloning an existing instance** rather than constructing from scratch. The prototype carries the configuration; the clone inherits it and may diverge.

## The Problem

Constructing an object is expensive or its configuration is encoded in a live instance that's annoying to reproduce:

```typescript
// Heavy: 30 fields, half of which depend on async lookups.
class GameEnemy {
  constructor(
    public x: number,
    public y: number,
    public health: number,
    public ai: AIScript,           // compiled from JSON
    public textures: TextureAtlas, // loaded from disk
    public soundbank: Soundbank,   // loaded from disk
    public loot: LootTable,
    /* … */
  ) {}
}

// Spawning 200 goblins this way reloads textures 200 times.
for (let i = 0; i < 200; i++) {
  enemies.push(
    new GameEnemy(
      randomX(), randomY(), 100,
      await compileAI("goblin.ai"),
      await loadTextures("goblin"),
      await loadSounds("goblin"),
      goblinLoot,
    ),
  );
}
```

## The Solution

Build the heavy instance once. Clone it for each new copy and override only what differs.

```typescript
interface Cloneable<T> {
  clone(): T;
}

class GameEnemy implements Cloneable<GameEnemy> {
  constructor(
    public x: number,
    public y: number,
    public health: number,
    // immutable, shared resources — flyweight-friendly
    public readonly ai: AIScript,
    public readonly textures: TextureAtlas,
    public readonly soundbank: Soundbank,
    public readonly loot: LootTable,
  ) {}

  clone(): GameEnemy {
    // shallow clone: shared resources stay shared,
    // mutable state (x/y/health) is copied so divergence is safe.
    return new GameEnemy(
      this.x,
      this.y,
      this.health,
      this.ai,
      this.textures,
      this.soundbank,
      this.loot,
    );
  }
}

// Build a prototype once.
const goblinPrototype = new GameEnemy(
  0, 0, 100,
  await compileAI("goblin.ai"),
  await loadTextures("goblin"),
  await loadSounds("goblin"),
  goblinLoot,
);

// Spawning is cheap.
for (let i = 0; i < 200; i++) {
  const g = goblinPrototype.clone();
  g.x = randomX();
  g.y = randomY();
  enemies.push(g);
}
```

## Structure

```
        ┌──────────────────────────────┐
        │ Cloneable<T>  (interface)    │
        │                              │
        │ + clone(): T                 │
        └──────────────────────────────┘
                       △
                       │
        ┌──────────────┴───────────────┐
        │ Prototype                    │
        │ - fields…                    │ ── returns a copy
        │ + clone(): Prototype         │    of `this`
        └──────────────────────────────┘
```

## Modern TypeScript Twist

### `structuredClone` for plain data

For pure data objects without methods, prefer the platform primitive:

```typescript
const original = {
  user: { name: "Ada", tags: ["admin"] },
  createdAt: new Date(),
  ids: new Set([1, 2, 3]),
};
const copy = structuredClone(original); // deep, handles Date/Set/Map
```

Limitations: functions, class identity, `Symbol`-keyed props, DOM nodes are not cloned.

### Branded clones for safety

A clone is conceptually a different instance even if its shape is identical. Use branded types to prevent accidental aliasing:

```typescript
type Brand<T, B> = T & { readonly __brand: B };
type Original<T> = Brand<T, "original">;
type Clone<T>    = Brand<T, "clone">;

function clone<T>(o: Original<T>): Clone<T> {
  return structuredClone(o) as Clone<T>;
}
```

### Prototype registry

A registry maps a key → prototype, so client code stays declarative:

```typescript
class EnemyRegistry {
  private readonly prototypes = new Map<string, GameEnemy>();

  register(key: string, proto: GameEnemy): void {
    this.prototypes.set(key, proto);
  }

  spawn(key: string, x: number, y: number): GameEnemy {
    const proto = this.prototypes.get(key);
    if (!proto) throw new Error(`Unknown enemy: ${key}`);
    const e = proto.clone();
    e.x = x;
    e.y = y;
    return e;
  }
}

const registry = new EnemyRegistry();
registry.register("goblin", goblinPrototype);
registry.register("orc",    orcPrototype);

const g = registry.spawn("goblin", 100, 200);
```

## Real-World Applications

### 1. Configuration templates

```typescript
type RequestConfig = {
  baseUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
  retries: number;
};

const defaultConfig: RequestConfig = {
  baseUrl: "https://api.example.com",
  headers: { "Content-Type": "application/json" },
  timeoutMs: 5_000,
  retries: 3,
};

// Each request derives from the prototype.
const authConfig: RequestConfig = {
  ...structuredClone(defaultConfig),
  headers: { ...defaultConfig.headers, Authorization: `Bearer ${token}` },
};

const longTimeoutConfig: RequestConfig = {
  ...structuredClone(defaultConfig),
  timeoutMs: 60_000,
};
```

### 2. Document templates in an editor

```typescript
class Document implements Cloneable<Document> {
  constructor(
    public title: string,
    public sections: Section[],
    public styles: StyleSheet,
  ) {}

  clone(): Document {
    return new Document(
      this.title,
      this.sections.map(s => s.clone()),
      this.styles, // immutable, share
    );
  }
}

const invoiceTemplate = await loadDocument("invoice.template");
const newInvoice = invoiceTemplate.clone();
newInvoice.title = `Invoice #${nextId()}`;
```

### 3. Game state save / load

Cloning a complete world snapshot is conceptually identical to a "save game" — useful for **undo**, **replay**, and **AI rollouts**.

```typescript
const checkpoint = world.clone();
runRiskyAiAction(world);
if (failed) world = checkpoint; // rollback
```

## Shallow vs. Deep Clone

| Aspect | Shallow | Deep |
| --- | --- | --- |
| Nested objects | shared by reference | independent copies |
| Cycles | safe | needs cycle detection (`structuredClone` handles it) |
| Cost | cheap | proportional to size |
| Mutation safety | mutating a nested field affects original | full isolation |

**Rule of thumb:** shallow-clone when nested state is immutable (Flyweight-friendly); deep-clone when callers will mutate.

## When to Use

**Use Prototype when:**

- Construction is expensive (I/O, parsing, compilation) but copying is cheap.
- A "template" instance encodes valuable configuration.
- You need many similar objects that differ only in a few fields.
- You want save/restore semantics (snapshot, undo, rollback).

**Don't use Prototype when:**

- Objects are cheap to construct — `new X()` is clearer.
- Objects have unique identity (database rows with primary keys) — cloning is semantically wrong.
- Deep copying live resources (open file handles, sockets) — clones share or break the handle.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Aliasing bugs from shallow clones | Document what's shared; freeze the shared parts |
| Losing class identity (`structuredClone` drops methods) | Implement `clone()` yourself, or use a clone library |
| Cloning DB-tracked entities creates duplicate identity | Reset `id` after cloning; or use a Builder instead |
| Cyclic references break naive recursive clones | Use `structuredClone`, or detect with a `WeakMap` |

## Related Patterns

- **Factory Method** — Prototype is an alternative when the factory just clones a template.
- **Builder** — Builder constructs step-by-step; Prototype copies a finished product.
- **Flyweight** — Often combined: clones share heavy intrinsic state and diverge only on extrinsic state.
- **Memento** — A memento is essentially a deep clone of state for restoration.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("GameEnemy.clone", () => {
  it("produces an independent mutable instance", () => {
    const proto = new GameEnemy(0, 0, 100, ai, tex, snd, loot);
    const a = proto.clone();
    a.x = 10;
    expect(proto.x).toBe(0); // proto untouched
  });

  it("shares immutable resources", () => {
    const proto = new GameEnemy(0, 0, 100, ai, tex, snd, loot);
    const a = proto.clone();
    expect(a.textures).toBe(proto.textures); // same reference (cheap)
  });
});
```
