import { describe, expect, it } from "vitest";
import { extract, extractNode, detectProvider, drift } from "@psq/extract";
import { invariants } from "@psq/graph";
import { generateDsMcq, generateDsCloze, selftest } from "@psq/quiz";
import { MINI_EFCORE, MINI_NODE, NOT_A_PROJECT } from "./fixtures.js";

/**
 * The Node reader against a fixture that lives in this repo, so the whole path
 * is covered without a corpus. Every construct asserted here is in the fixture
 * on purpose; if one stops being read, this is where it shows.
 */

const g = extractNode(MINI_NODE);

describe("reading a Node backend", () => {
  it("reads the schema without a single warning", () => {
    // Rule 3: an unread construct is a warning. A clean fixture is the contract.
    expect(g.warnings).toEqual([]);
    expect(invariants(g)).toEqual([]);
    expect(g.provider).toBe("sqlite-ddl");
  });

  it("finds DDL written inline and DDL bound to a constant", () => {
    // crews/voyages are inline in exec(); log_entries/ports come from schema.ts.
    expect(g.entities.map((e) => e.name)).toEqual([
      "crews",
      "log_entries",
      "ports",
      "voyages",
    ]);
  });

  it("ignores a table named in a query rather than declared", () => {
    // db.ts SELECTs from voyages; that must not add columns to it.
    const voyages = g.entities.find((e) => e.name === "voyages")!;
    expect(voyages.properties.map((p) => p.column)).toEqual([
      "id",
      "crew_id",
      "destination",
      "cargo_tons",
      "departed_at",
    ]);
  });

  it("reads a composite primary key and skips a comment between columns", () => {
    const log = g.entities.find((e) => e.name === "log_entries")!;
    expect(log.keys).toEqual(["callsign", "seq"]);

    const crews = g.entities.find((e) => e.name === "crews")!;
    expect(crews.properties.map((p) => p.column)).toEqual([
      "callsign",
      "name",
      "home_port",
      "founded_year",
    ]);
  });

  it("keeps the declared index and drops the one that restates the key", () => {
    const voyages = g.entities.find((e) => e.name === "voyages")!;
    expect(voyages.indexes).toEqual([
      { properties: ["departed_at"], isUnique: false, source: "declared" },
    ]);
  });

  it("infers relations from naming, and says they were inferred", () => {
    expect(g.relations.map((r) => r.id)).toEqual([
      "log_entries.callsign->crews", // the column is another table's sole key
      "voyages.crew_id->crews", // <table>_id
    ]);
    expect(g.relations.every((r) => r.source === "inferred")).toBe(true);
    // Nobody wrote a delete rule, so no delete-behavior question may be asked.
    expect(g.relations.every((r) => r.deleteBehaviorSource === "inferred")).toBe(true);
  });

  it("never points a table at itself through its own key", () => {
    for (const r of g.relations) expect(r.principal).not.toBe(r.dependent);
  });

  it("reads routes registered inside a factory body", () => {
    expect(g.routes).toEqual([
      { method: "GET", path: "/crews/:callsign", file: "server.ts", line: 14 },
      { method: "GET", path: "/health", file: "server.ts", line: 10 },
      { method: "POST", path: "/voyages", file: "server.ts", line: 18 },
    ]);
  });
});

describe("reading shapes with the checker", () => {
  const byName = new Map(g.shapes.map((s) => [s.name, s]));

  it("resolves a utility type over an intersection", () => {
    // Omit<Manifest, "tons" | "sealed"> & { tons; sealed } is four properties.
    // Reading the syntax alone would report two.
    expect(byName.get("WireManifest")!.fields.map((f) => f.name)).toEqual([
      "crew",
      "id",
      "sealed",
      "tons",
    ]);
  });

  it("resolves a zod schema extended across a file boundary", () => {
    const extended = byName.get("CrewWithFleet")!;
    expect(extended.kind).toBe("zod");
    expect(extended.fields.map((f) => f.name)).toEqual([
      "active",
      "callsign",
      "fleet",
      "foundedYear",
      "homePort",
      "name",
    ]);
    expect(extended.fields.find((f) => f.name === "active")!.optional).toBe(true);
  });

  it("reads members of a string-literal union and of an enum", () => {
    expect(byName.get("Weather")!.members).toEqual(["calm", "squall", "gale", "fog"]);
    expect(byName.get("Rating")!.members).toEqual(["Bronze", "Silver", "Gold"]);
  });

  it("names the discriminant of a union, and only a real one", () => {
    // `hours` is on both members, so it is not a discriminant; `kind` is.
    expect(byName.get("Leg")!.discriminator).toBe("kind");
    expect(byName.get("PortCall")!.discriminator).toBeNull();
  });

  it("treats null and optional as one axis", () => {
    // homePort is `.nullable()`, not `.optional()`, and both mean the same
    // thing about the field. Splitting them reports drift on every nullable
    // column in the schema.
    const crew = byName.get("Crew")!;
    expect(crew.fields.find((f) => f.name === "homePort")!.optional).toBe(true);
    expect(crew.fields.find((f) => f.name === "name")!.optional).toBe(false);
  });
});

describe("pairing a shape with the table it mirrors", () => {
  it("pairs on the concept, not on the spelling", () => {
    const paired = g.shapes.filter((s) => s.mirrors).map((s) => [s.name, s.mirrors]);
    expect(paired).toEqual([
      ["Crew", "crews"], // camelCase zod schema vs snake_case table
      ["Voyage", "voyages"],
      ["VoyageRow", "voyages"], // the Row suffix is stripped before matching
    ]);
  });

  it("refuses to pair a shape with no table behind it", () => {
    const unpaired = g.shapes.filter((s) => !s.mirrors).map((s) => s.name);
    // CrewRoster shares three of its four field names with `crews`-adjacent
    // vocabulary and is still not a table. Naming is not evidence on its own.
    expect(unpaired).toContain("CrewRoster");
    expect(unpaired).toContain("Manifest");
    expect(unpaired).toContain("Leg");
    expect(g.shapes.filter((s) => s.mirrors)).toHaveLength(3);
  });

  it("finds the gap in both directions", () => {
    const voyages = g.entities.find((e) => e.name === "voyages")!;
    const dto = g.shapes.find((s) => s.name === "Voyage")!;
    const d = drift(voyages, dto);
    expect(d.entityOnly).toEqual(["departed_at"]);
    expect(d.shapeOnly).toEqual(["weather"]);
    expect(d.shared.map((f) => f.column)).toEqual([
      "id", "crew_id", "destination", "cargo_tons",
    ]);
  });

  it("reports no gap when a row type mirrors its table exactly", () => {
    const voyages = g.entities.find((e) => e.name === "voyages")!;
    const row = g.shapes.find((s) => s.name === "VoyageRow")!;
    expect(drift(voyages, row).entityOnly).toEqual([]);
    expect(drift(voyages, row).shapeOnly).toEqual([]);
  });
});

describe("the ds question bank", () => {
  const questions = [...generateDsMcq(g, 99), ...generateDsCloze(g, 99)];

  it("asks about drift in both directions", () => {
    const generators = new Set(questions.map((q) => q.generator));
    expect(generators.has("field-drift")).toBe(true);
    expect(generators.has("dto-only-field")).toBe(true);
  });

  it("fires every ds generator against this fixture", () => {
    // The fixture exists to exercise all of them; a generator that stops
    // producing here would otherwise fail silently.
    expect([...new Set(questions.map((q) => q.generator))].sort()).toEqual([
      "column-type",
      "discriminator",
      "dto-only-field",
      "field-collection",
      "field-drift",
      "field-optional",
      "field-type",
      "not-a-member",
    ]);
  });

  it("passes the selftest gate", () => {
    expect(questions.length).toBeGreaterThan(10);
    expect(questions.every((q) => q.section === "ds")).toBe(true);
    expect(selftest(questions)).toEqual([]);
  });

  it("is deterministic", () => {
    const again = [...generateDsMcq(g, 99), ...generateDsCloze(g, 99)];
    expect(again.map((q) => q.id)).toEqual(questions.map((q) => q.id));
    expect(JSON.stringify(again)).toEqual(JSON.stringify(questions));
  });
});

describe("choosing a reader", () => {
  it("recognizes each fixture for what it is", () => {
    expect(detectProvider(MINI_NODE)).toBe("sqlite-ddl");
    expect(detectProvider(MINI_EFCORE)).toBe("efcore");
  });

  it("returns an empty graph with a warning for a repo it cannot read", () => {
    const nothing = extract(NOT_A_PROJECT);
    expect(nothing.provider).toBe("none");
    expect(nothing.entities).toEqual([]);
    expect(nothing.warnings.length).toBeGreaterThan(0);
  });

  it("reads a directory with no TypeScript at all without throwing", () => {
    // The negative case, hermetically: mini-efcore has zero .ts files.
    const empty = extractNode(MINI_EFCORE);
    expect(empty.entities).toEqual([]);
    expect(empty.shapes).toEqual([]);
    expect(empty.routes).toEqual([]);
  });
});
