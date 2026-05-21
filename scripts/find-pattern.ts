#!/usr/bin/env -S node --experimental-strip-types
/**
 * find-pattern.ts — Pattern lookup CLI for the software-best-design-patterns skill.
 *
 * Given a symptom keyword, problem description, or pattern name, returns the
 * matching pattern file(s) so they can be read with the agent's `Read` tool.
 *
 * Runs on Node 22.7+ (`--experimental-strip-types`), Node 23.6+ (stable), or Bun
 * (`bun scripts/find-pattern.ts ...`). For Deno: `deno run --allow-read scripts/find-pattern.ts ...`.
 *
 * Usage:
 *   find-pattern.ts list
 *   find-pattern.ts search <keyword>             # e.g. "retry" / "switch" / "global state"
 *   find-pattern.ts show <pattern-name>           # e.g. "strategy" or "circuit-breaker"
 *   find-pattern.ts category <category>           # creational | structural | behavioral | enterprise | modern | resilience
 *   find-pattern.ts symptoms                      # all symptom → pattern mappings
 *
 * All output is plain text (one match per line) so it's easy to grep / pipe.
 */

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

type Category =
  | "creational"
  | "structural"
  | "behavioral"
  | "enterprise"
  | "modern"
  | "resilience";

type PatternMeta = {
  readonly category: Category;
  readonly intent: string;
  readonly tags: readonly string[];
  readonly symptoms: readonly string[];
};

const CATEGORIES = [
  "creational",
  "structural",
  "behavioral",
  "enterprise",
  "modern",
  "resilience",
] as const satisfies readonly Category[];

// ── Catalog ──────────────────────────────────────────────────────────────

const CATALOG = {
  // ── Creational ─────────────────────────────────────────────────────
  factory: {
    category: "creational",
    intent: "Encapsulate object creation",
    tags: ["create", "instantiate", "new", "construction"],
    symptoms: ["new in many places", "creation logic duplicated", "conditional construction"],
  },
  "abstract-factory": {
    category: "creational",
    intent: "Family of related objects, swap as a unit",
    tags: ["family", "variant", "theme", "cross-cutting creation"],
    symptoms: ["mix-and-match incompatible siblings", "want to swap whole theme/platform/driver"],
  },
  builder: {
    category: "creational",
    intent: "Step-by-step construction; fluent APIs",
    tags: ["fluent", "step", "construct", "with"],
    symptoms: ["constructor takes 8+ params", "many optional params", "want fluent API"],
  },
  prototype: {
    category: "creational",
    intent: "Clone an existing instance instead of constructing",
    tags: ["clone", "copy", "template", "duplicate"],
    symptoms: ["construction is expensive", "many similar instances", "save/load semantics"],
  },
  singleton: {
    category: "creational",
    intent: "One instance (PREFER dependency injection instead)",
    tags: ["singleton", "global", "instance"],
    symptoms: ["want global access point", "hidden global state (anti-pattern)"],
  },

  // ── Structural ─────────────────────────────────────────────────────
  adapter: {
    category: "structural",
    intent: "Convert one interface to another",
    tags: ["wrap", "convert", "interface mismatch", "compatibility"],
    symptoms: ["third-party API doesn't fit", "incompatible interfaces"],
  },
  bridge: {
    category: "structural",
    intent: "Decouple two orthogonal hierarchies via composition",
    tags: ["orthogonal", "abstraction", "implementation", "two axes"],
    symptoms: ["N kinds × M variants = N*M classes", "two independent dimensions of variation"],
  },
  composite: {
    category: "structural",
    intent: "Uniform tree of parts and wholes",
    tags: ["tree", "recursive", "hierarchy", "part-whole"],
    symptoms: ["want to treat one item and a group the same", "recursive structures"],
  },
  decorator: {
    category: "structural",
    intent: "Add behaviour dynamically without subclassing",
    tags: ["wrap", "enhance", "add behavior", "layer"],
    symptoms: ["adding features bloats class", "want optional enhancements", "subclass explosion"],
  },
  facade: {
    category: "structural",
    intent: "One simple surface over a complex subsystem",
    tags: ["simplify", "hide complexity", "wrapper"],
    symptoms: ["clients confused by subsystem API", "many steps to do one thing"],
  },
  flyweight: {
    category: "structural",
    intent: "Share heavy intrinsic state across many instances",
    tags: ["share", "intern", "cache", "memory"],
    symptoms: ["millions of similar objects", "memory pressure", "duplicated heavy state"],
  },
  proxy: {
    category: "structural",
    intent: "Stand-in that controls access to the real thing",
    tags: ["control access", "lazy", "remote", "permission"],
    symptoms: ["need lazy load", "need access control", "remote service stub"],
  },

  // ── Behavioral ─────────────────────────────────────────────────────
  "chain-of-responsibility": {
    category: "behavioral",
    intent: "Pass request through handlers until one acts",
    tags: ["pipeline", "chain", "handler", "fallback"],
    symptoms: ["sequential handlers", "fallback chain", "filter pipeline"],
  },
  command: {
    category: "behavioral",
    intent: "Encapsulate requests as objects",
    tags: ["action", "request", "undo", "queue", "log"],
    symptoms: ["need undo/redo", "queue operations", "log requests"],
  },
  iterator: {
    category: "behavioral",
    intent: "Sequential access without exposing structure",
    tags: ["traverse", "for-of", "generator", "stream"],
    symptoms: ["want to hide collection internals", "lazy traversal", "paged API"],
  },
  mediator: {
    category: "behavioral",
    intent: "Centralise complex N-to-N communication",
    tags: ["coordinator", "hub", "bus"],
    symptoms: ["N-to-N coupling", "components know too much about each other"],
  },
  memento: {
    category: "behavioral",
    intent: "Snapshot internal state for restoration",
    tags: ["snapshot", "save", "restore", "undo"],
    symptoms: ["need save/load", "need rollback", "time-travel debugging"],
  },
  observer: {
    category: "behavioral",
    intent: "Notify dependents of state changes",
    tags: ["subscribe", "notify", "event", "pub-sub"],
    symptoms: ["one change must update many places", "event system", "reactive UI"],
  },
  state: {
    category: "behavioral",
    intent: "Behaviour changes with internal state",
    tags: ["state machine", "transitions", "workflow"],
    symptoms: ["if/else over object state", "behavior differs by phase", "workflow"],
  },
  strategy: {
    category: "behavioral",
    intent: "Interchangeable algorithms behind one interface",
    tags: ["algorithm", "policy", "swap behavior"],
    symptoms: ["growing switch on type", "multiple ways to do X", "want runtime swap"],
  },
  "template-method": {
    category: "behavioral",
    intent: "Algorithm skeleton with overridable hooks",
    tags: ["skeleton", "framework", "hooks"],
    symptoms: ["duplicate algorithm with one varying step", "framework extension points"],
  },
  visitor: {
    category: "behavioral",
    intent: "Add operations to a closed hierarchy",
    tags: ["double dispatch", "ast", "operation"],
    symptoms: ["closed hierarchy with open operations", "AST traversal", "many operations across types"],
  },

  // ── Enterprise / PoEAA ─────────────────────────────────────────────
  repository: {
    category: "enterprise",
    intent: "Collection-like data access",
    tags: ["data access", "abstract DB", "persistence"],
    symptoms: ["SQL leaking into services", "want to swap DB", "test without DB"],
  },
  "unit-of-work": {
    category: "enterprise",
    intent: "Coordinate atomic changes across entities",
    tags: ["transaction", "atomic", "commit"],
    symptoms: ["multi-entity updates must be atomic", "transaction management"],
  },
  "identity-map": {
    category: "enterprise",
    intent: "Ensure object identity within a session",
    tags: ["identity", "orm", "dedupe"],
    symptoms: ["same row loaded twice → two different objects", "stale data"],
  },
  "lazy-load": {
    category: "enterprise",
    intent: "Defer expensive loading",
    tags: ["defer", "on-demand", "load"],
    symptoms: ["loading everything upfront is slow", "object graphs are huge"],
  },
  "service-layer": {
    category: "enterprise",
    intent: "Define application boundary and orchestration",
    tags: ["use case", "application", "orchestrate"],
    symptoms: ["business logic in controllers", "need an API boundary"],
  },
  dto: {
    category: "enterprise",
    intent: "Shape data for transfer across boundaries",
    tags: ["dto", "boundary", "api contract"],
    symptoms: ["domain objects leak across API", "over-exposure", "input validation"],
  },

  // ── Modern (TypeScript-native) ─────────────────────────────────────
  result: {
    category: "modern",
    intent: "Failure as a typed value, not an exception",
    tags: ["either", "result", "error handling", "railway"],
    symptoms: ["throw for expected errors", "untyped catch (e)", "want typed error union"],
  },
  "discriminated-union-state": {
    category: "modern",
    intent: "Tagged unions for state — make illegal states unrepresentable",
    tags: ["adt", "tagged union", "state", "exhaustive"],
    symptoms: ["loading + data + error booleans", "many valid states", "want exhaustive switch"],
  },
  "branded-types": {
    category: "modern",
    intent: "Nominal-style identity in a structural type system",
    tags: ["brand", "nominal", "opaque", "id"],
    symptoms: ["stringly-typed ids", "mixed up args (string for both userId and orderId)", "units"],
  },
  "type-state": {
    category: "modern",
    intent: "Encode state machines in the type system",
    tags: ["phantom", "state machine", "compile-time", "this:"],
    symptoms: ["forgot required builder step", "must call X before Y at compile time"],
  },
  "dependency-injection": {
    category: "modern",
    intent: "Modern replacement for Singleton & Service Locator",
    tags: ["di", "injection", "constructor injection", "ioc"],
    symptoms: ["singleton hell", "hard to test without env", "globals", "service locator"],
  },
  middleware: {
    category: "modern",
    intent: "Onion-shaped composable request/response pipeline",
    tags: ["pipeline", "onion", "interceptor", "filter"],
    symptoms: ["cross-cutting concerns repeated per handler", "want to compose request handling"],
  },
  reducer: {
    category: "modern",
    intent: "(state, action) → state — functional cousin of State",
    tags: ["reducer", "redux", "useReducer", "action"],
    symptoms: ["many useStates", "complex transitions", "want time-travel"],
  },
  hooks: {
    category: "modern",
    intent: "Reusable stateful logic in components",
    tags: ["react hooks", "vue composables", "use"],
    symptoms: ["duplicate component state logic", "HOC nesting", "render props"],
  },
  signals: {
    category: "modern",
    intent: "Fine-grained reactive primitive",
    tags: ["signal", "computed", "effect", "reactive"],
    symptoms: ["coarse re-renders", "want fine-grained reactivity", "spreadsheet-like dependencies"],
  },

  // ── Resilience / Distributed ───────────────────────────────────────
  "circuit-breaker": {
    category: "resilience",
    intent: "Stop hammering failing dependencies",
    tags: ["circuit", "breaker", "fail-fast", "cascading"],
    symptoms: ["dependency outage cascades", "retry storms", "thread/connection exhaustion"],
  },
  "retry-backoff": {
    category: "resilience",
    intent: "Handle transient failures with bounded, jittered retries",
    tags: ["retry", "backoff", "jitter", "exponential"],
    symptoms: ["transient network errors", "503s", "thundering herd"],
  },
  saga: {
    category: "resilience",
    intent: "Coordinate cross-service workflows with compensation",
    tags: ["saga", "compensation", "long-running", "workflow"],
    symptoms: ["cross-service transaction needed", "must rollback across services", "long workflow"],
  },
  outbox: {
    category: "resilience",
    intent: "Atomic DB-change-plus-event publication",
    tags: ["outbox", "dual write", "kafka", "event publication"],
    symptoms: ["DB save + broker publish drift", "lost events", "phantom events"],
  },
  idempotency: {
    category: "resilience",
    intent: "Make retries safe at the API and consumer boundaries",
    tags: ["idempotency", "dedupe", "exactly-once"],
    symptoms: ["retries cause duplicates", "double charges", "duplicate emails"],
  },
} as const satisfies Record<string, PatternMeta>;

type PatternName = keyof typeof CATALOG;

// ── Helpers ──────────────────────────────────────────────────────────────

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PATTERNS_DIR = join(SKILL_ROOT, "patterns");

function patternPath(name: string): string {
  return join(PATTERNS_DIR, `${name}.md`);
}

function isPatternName(name: string): name is PatternName {
  return name in CATALOG;
}

function isCategory(s: string): s is Category {
  return (CATEGORIES as readonly string[]).includes(s);
}

// ── Subcommands ──────────────────────────────────────────────────────────

function listAll(): void {
  const byCategory = new Map<Category, string[]>();
  for (const name of Object.keys(CATALOG) as PatternName[]) {
    const cat = CATALOG[name].category;
    const arr = byCategory.get(cat) ?? [];
    arr.push(name);
    byCategory.set(cat, arr);
  }

  for (const cat of CATEGORIES) {
    const names = (byCategory.get(cat) ?? []).toSorted();
    if (names.length === 0) continue;
    console.log(`# ${cat.toUpperCase()}`);
    for (const name of names) {
      console.log(`  ${name.padEnd(30)} ${patternPath(name)}`);
    }
    console.log();
  }
}

function show(name: string): number {
  if (!isPatternName(name)) {
    console.error(`unknown pattern: ${name}`);
    console.error("hint: try `find-pattern.ts list` or `find-pattern.ts search <keyword>`");
    return 1;
  }
  const meta = CATALOG[name];
  console.log(`name:     ${name}`);
  console.log(`category: ${meta.category}`);
  console.log(`intent:   ${meta.intent}`);
  console.log(`tags:     ${meta.tags.join(", ")}`);
  console.log(`symptoms:`);
  for (const s of meta.symptoms) console.log(`  - ${s}`);
  console.log(`file:     ${patternPath(name)}`);
  return 0;
}

function search(keyword: string): number {
  const kw = keyword.toLowerCase();
  const hits: { score: number; name: PatternName }[] = [];

  for (const name of Object.keys(CATALOG) as PatternName[]) {
    const meta = CATALOG[name];
    let score = 0;
    if (name.includes(kw)) score += 5;
    if (meta.intent.toLowerCase().includes(kw)) score += 3;
    for (const tag of meta.tags) if (tag.toLowerCase().includes(kw)) score += 2;
    for (const symptom of meta.symptoms) if (symptom.toLowerCase().includes(kw)) score += 1;
    if (score > 0) hits.push({ score, name });
  }

  if (hits.length === 0) {
    console.error(`no matches for '${keyword}'`);
    console.error("hint: try `find-pattern.ts symptoms` to browse symptoms");
    return 1;
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  for (const { score, name } of hits) {
    const meta = CATALOG[name];
    console.log(
      `  [${String(score).padStart(2)}]  ${name.padEnd(30)} (${meta.category.padEnd(10)}) ${meta.intent}`,
    );
    console.log(`        ${patternPath(name)}`);
  }
  return 0;
}

function byCategory(cat: string): number {
  if (!isCategory(cat)) {
    console.error(`unknown category: ${cat}`);
    console.error(`valid: ${CATEGORIES.join(", ")}`);
    return 1;
  }
  const names = (Object.keys(CATALOG) as PatternName[])
    .filter((n) => CATALOG[n].category === cat)
    .toSorted();
  for (const name of names) {
    const meta = CATALOG[name];
    console.log(`  ${name.padEnd(30)} ${meta.intent}`);
    console.log(`      ${patternPath(name)}`);
  }
  return 0;
}

function listSymptoms(): void {
  for (const name of (Object.keys(CATALOG) as PatternName[]).toSorted()) {
    for (const symptom of CATALOG[name].symptoms) {
      console.log(`  ${symptom.padEnd(55)} → ${name}`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const USAGE = `\
Usage:
  find-pattern.ts list
  find-pattern.ts search <keyword>
  find-pattern.ts show <pattern-name>
  find-pattern.ts category <name>     # ${CATEGORIES.join(" | ")}
  find-pattern.ts symptoms
`;

function main(argv: readonly string[]): number {
  if (argv.length < 1) {
    console.error(USAGE);
    return 2;
  }
  const [cmd, arg] = argv;
  switch (cmd) {
    case "list":
    case "ls":
      listAll();
      return 0;
    case "show":
      if (!arg) { console.error("show requires a pattern name"); return 2; }
      return show(arg);
    case "search":
      if (!arg) { console.error("search requires a keyword"); return 2; }
      return search(arg);
    case "category":
      if (!arg) { console.error("category requires a category name"); return 2; }
      return byCategory(arg);
    case "symptoms":
    case "symptom":
      listSymptoms();
      return 0;
    case "--help":
    case "-h":
    case "help":
      console.log(USAGE);
      return 0;
    default:
      console.error(`unknown command: ${cmd}`);
      console.error(USAGE);
      return 2;
  }
}

process.exit(main(process.argv.slice(2)));
