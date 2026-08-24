import { describe, expect, it } from "vitest";
import { extractNode } from "../src/index.js";
import {
  corpusRepo,
  corpusDdl,
  tablesDeclaredIn,
  NOT_A_PROJECT,
  type CorpusNodeExpect,
} from "../../../test/fixtures.js";

/**
 * Extraction against real Node backends, validated against schemas psq did not
 * write. The hermetic coverage is in `test/mini-node.test.ts`. The repos are
 * private, so their paths and every ground-truth value live in the gitignored
 * `test/corpus.local.json`. The table lists come from a CREATE TABLE regex
 * over the pinned schema file (`tablesDeclaredIn`), so they track the live
 * corpus; a hand-checked stable core in the local config backstops the oracle
 * so the comparison can never pass vacuously.
 */

const repoD = corpusRepo("repoD");
const repoE = corpusRepo("repoE");
const repoC = corpusRepo("repoC");

// Note: vitest executes even a skipped describe body during collection, so
// everything at describe scope must tolerate an absent corpus.
describe.skipIf(!repoD)("repoD: inline-DDL TS backend [corpus]", () => {
  const repo = repoD!;
  const exp: CorpusNodeExpect = repo?.expect.node ?? {};
  const g = extractNode(repo?.path ?? NOT_A_PROJECT);

  it("reads every table declared in one inline template literal", () => {
    const names = g.entities.map((e) => e.name);
    // The oracle: text-read names must equal SQLite-read names.
    expect(names).toEqual(tablesDeclaredIn(corpusDdl(repo)));
    // The floor: hand-verified, must never regress even if the oracle breaks too.
    expect(names).toEqual(expect.arrayContaining(exp.tableFloor!));
    expect(names.length).toBeGreaterThanOrEqual(exp.minTables!);
  });

  it("does not mistake the many prepare() strings for schema", () => {
    // Every one of them names a table; none of them declares one.
    const wide = g.entities.find((e) => e.name === exp.wideTable!.name)!;
    expect(wide.properties).toHaveLength(exp.wideTable!.propertyCount);
    expect(wide.keys).toEqual(exp.wideTable!.keys);
  });

  it("infers relations from <table>_id, and only where the table exists", () => {
    expect(g.relations.map((r) => r.id)).toEqual(exp.relationIds!);
    // Several other *_id columns name no table here, so they get no edge
    // rather than a plausible-looking wrong one.
    expect(g.relations.map((r) => r.foreignKeyProperty)).not.toContain(exp.absentForeignKey!);
    expect(g.relations.every((r) => r.source === "inferred")).toBe(true);
  });

  it("treats a primary key named `id` as a house style, not a reference", () => {
    // Many tables key on `id`. Linking them to each other would connect the
    // whole schema to whichever table happened to be widest.
    expect(g.warnings).toContain(exp.houseStyleWarning!);
  });

  it("reads the zod layer, including schemas extended across files", () => {
    const byName = new Map(g.shapes.map((s) => [s.name, s]));
    expect(byName.get(exp.zodShape!)?.kind).toBe("zod");
    expect(byName.get(exp.zodFieldsShape!.name)?.fields.map((f) => f.name))
      .toContain(exp.zodFieldsShape!.contains);
  });

  it("pairs each row interface and each zod DTO with its table", () => {
    const paired = g.shapes
      .filter((s) => s.mirrors)
      .map((s) => `${s.name}->${s.mirrors}`)
      .sort();
    for (const pair of exp.mirrorPairs!) expect(paired).toContain(pair);
  });

  it("records the regex SPA route as a warning rather than a path", () => {
    expect(g.routes.map((r) => `${r.method} ${r.path}`)).toEqual(exp.routes!);
    expect(g.warnings.some((w) => /regular expression/.test(w))).toBe(true);
  });
});

describe.skipIf(!repoE)("repoE: constant-bound-DDL TS backend [corpus]", () => {
  const repo = repoE!;
  const exp: CorpusNodeExpect = repo?.expect.node ?? {};
  const g = extractNode(repo?.path ?? NOT_A_PROJECT);

  it("reads every table from a constant exec'd ninety lines later", () => {
    const names = g.entities.map((e) => e.name);
    // The oracle: text-read names must equal SQLite-read names.
    expect(names).toEqual(tablesDeclaredIn(corpusDdl(repo)));
    // The floor: hand-verified, must never regress even if the oracle breaks too.
    expect(names).toEqual(expect.arrayContaining(exp.tableFloor!));
    expect(names.length).toBeGreaterThanOrEqual(exp.minTables!);
    expect(g.warnings).toEqual([]);
  });

  it("links on a natural key that is not named like a foreign key", () => {
    // Nothing here ends in _id. A suffix rule finds no relations at all.
    expect(g.relations.map((r) => r.id)).toEqual(exp.relationIds!);
  });

  it("picks the owner of a shared key rather than linking both ways", () => {
    // The shared column is the sole primary key of BOTH its owner table and
    // one dependent.
    expect(g.relations.find((r) => r.dependent === exp.ownerTable!)).toBeUndefined();
    // A unique foreign key can only point at one parent row.
    expect(g.relations.find((r) => r.id === exp.oneToOneRelation!)?.cardinality)
      .toBe("one-to-one");
  });

  it("resolves a utility type the syntax alone cannot", () => {
    const wire = g.shapes.find((s) => s.name === exp.utilityShape!.name)!;
    // Omit<T, some keys> & { those keys, widened }.
    expect(wire.fields.map((f) => f.name).sort()).toEqual(exp.utilityShape!.fields);
  });

  it("reads a discriminated union declared without zod", () => {
    expect(g.shapes.find((s) => s.name === exp.unionShape!.name)?.discriminator)
      .toBe(exp.unionShape!.discriminator);
    expect(g.shapes.find((s) => s.name === exp.enumShape!.name)?.members)
      .toHaveLength(exp.enumShape!.members);
  });

  it("finds routes declared inside createApp()", () => {
    expect(g.routes).toHaveLength(exp.routeCount!);
    expect(g.routes.map((r) => r.path)).toContain(exp.routeContains!);
  });
});

describe.skipIf(!repoC)("repoC: schemaless TS backend [corpus]", () => {
  const repo = repoC!;
  const exp: CorpusNodeExpect = repo?.expect.node ?? {};
  const g = extractNode(repo?.path ?? NOT_A_PROJECT);

  it("reports no schema, and says why, without throwing", () => {
    expect(g.entities).toEqual([]);
    expect(g.warnings.some((w) => /No CREATE TABLE/.test(w))).toBe(true);
  });

  it("still reads the shapes and routes that are there", () => {
    // createApp() is declared to return `unknown` and cast at the call site,
    // so the receiver has to be recognized syntactically.
    expect(g.routes.length).toBeGreaterThan(0);
    expect(g.shapes.map((s) => s.name)).toContain(exp.shapeName!);
  });
});
