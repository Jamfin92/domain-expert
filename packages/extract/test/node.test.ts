import { describe, expect, it } from "vitest";
import { extractNode } from "../src/index.js";
import { CORPUS, hasCorpus } from "../../../test/fixtures.js";

/**
 * Extraction against real Node backends, validated against schemas psq did not
 * write. The hermetic coverage is in `test/mini-node.test.ts`; these assert the
 * counts a person can check by opening the file and counting CREATE TABLE.
 */

describe.skipIf(!hasCorpus(CORPUS.corpus-repo-d))("corpus-repo-d [corpus]", () => {
  const g = extractNode(CORPUS.corpus-repo-d);

  it("reads all nine tables from one inline template literal", () => {
    expect(g.entities.map((e) => e.name)).toEqual([
      "approvals", "audit", "chat_messages", "chats", "model_variant_eta",
      "packets", "settings", "spend", "tasks",
    ]);
  });

  it("does not mistake the thirty prepare() strings for schema", () => {
    // Every one of them names a table; none of them declares one.
    const tasks = g.entities.find((e) => e.name === "tasks")!;
    expect(tasks.properties).toHaveLength(15);
    expect(tasks.keys).toEqual(["id"]);
  });

  it("infers relations from <table>_id, and only where the table exists", () => {
    expect(g.relations.map((r) => r.id)).toEqual([
      "approvals.task_id->tasks",
      "audit.task_id->tasks",
      "chat_messages.chat_id->chats",
      "packets.task_id->tasks",
      "spend.task_id->tasks",
    ]);
    // project_id, worker_id, host_id and parent_chat_id name no table here, so
    // they get no edge rather than a plausible-looking wrong one.
    expect(g.relations.map((r) => r.foreignKeyProperty)).not.toContain("project_id");
    expect(g.relations.every((r) => r.source === "inferred")).toBe(true);
  });

  it("treats a primary key named `id` as a house style, not a reference", () => {
    // Six tables key on `id`. Linking them to each other would connect the
    // whole schema to whichever table happened to be widest.
    expect(g.warnings).toContain(
      "id is the identifying column of 6 tables, so it reads as a naming convention; no relation inferred from it",
    );
  });

  it("reads the zod layer, including schemas extended across files", () => {
    const byName = new Map(g.shapes.map((s) => [s.name, s]));
    expect(byName.get("Task")?.kind).toBe("zod");
    expect(byName.get("WorkerUsage")?.fields.map((f) => f.name)).toContain("workerId");
  });

  it("pairs each row interface and each zod DTO with its table", () => {
    const paired = g.shapes
      .filter((s) => s.mirrors)
      .map((s) => `${s.name}->${s.mirrors}`)
      .sort();
    expect(paired).toContain("TaskRow->tasks");
    expect(paired).toContain("Task->tasks");
  });

  it("records the regex SPA route as a warning rather than a path", () => {
    expect(g.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /api/health",
      "POST /api/notify/test",
    ]);
    expect(g.warnings.some((w) => /regular expression/.test(w))).toBe(true);
  });
});

describe.skipIf(!hasCorpus(CORPUS.corpus-repo-e))("corpus-repo-e [corpus]", () => {
  const g = extractNode(CORPUS.corpus-repo-e);

  it("reads five tables from a constant exec'd ninety lines later", () => {
    expect(g.entities.map((e) => e.name)).toEqual([
      "feed_items", "feed_state", "meta", "quotes", "tickers",
    ]);
    expect(g.warnings).toEqual([]);
  });

  it("links on a natural key that is not named like a foreign key", () => {
    // Nothing here ends in _id. A suffix rule finds no relations at all.
    expect(g.relations.map((r) => r.id)).toEqual([
      "feed_items.symbol->tickers",
      "feed_state.symbol->tickers",
      "quotes.symbol->tickers",
    ]);
  });

  it("picks the owner of a shared key rather than linking both ways", () => {
    // `symbol` is the sole primary key of BOTH tickers and feed_state.
    expect(g.relations.find((r) => r.dependent === "tickers")).toBeUndefined();
    // A unique foreign key can only point at one parent row.
    expect(g.relations.find((r) => r.id === "feed_state.symbol->tickers")?.cardinality)
      .toBe("one-to-one");
  });

  it("resolves a utility type the syntax alone cannot", () => {
    const wire = g.shapes.find((s) => s.name === "SerializedRefreshDecision")!;
    // Omit<RefreshDecision, three keys> & { those three, widened }.
    expect(wire.fields.map((f) => f.name).sort()).toEqual([
      "due", "effectiveMove", "hoursSinceRefresh", "reason", "threshold", "weight",
    ]);
  });

  it("reads a discriminated union declared without zod", () => {
    expect(g.shapes.find((s) => s.name === "FeedRow")?.discriminator).toBe("kind");
    expect(g.shapes.find((s) => s.name === "EventClass")?.members).toHaveLength(8);
  });

  it("finds routes declared inside createApp()", () => {
    expect(g.routes).toHaveLength(6);
    expect(g.routes.map((r) => r.path)).toContain("/tickers/:symbol/news");
  });
});

describe.skipIf(!hasCorpus(CORPUS.corpus-repo-c))("corpus-repo-c [corpus]", () => {
  const g = extractNode(CORPUS.corpus-repo-c);

  it("reports no schema, and says why, without throwing", () => {
    expect(g.entities).toEqual([]);
    expect(g.warnings.some((w) => /No CREATE TABLE/.test(w))).toBe(true);
  });

  it("still reads the shapes and routes that are there", () => {
    // createApp() is declared to return `unknown` and cast at the call site,
    // so the receiver has to be recognized syntactically.
    expect(g.routes.length).toBeGreaterThan(0);
    expect(g.shapes.map((s) => s.name)).toContain("GammaMarket");
  });
});
