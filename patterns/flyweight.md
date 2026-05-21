# Flyweight Pattern

## Intent

Share a small number of **intrinsic** (immutable, context-free) objects across many contexts to reduce memory. The variable, context-specific **extrinsic** state is passed in at use time.

## The Problem

You need to represent millions of small objects whose state is mostly identical:

```typescript
// Naive: every character on a page is its own object with its own font metrics.
class Glyph {
  constructor(
    readonly char: string,
    readonly font: string,
    readonly size: number,
    readonly weight: number,
    readonly metrics: GlyphMetrics, // 200 bytes of kerning, ascent, descent, …
    public x: number,
    public y: number,
  ) {}
}

// A 100-page novel might allocate 250 000 Glyphs.
// 250 000 × ~300 bytes = ~75 MB. Most of it identical metrics for "a", "b", "c"…
```

## The Solution

Split state into two:

| | Intrinsic | Extrinsic |
| --- | --- | --- |
| Stored where | Inside the flyweight | Passed in by the client per call |
| Mutability | Immutable | Mutable per use |
| Example | char, font, size, weight, metrics | position (x, y) on the page |

```typescript
// ── Intrinsic state — shared ──────────────────────────────
class GlyphStyle {
  constructor(
    readonly char: string,
    readonly font: string,
    readonly size: number,
    readonly weight: number,
    readonly metrics: GlyphMetrics,
  ) {}

  render(gfx: GraphicsContext, x: number, y: number): void {
    gfx.drawGlyph(this.char, this.font, this.size, this.weight, x, y);
  }
}

// ── Factory ensures sharing ───────────────────────────────
class GlyphStyleFactory {
  private readonly cache = new Map<string, GlyphStyle>();

  get(char: string, font: string, size: number, weight: number): GlyphStyle {
    const key = `${char}|${font}|${size}|${weight}`;
    let style = this.cache.get(key);
    if (!style) {
      style = new GlyphStyle(char, font, size, weight, loadMetrics(char, font));
      this.cache.set(key, style);
    }
    return style;
  }

  get size() { return this.cache.size; }
}

// ── Extrinsic state — owned by the context ────────────────
type PlacedGlyph = {
  style: GlyphStyle; // shared
  x: number;         // per-instance
  y: number;
};

// ── Client ────────────────────────────────────────────────
const factory = new GlyphStyleFactory();
const page: PlacedGlyph[] = [];

for (const { char, x, y } of layout(text)) {
  page.push({
    style: factory.get(char, "Helvetica", 12, 400),
    x, y,
  });
}

// 250 000 PlacedGlyphs share ~50 unique GlyphStyles. Memory: ~5 MB instead of 75 MB.
for (const g of page) g.style.render(gfx, g.x, g.y);
```

## Structure

```
                                   ┌─────────────────────────┐
   ┌──────────────────────────┐    │ FlyweightFactory        │
   │ Client                   │───▶│ - cache: Map<key, Fly>  │
   │ + extrinsicState[]       │    │ + get(key): Flyweight   │
   └────────────┬─────────────┘    └─────────────┬───────────┘
                │                                │
                │ uses (with extrinsic state)    │ creates/shares
                ▼                                ▼
       ┌───────────────────┐           ┌─────────────────────┐
       │  Flyweight        │           │ ConcreteFlyweight   │
       │  + op(extrinsic)  │           │ - intrinsicState    │
       └───────────────────┘           └─────────────────────┘
```

## Modern TypeScript Twist

### Frozen literal flyweights

For closed sets, skip the factory and use a `Map` over frozen literals:

```typescript
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_META = {
  trace: { rank: 0, color: "#888" },
  debug: { rank: 1, color: "#4af" },
  info:  { rank: 2, color: "#0a0" },
  warn:  { rank: 3, color: "#fa0" },
  error: { rank: 4, color: "#f44" },
  fatal: { rank: 5, color: "#f0f" },
} as const satisfies Record<LogLevel, { rank: number; color: string }>;

Object.values(LEVEL_META).forEach(Object.freeze);
Object.freeze(LEVEL_META);

// Every "info" log shares the same {rank: 2, color: "#0a0"} object.
function shouldLog(line: LogLine, threshold: LogLevel): boolean {
  return LEVEL_META[line.level].rank >= LEVEL_META[threshold].rank;
}
```

### WeakRef for memory-conscious caches

Pure flyweights live forever. If your "intrinsic" state is heavy enough that you want it GC'd when nobody holds it, use `WeakRef`:

```typescript
class TextureFactory {
  private readonly cache = new Map<string, WeakRef<Texture>>();
  private readonly registry = new FinalizationRegistry<string>((key) => {
    this.cache.delete(key);
  });

  get(path: string): Texture {
    const ref = this.cache.get(path);
    const cached = ref?.deref();
    if (cached) return cached;

    const tex = loadTexture(path);
    this.cache.set(path, new WeakRef(tex));
    this.registry.register(tex, path);
    return tex;
  }
}
```

When nothing references a particular `Texture`, the GC reclaims it and the finalisation registry trims the map.

### Interning via `Symbol.for`

Strings/objects keyed by a global identifier can be interned with the runtime's symbol registry:

```typescript
const REQUEST_ID = Symbol.for("@app/requestId");
// Anywhere in the process, Symbol.for("@app/requestId") returns the same symbol.
```

## Real-World Applications

### 1. Glyphs in a text editor

Already shown above. This is the canonical use case from the GoF book.

### 2. Tile maps in games

```typescript
type TileType = "grass" | "stone" | "water" | "forest" | "lava";

interface TileSprite {
  readonly texture: Texture;
  readonly walkable: boolean;
  readonly damagePerSec: number;
  draw(ctx: GraphicsContext, x: number, y: number): void;
}

class TileSpriteFlyweight implements TileSprite {
  constructor(
    readonly texture: Texture,
    readonly walkable: boolean,
    readonly damagePerSec: number,
  ) {}
  draw(ctx: GraphicsContext, x: number, y: number) {
    ctx.drawTexture(this.texture, x, y);
  }
}

class TileSpriteFactory {
  private readonly cache = new Map<TileType, TileSprite>();
  get(type: TileType): TileSprite {
    return (
      this.cache.get(type) ??
      this.cache.set(type, this.create(type)).get(type)!
    );
  }
  private create(t: TileType): TileSprite { /* … */ }
}

// A 1000×1000 tile map = 1 000 000 cells.
// Cells store {type, x, y, occupants[]} (extrinsic).
// The 5 TileSprite instances are shared (intrinsic).
```

### 3. String interning

```typescript
// V8/JSC already intern short strings. For larger app strings:
class StringPool {
  private readonly pool = new Map<string, string>();
  intern(s: string): string {
    let existing = this.pool.get(s);
    if (!existing) { this.pool.set(s, s); existing = s; }
    return existing;
  }
}

// Useful when parsing 10 million lines, each containing the same 50 column names.
```

### 4. Event-type registry

```typescript
const EVENT_TYPES = {
  USER_CREATED:    { id: 1, schema: userCreatedSchema },
  USER_UPDATED:    { id: 2, schema: userUpdatedSchema },
  ORDER_PLACED:    { id: 3, schema: orderPlacedSchema },
  /* … */
} as const;

// Every event carries `type: keyof typeof EVENT_TYPES` and shares the metadata.
```

## When to Use

**Use Flyweight when:**

- You'll create a very large number of similar objects.
- Most of their state is **identical** across instances.
- The extrinsic (variable) state is small and easy to pass.
- Memory pressure is a real, measurable problem (don't speculate).

**Don't use Flyweight when:**

- Object counts are modest (< 10 000) — cost of indirection > savings.
- The intrinsic state is small (already cheap).
- The "shared" state is actually mutable per context — that's not intrinsic.
- You're optimising prematurely. Profile first.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Mutating intrinsic state corrupts every sharer | `readonly` properties, `Object.freeze`, or branded `Immutable<T>` |
| Cache leaks memory forever | Use `WeakRef` / `FinalizationRegistry`, or bound size with LRU |
| Identity confusion: `a === b` is now true unexpectedly | Make sharing explicit in the type (`SharedFontStyle` vs `OwnedFontStyle`) |
| Threading: shared state with mutation in workers | Either make it truly immutable or use `SharedArrayBuffer` + atomics |

## Flyweight vs. Singleton

| Aspect | Flyweight | Singleton |
| --- | --- | --- |
| Number of instances | Many (one per intrinsic key) | Exactly one |
| Lookup key | Intrinsic state | None |
| Purpose | Memory savings via sharing | Global access point |

Flyweight is "Singleton **per key**".

## Related Patterns

- **Factory** — Flyweight always needs a factory to enforce sharing.
- **Prototype** — Clones often pair with flyweights: each clone has its own extrinsic state but points at the same intrinsic prototype.
- **Composite** — Composite trees often store flyweight leaves.
- **State** — State objects are frequently implemented as flyweights since each state is stateless itself.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("GlyphStyleFactory", () => {
  it("returns the same instance for identical intrinsic state", () => {
    const f = new GlyphStyleFactory();
    const a = f.get("a", "Helvetica", 12, 400);
    const b = f.get("a", "Helvetica", 12, 400);
    expect(a).toBe(b);
  });

  it("produces distinct instances for different intrinsic state", () => {
    const f = new GlyphStyleFactory();
    const a = f.get("a", "Helvetica", 12, 400);
    const b = f.get("a", "Helvetica", 14, 400);
    expect(a).not.toBe(b);
  });

  it("does not grow the cache for repeated requests", () => {
    const f = new GlyphStyleFactory();
    for (let i = 0; i < 1000; i++) f.get("a", "Helvetica", 12, 400);
    expect(f.size).toBe(1);
  });
});
```
