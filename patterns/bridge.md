# Bridge Pattern

## Intent

Decouple an **abstraction** from its **implementation** so that the two can vary independently. Bridge replaces an exploding inheritance hierarchy (`N abstractions × M implementations = N·M classes`) with composition (`N + M`).

## The Problem

You have two orthogonal dimensions of variation. Modelling both via inheritance produces a Cartesian-product class explosion.

```typescript
// Notifications × channels — every combination is its own class.
class UrgentEmailNotification     { /* … */ }
class UrgentSmsNotification       { /* … */ }
class UrgentSlackNotification     { /* … */ }
class MarketingEmailNotification  { /* … */ }
class MarketingSmsNotification    { /* … */ }
class MarketingSlackNotification  { /* … */ }
// Add a "Push" channel → 3 new classes.
// Add a "Reminder" notification kind → 4 new classes.
// 3 kinds × 4 channels = 12 classes. Painful.
```

**Symptoms:**

- New channel forces edits in every "kind" subtree.
- New kind forces edits in every "channel" subtree.
- Tests must enumerate the product, not the sum.

## The Solution

Split the hierarchy into two: the **abstraction** (the *what*) and the **implementation** (the *how*). The abstraction holds a reference to the implementation and delegates the parts that vary across channels.

```typescript
// ── Implementation hierarchy (the "how" — channel) ───────────
interface MessageChannel {
  send(to: string, subject: string, body: string): Promise<void>;
}

class EmailChannel implements MessageChannel {
  async send(to: string, subject: string, body: string) {
    await this.smtp.send({ to, subject, body });
  }
  constructor(private readonly smtp: SmtpClient) {}
}

class SmsChannel implements MessageChannel {
  async send(to: string, _subject: string, body: string) {
    await this.twilio.messages.create({ to, body });
  }
  constructor(private readonly twilio: TwilioClient) {}
}

class SlackChannel implements MessageChannel {
  async send(to: string, _subject: string, body: string) {
    await this.slack.chat.postMessage({ channel: to, text: body });
  }
  constructor(private readonly slack: SlackClient) {}
}

// ── Abstraction hierarchy (the "what" — notification kind) ────
abstract class Notification {
  constructor(protected readonly channel: MessageChannel) {}
  abstract send(to: string, payload: NotificationPayload): Promise<void>;
}

class UrgentNotification extends Notification {
  async send(to: string, p: NotificationPayload) {
    await this.channel.send(
      to,
      `🚨 URGENT: ${p.subject}`,
      `${p.body}\n\nThis is an urgent message. Please respond immediately.`,
    );
  }
}

class MarketingNotification extends Notification {
  async send(to: string, p: NotificationPayload) {
    if (await this.isUnsubscribed(to)) return;
    await this.channel.send(
      to,
      p.subject,
      `${p.body}\n\nUnsubscribe: ${this.unsubLink(to)}`,
    );
  }
  private async isUnsubscribed(to: string): Promise<boolean> { /* … */ }
  private unsubLink(to: string): string { /* … */ }
}

class ReminderNotification extends Notification {
  async send(to: string, p: NotificationPayload) {
    await this.channel.send(to, `Reminder: ${p.subject}`, p.body);
  }
}

// ── Mix and match at the composition root ─────────────────────
const urgentEmail  = new UrgentNotification(new EmailChannel(smtp));
const urgentSlack  = new UrgentNotification(new SlackChannel(slack));
const marketingSms = new MarketingNotification(new SmsChannel(twilio));

await urgentEmail.send("ops@x.com", { subject: "Server down", body: "…" });
await marketingSms.send("+1…", { subject: "Sale", body: "50% off" });
```

3 kinds + 3 channels = **6 classes** instead of 9. Add Push: +1 class total, not +3.

## Structure

```
   ┌───────────────────────┐       ┌──────────────────────┐
   │     Abstraction       │◇─────▶│  Implementor (impl)  │
   │  (e.g. Notification)  │  has-a │  (MessageChannel)   │
   │  + send(…)            │       │  + send(…)           │
   └──────────┬────────────┘       └──────────┬───────────┘
              △                               △
   ┌──────────┴──────────┐         ┌──────────┴──────────┐
   │ RefinedAbstraction1 │         │ ConcreteImplA       │
   │ RefinedAbstraction2 │         │ ConcreteImplB       │
   └─────────────────────┘         └─────────────────────┘
```

The diamond (◇) is composition; the triangles (△) are inheritance.

## Modern TypeScript Twist

### Bridge with structural types

Classes are optional; the abstraction holds an interface, not a base class:

```typescript
type Channel = (to: string, subject: string, body: string) => Promise<void>;

type Notification = {
  send(to: string, payload: NotificationPayload): Promise<void>;
};

const urgent = (channel: Channel): Notification => ({
  async send(to, p) {
    await channel(to, `🚨 URGENT: ${p.subject}`, p.body);
  },
});

const marketing = (channel: Channel, unsub: UnsubscribeService): Notification => ({
  async send(to, p) {
    if (await unsub.isUnsubscribed(to)) return;
    await channel(to, p.subject, `${p.body}\n\nUnsubscribe: ${unsub.link(to)}`);
  },
});

const email:  Channel = (to, sub, body) => smtp.send({ to, subject: sub, body });
const sms:    Channel = (to, _sub, body) => twilio.send({ to, body });
const slack:  Channel = (to, _sub, body) => slackClient.post(to, body);

const urgentEmail = urgent(email);
const urgentSlack = urgent(slack);
```

### Bridge × Strategy

Bridge is structurally identical to Strategy; the distinction is **intent**:

- **Strategy** varies one *algorithm* and is swapped at runtime by the client.
- **Bridge** varies the *implementation layer* under a stable abstraction; typically wired once.

They often coexist: the implementor side of a Bridge is itself a Strategy.

## Real-World Applications

### 1. Cross-platform rendering

```typescript
interface GraphicsContext {
  drawCircle(x: number, y: number, r: number): void;
  drawText(x: number, y: number, s: string): void;
}

class CanvasContext implements GraphicsContext { /* HTML5 Canvas */ }
class SvgContext    implements GraphicsContext { /* SVG DOM   */ }
class PdfContext    implements GraphicsContext { /* PDFKit    */ }

abstract class Shape {
  constructor(protected readonly gfx: GraphicsContext) {}
  abstract draw(): void;
}

class Avatar extends Shape {
  constructor(gfx: GraphicsContext, private readonly user: User) {
    super(gfx);
  }
  draw() {
    this.gfx.drawCircle(this.user.x, this.user.y, 24);
    this.gfx.drawText(this.user.x, this.user.y + 30, this.user.name);
  }
}

// Same Avatar logic renders to canvas, SVG, or PDF.
const avatar = new Avatar(new CanvasContext(ctx), user);
avatar.draw();
```

### 2. Logger × sink

```typescript
interface LogSink {
  write(level: LogLevel, line: string): void;
}

class ConsoleSink implements LogSink { /* … */ }
class FileSink    implements LogSink { /* … */ }
class HttpSink    implements LogSink { /* … */ }

abstract class Logger {
  constructor(protected readonly sink: LogSink) {}
  abstract info(msg: string): void;
  abstract error(msg: string, cause?: unknown): void;
}

class PlainTextLogger extends Logger { /* formats as text */ }
class JsonLogger      extends Logger { /* formats as JSON */ }
class PrettyLogger    extends Logger { /* ANSI colors + boxes */ }

// Mix freely:
const prodLogger = new JsonLogger(new HttpSink(logIngestUrl));
const devLogger  = new PrettyLogger(new ConsoleSink());
```

### 3. Persistence × ORM

```typescript
interface PersistenceDriver {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
  begin(): Promise<Tx>;
}

abstract class Repository<T> {
  constructor(protected readonly db: PersistenceDriver) {}
  abstract findById(id: string): Promise<T | null>;
}

class PostgresDriver implements PersistenceDriver { /* … */ }
class SqliteDriver   implements PersistenceDriver { /* … */ }

class UserRepository extends Repository<User>    { /* … */ }
class OrderRepository extends Repository<Order>  { /* … */ }

const users = new UserRepository(new PostgresDriver(env.DSN));
const orders = new OrderRepository(new SqliteDriver(":memory:")); // for tests
```

## When to Use

**Use Bridge when:**

- You have two orthogonal dimensions of variation (e.g., **what** × **how**, **shape** × **renderer**).
- Inheritance is producing a Cartesian product of classes.
- You want to swap implementations at runtime (e.g., switching renderers, drivers, sinks).
- You want to extend either side independently.

**Don't use Bridge when:**

- Only one dimension varies — use **Strategy** or plain composition.
- The two sides are tightly coupled and will never vary — Bridge adds ceremony for nothing.
- You have only a single concrete implementor today — YAGNI; introduce Bridge when the second appears.

## Bridge vs. Adapter

| Aspect | Bridge | Adapter |
| --- | --- | --- |
| Purpose | Decouple abstraction from implementation **by design** | Make incompatible interfaces work **after the fact** |
| When designed | Upfront, during architecture | Reactively, when integrating |
| Both sides vary | Yes | Usually only the "adapted" side |
| Hierarchies | Two parallel ones | One; bolted onto external code |

## Bridge vs. Strategy

| Aspect | Bridge | Strategy |
| --- | --- | --- |
| Intent | Hide implementation layer | Swap algorithm |
| Lifetime | Wired once at composition root | Often changed per call |
| Granularity | Whole-subsystem | Single behavior |

Structurally identical; the difference is **why** you wrote it.

## Pitfalls

| Pitfall | Mitigation |
| --- | --- |
| Two hierarchies start coupling back together | Keep the implementor interface narrow and stable |
| Implementor leaks abstraction concerns | Push abstraction-specific logic up; keep implementor mechanical |
| Bridge introduced before the second variant exists | Defer until you actually have N×M; YAGNI |

## Related Patterns

- **Adapter** — converts one interface to another; Bridge is designed in from the start.
- **Strategy** — same structure, narrower scope.
- **Abstract Factory** — often used to create a matched pair of (abstraction, implementor).
- **State** — uses the same indirection but for behavior that depends on internal state.

## Testing

```typescript
import { describe, it, expect, vi } from "vitest";

describe("UrgentNotification", () => {
  it("sends with the urgent prefix via any channel", async () => {
    const channel: MessageChannel = { send: vi.fn() };
    const urgent = new UrgentNotification(channel);

    await urgent.send("user@x.com", { subject: "Down", body: "Now" });

    expect(channel.send).toHaveBeenCalledWith(
      "user@x.com",
      "🚨 URGENT: Down",
      expect.stringContaining("urgent message"),
    );
  });
});
```

You test each side independently. That's the whole point of Bridge.
