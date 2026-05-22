# Visitor Pattern

## Intent

Add new **operations** to a stable object structure without modifying the objects themselves. Operations live in visitor classes; each element accepts a visitor and dispatches to the right method.

## The Problem

You have a stable hierarchy (an AST, a document model, a Composite tree) and you keep wanting to add operations across it: pretty-print, type-check, lint, evaluate, serialise. Putting every operation as a method on every node:

```typescript
abstract class Node {
  abstract prettyPrint(): string;
  abstract evaluate(env: Env): unknown;
  abstract typeCheck(ctx: TypeCtx): Type;
  abstract toJson(): unknown;
  abstract serializeToBinary(): Buffer;
  // …add more, edit every subclass
}

class NumberLit extends Node { /* implements all 5 */ }
class BinaryOp  extends Node { /* implements all 5 */ }
class Variable  extends Node { /* implements all 5 */ }
// 30 more node types
```

**Problems:**

- Adding a new operation (e.g., `optimize`) means editing every node class.
- Operations cluster — type-check needs cross-node logic that ends up scattered.
- Coupling: a lint check shouldn't be in `NumberLit`.

In a language with **closed** node hierarchies (you control all of them, they rarely change) and **open** operation sets (constantly adding new analyses), Visitor inverts the dependency.

## The Solution

Move each operation into its own visitor class. Nodes have one method, `accept(visitor)`, that dispatches to the correct `visit…` method (double dispatch).

```typescript
// ── Element hierarchy (stable) ────────────────────────────
interface ExprVisitor<R> {
  visitNumber(n: NumberLit): R;
  visitBinaryOp(b: BinaryOp): R;
  visitVariable(v: Variable): R;
}

abstract class Expr {
  abstract accept<R>(v: ExprVisitor<R>): R;
}

class NumberLit extends Expr {
  constructor(readonly value: number) { super(); }
  accept<R>(v: ExprVisitor<R>): R { return v.visitNumber(this); }
}

class BinaryOp extends Expr {
  constructor(readonly op: "+" | "-" | "*" | "/", readonly left: Expr, readonly right: Expr) {
    super();
  }
  accept<R>(v: ExprVisitor<R>): R { return v.visitBinaryOp(this); }
}

class Variable extends Expr {
  constructor(readonly name: string) { super(); }
  accept<R>(v: ExprVisitor<R>): R { return v.visitVariable(this); }
}

// ── Visitor: evaluate ─────────────────────────────────────
class Evaluator implements ExprVisitor<number> {
  constructor(private readonly env: Map<string, number>) {}

  visitNumber(n: NumberLit): number { return n.value; }

  visitVariable(v: Variable): number {
    const x = this.env.get(v.name);
    if (x === undefined) throw new Error(`undefined: ${v.name}`);
    return x;
  }

  visitBinaryOp(b: BinaryOp): number {
    const l = b.left.accept(this);
    const r = b.right.accept(this);
    switch (b.op) {
      case "+": return l + r;
      case "-": return l - r;
      case "*": return l * r;
      case "/": return l / r;
    }
  }
}

// ── Visitor: pretty-print ─────────────────────────────────
class PrettyPrinter implements ExprVisitor<string> {
  visitNumber(n: NumberLit): string { return String(n.value); }
  visitVariable(v: Variable): string { return v.name; }
  visitBinaryOp(b: BinaryOp): string {
    return `(${b.left.accept(this)} ${b.op} ${b.right.accept(this)})`;
  }
}

// ── Use ───────────────────────────────────────────────────
// (1 + x) * 2
const ast: Expr = new BinaryOp(
  "*",
  new BinaryOp("+", new NumberLit(1), new Variable("x")),
  new NumberLit(2),
);

console.log(ast.accept(new PrettyPrinter()));       // "((1 + x) * 2)"
console.log(ast.accept(new Evaluator(new Map([["x", 5]])))); // 12
```

To add `Optimizer` or `TypeChecker`, write a new class. No node touches.

## Structure

```
┌────────────────────────┐                           ┌───────────────────────────┐
│ Element                │    accept(v)              │ Visitor<R>                │
│                        │──────────────────────────▶│                           │
│ + accept(v)            │                           │ + visitA(a: ElementA): R  │
└────────────────────────┘                           │ + visitB(b: ElementB): R  │
             △                                       │ + visitC(c: ElementC): R  │
             │                                       └───────────────────────────┘
┌────────────┴───────────┐                                         △
│ ElementA               │  v.visitA(this)                         │
│ ElementB               │  ───────────────────────▶ ┌─────────────┴─────────────┐
│ ElementC               │                           │ Concrete Visitors         │
└────────────────────────┘                           │                           │
                                                     │ Eval, Print,              │
                                                     │ TypeCheck, …              │
                                                     └───────────────────────────┘
```

## Modern TypeScript Twist

### Discriminated unions + exhaustive `switch` (the usual replacement)

In TypeScript, you almost never need classical Visitor: discriminated unions plus an exhaustive `switch` give you the same shape with **far** less ceremony.

```typescript
type Expr =
  | { kind: "number";   value: number }
  | { kind: "variable"; name: string }
  | { kind: "binary";   op: "+" | "-" | "*" | "/"; left: Expr; right: Expr };

function evaluate(e: Expr, env: Map<string, number>): number {
  switch (e.kind) {
    case "number":   return e.value;
    case "variable": {
      const v = env.get(e.name);
      if (v === undefined) throw new Error(`undefined: ${e.name}`);
      return v;
    }
    case "binary": {
      const l = evaluate(e.left, env);
      const r = evaluate(e.right, env);
      switch (e.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return l / r;
      }
    }
  }
}

function prettyPrint(e: Expr): string {
  switch (e.kind) {
    case "number":   return String(e.value);
    case "variable": return e.name;
    case "binary":   return `(${prettyPrint(e.left)} ${e.op} ${prettyPrint(e.right)})`;
  }
}
```

The compiler enforces exhaustiveness: if you add `{ kind: "call"; … }` to the union, every `switch` not handling it becomes a type error. That's better than the OO Visitor, which only warns at runtime when you forget to update a visitor.

Use **classical Visitor** only when:

- You can't change the existing class hierarchy (it's in a library you don't own).
- You need polymorphic dispatch on a runtime value whose type is opaque.
- You're integrating with code that already expects `accept(visitor)`.

### Exhaustive helper

For safety, write the union case once with an `assertNever`:

```typescript
function assertNever(x: never): never {
  throw new Error(`Non-exhaustive switch, got: ${JSON.stringify(x)}`);
}

function evaluate(e: Expr, env: Map<string, number>): number {
  switch (e.kind) {
    case "number":   return e.value;
    case "variable": return env.get(e.name) ?? throwUndef(e.name);
    case "binary":   return binOp(e.op, evaluate(e.left, env), evaluate(e.right, env));
    default:         return assertNever(e);
  }
}
```

### Generic AST walkers

For utility code that doesn't care about every node, use a generic walker rather than a Visitor with N stub methods:

```typescript
function walk(e: Expr, fn: (node: Expr) => void): void {
  fn(e);
  if (e.kind === "binary") { walk(e.left, fn); walk(e.right, fn); }
}

// "Find all variable references":
const refs: string[] = [];
walk(ast, (n) => { if (n.kind === "variable") refs.push(n.name); });
```

## Real-World Applications

### 1. Compilers / Linters

Babel, TypeScript, ESLint all use visitor-shaped APIs over their ASTs. The actual implementation may be a switch on `node.type`, but the model is identical.

```typescript
// ESLint rule (sketch)
export default {
  create(context: RuleContext) {
    return {
      // visit methods, keyed by node type
      VariableDeclaration(node) {
        if (node.kind === "var") context.report({ node, message: "no var" });
      },
      ArrowFunctionExpression(node) { /* … */ },
    };
  },
};
```

### 2. Document tree pipelines

A unified.js / Remark-style transformer is a Visitor with hooks per node type.

```typescript
type MdNode =
  | { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: MdNode[] }
  | { type: "paragraph"; children: MdNode[] }
  | { type: "text"; value: string }
  | { type: "link"; url: string; children: MdNode[] };

function transform(node: MdNode, visitor: Partial<Record<MdNode["type"], (n: MdNode) => MdNode>>): MdNode {
  const fn = visitor[node.type];
  const next = fn ? fn(node) : node;
  if ("children" in next) {
    return { ...next, children: next.children.map((c) => transform(c, visitor)) } as MdNode;
  }
  return next;
}
```

### 3. Composite tree operations

Visiting a `FileSystemNode` Composite to compute sizes, render trees, or find files all map naturally.

### 4. Query / report generators

For an `Expr` tree, separate visitors produce SQL, MongoDB queries, Elasticsearch queries — same AST, multiple back-ends.

## When to Use

**Use Visitor when:**

- The object structure is **closed** (rarely changes) but operations are **open** (frequently added).
- An operation needs access to multiple node types and would otherwise be scattered.
- You can't (or shouldn't) modify the element classes (third-party hierarchies).
- You want each operation grouped into one file/class for cohesion.

**Don't use Visitor when:**

- The hierarchy keeps growing — every new node forces every visitor to add a method.
- You're in TypeScript with a closed union — use a `switch` over discriminants instead.
- The "visitor" only handles one node type — that's a method, not a pattern.

## Trade-offs

| Pro | Con |
| --- | --- |
| Add operations without touching elements | Add elements forces touching every visitor |
| Cohesive: one operation, one file | Double dispatch is verbose |
| Visitor can carry state across nodes | Encapsulation of element internals weakens (visitor must read them) |

The trade-off is symmetric: Visitor is great when the *element set* is stable. If it isn't, you'll regret choosing it.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Adding a node breaks every visitor at runtime | Make `Visitor<R>` an interface, not a base class; TS surfaces the missing methods at compile time. |
| Visitor and element both depend on each other | They mutually depend by design. Put the visitor interface in the same module as the element. |
| Need to short-circuit traversal | Have visit methods return a sentinel, or throw a tagged exception caught at the top. |

## Related Patterns

- **Composite** — Visitor's primary use case is walking Composites.
- **Iterator** — Iterator delivers nodes; Visitor processes them.
- **Strategy** — A Visitor is a Strategy whose operation depends on the receiver type (double dispatch).
- **Discriminated Unions** — TypeScript-native alternative; almost always preferable.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("Evaluator", () => {
  it("evaluates a constant", () => {
    expect(new NumberLit(42).accept(new Evaluator(new Map()))).toBe(42);
  });

  it("evaluates a tree", () => {
    const ast = new BinaryOp("+", new NumberLit(1), new Variable("x"));
    expect(ast.accept(new Evaluator(new Map([["x", 41]])))).toBe(42);
  });
});

describe("PrettyPrinter", () => {
  it("round-trips through Evaluator", () => {
    const ast = new BinaryOp("*", new NumberLit(6), new NumberLit(7));
    expect(ast.accept(new PrettyPrinter())).toBe("(6 * 7)");
    expect(ast.accept(new Evaluator(new Map()))).toBe(42);
  });
});
```
