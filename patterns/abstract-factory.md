# Abstract Factory Pattern

## Intent

Provide an interface for creating **families of related or dependent objects** without specifying their concrete classes. The client picks a factory once; everything it produces is guaranteed to be compatible.

## The Problem

You have several "themes" of related objects that must be used together. Mix-and-match would break invariants.

```typescript
// SQL driver + SQL query builder must match.
// Mixing PostgresDriver with MySqlQueryBuilder produces invalid SQL.
const driver = new PostgresDriver(connString);
const builder = new MySqlQueryBuilder();          // ❌ silently incompatible
const result = await driver.exec(builder.select("users").build());
```

A normal Factory Method picks **one** product. Abstract Factory picks a **family**.

## The Solution

Define an interface whose methods each produce one member of a family. Each concrete factory implements it for one variant; clients hold the factory and never name a concrete product.

```typescript
// ── Product interfaces ───────────────────────────────────────────
interface Driver {
  exec(sql: string, params: unknown[]): Promise<QueryResult>;
}

interface QueryBuilder {
  select(table: string): this;
  where(clause: string): this;
  build(): { sql: string; params: unknown[] };
}

interface Migrator {
  apply(version: string): Promise<void>;
}

// ── Abstract factory ─────────────────────────────────────────────
interface DbFactory {
  readonly dialect: "postgres" | "mysql" | "sqlite";
  driver(): Driver;
  queryBuilder(): QueryBuilder;
  migrator(): Migrator;
}

// ── Concrete factory: Postgres family ────────────────────────────
class PostgresFactory implements DbFactory {
  readonly dialect = "postgres" as const;
  constructor(private readonly conn: string) {}
  driver(): Driver { return new PostgresDriver(this.conn); }
  queryBuilder(): QueryBuilder { return new PostgresQueryBuilder(); }
  migrator(): Migrator { return new PostgresMigrator(this.driver()); }
}

// ── Concrete factory: MySQL family ───────────────────────────────
class MySqlFactory implements DbFactory {
  readonly dialect = "mysql" as const;
  constructor(private readonly conn: string) {}
  driver(): Driver { return new MySqlDriver(this.conn); }
  queryBuilder(): QueryBuilder { return new MySqlQueryBuilder(); }
  migrator(): Migrator { return new MySqlMigrator(this.driver()); }
}

// ── Client never names concrete products ─────────────────────────
class UserRepository {
  constructor(private readonly db: DbFactory) {}

  async findActive(): Promise<User[]> {
    const q = this.db
      .queryBuilder()
      .select("users")
      .where("status = 'active'")
      .build();
    const { rows } = await this.db.driver().exec(q.sql, q.params);
    return rows as User[];
  }
}

// Pick the family once, at composition root.
const db: DbFactory =
  process.env.DB === "mysql"
    ? new MySqlFactory(process.env.DSN!)
    : new PostgresFactory(process.env.DSN!);

const repo = new UserRepository(db);
```

## Structure

```
                      ┌────────────────────────────────────┐
                      │ DbFactory  (interface)             │
                      │ + driver()       : Driver          │
                      │ + queryBuilder() : QueryBuilder    │
                      │ + migrator()     : Migrator        │
                      └────────────────────────────────────┘
                                         △
                                         │
            ┌────────────────────────────┴───────────────────────────┐
            │                                                        │
┌───────────┴───────────┐                                ┌───────────┴───────────┐
│ PostgresFactory       │                                │ MySqlFactory          │
│                       │                                │                       │
└───────────────────────┘                                └───────────────────────┘
            │                                                        │
            │ creates                                      creates   │
            ▼                                                        ▼
┌───────────────────────┐                                ┌───────────────────────┐
│ Pg driver             │                                │ My driver             │
│ Pg query builder      │                                │ My query builder      │
│ Pg migrator           │                                │ My migrator           │
└───────────────────────┘                                └───────────────────────┘
```

## Modern TypeScript Twist

Use `const` type parameters and discriminated literal tags so the family is **type-narrowed by dialect**:

```typescript
type Family<D extends string> = {
  readonly dialect: D;
  driver(): Driver;
  queryBuilder(): QueryBuilder;
  migrator(): Migrator;
};

function makeFactory<const D extends "postgres" | "mysql" | "sqlite">(
  dialect: D,
  conn: string,
): Family<D> {
  switch (dialect) {
    case "postgres": return new PostgresFactory(conn) as Family<D>;
    case "mysql":    return new MySqlFactory(conn)   as Family<D>;
    case "sqlite":   return new SqliteFactory(conn)  as Family<D>;
  }
}

const db = makeFactory("postgres", env.DSN);
// db.dialect is the literal "postgres", not the union
```

### Object-literal factories (functional style)

When the family has no state, dispense with classes entirely:

```typescript
type ThemeKit = {
  Button: (props: ButtonProps) => JSX.Element;
  Input:  (props: InputProps)  => JSX.Element;
  Card:   (props: CardProps)   => JSX.Element;
};

const lightKit = {
  Button: LightButton,
  Input:  LightInput,
  Card:   LightCard,
} satisfies ThemeKit;

const darkKit = {
  Button: DarkButton,
  Input:  DarkInput,
  Card:   DarkCard,
} satisfies ThemeKit;

// Client
function Page({ kit }: { kit: ThemeKit }) {
  return <kit.Card><kit.Button>OK</kit.Button></kit.Card>;
}
```

`satisfies` checks shape without widening the literal types of the members.

## Real-World Applications

### 1. Cross-platform UI toolkits

```typescript
interface UiFactory {
  Button(label: string): UiNode;
  TextField(placeholder: string): UiNode;
  Modal(title: string, body: UiNode): UiNode;
}

class WebUi implements UiFactory     { /* DOM nodes  */ }
class NativeUi implements UiFactory  { /* RN nodes   */ }
class TerminalUi implements UiFactory { /* TUI nodes */ }
```

Same view code runs on web, native, and TUI by injecting the right factory at the root.

### 2. Multi-cloud abstractions

```typescript
interface CloudFactory {
  blobStore(): BlobStore;
  queue(): MessageQueue;
  secrets(): SecretStore;
}

class AwsFactory   implements CloudFactory { /* S3 + SQS + SecretsManager */ }
class GcpFactory   implements CloudFactory { /* GCS + Pub/Sub + SecretMgr */ }
class AzureFactory implements CloudFactory { /* Blob + Queue + KeyVault   */ }
```

Switching clouds means swapping one binding at composition root.

### 3. Test doubles per family

```typescript
class InMemoryFactory implements CloudFactory {
  blobStore() { return new InMemoryBlobStore(); }
  queue()     { return new InMemoryQueue(); }
  secrets()   { return new InMemorySecrets(); }
}

// Tests pick the in-memory family; production picks AWS.
```

## When to Use

**Use Abstract Factory when:**

- Multiple objects **must come from the same family** (DB driver + dialect-aware query builder).
- You want to swap an entire variant (theme, cloud, dialect) at one place.
- You're worried about a junior dev mix-and-matching incompatible siblings.

**Don't use Abstract Factory when:**

- You only have one product type to create — use **Factory Method**.
- The "family" has one member today and might never grow — YAGNI.
- The products don't actually depend on each other — separate factories are clearer.

## Trade-offs

| Pro | Con |
| --- | --- |
| Family consistency enforced at compile time | Many interfaces + classes for small problems |
| Variants swap at composition root only | Adding a new product method touches every factory |
| Pairs cleanly with dependency injection | Easy to overuse; often a plain DI container is enough |

## Related Patterns

- **Factory Method** — single product; Abstract Factory aggregates multiple Factory Methods.
- **Prototype** — concrete factories often clone prototypes internally instead of `new`.
- **Singleton** — many systems make the concrete factory a singleton at startup; prefer DI.
- **Strategy** — strategies vary one algorithm; Abstract Factory varies a whole product family.

## Testing

```typescript
import { describe, it, expect } from "vitest";

describe("UserRepository", () => {
  it("works against any DbFactory", async () => {
    const fakeDb: DbFactory = {
      dialect: "postgres",
      driver: () => ({
        exec: async () => ({ rows: [{ id: 1 }] }) as QueryResult,
      }),
      queryBuilder: () => realQueryBuilder(),
      migrator: () => ({ apply: async () => {} }),
    };

    const repo = new UserRepository(fakeDb);
    expect(await repo.findActive()).toEqual([{ id: 1 }]);
  });
});
```

Because the client depends only on the factory interface, swapping in a fake family is one literal.
