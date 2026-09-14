import { describe, it, expect } from "vitest";
import { extractDotnet } from "@psq/extract";
import type { EntityGraph } from "@psq/schema";
import { searchEntities, MATCH_FIELDS } from "../src/index.js";
import { MINI_EFCORE, MINI_EFCORE_EMPTY_CONTEXT } from "../../../test/fixtures.js";

// Every graph here is EXTRACTED, never a hand-written EntityGraph literal: a
// literal would encode whatever the author believed about the schema (which
// fields are nullable, what a tableName looks like) in both the code and the
// test, so the two would agree while both were wrong.
//
// MINI_EFCORE yields exactly 5 entities, one Student, from Models/Entities/.
// `Models/Student.cs` beside it is a deliberate stale duplicate; nothing here
// may walk `Models/` directly.
const g = extractDotnet(MINI_EFCORE);

/** The hit for one entity, or undefined. Hits are unique by entity name. */
function hitFor(hits: ReturnType<typeof searchEntities>, name: string) {
  return hits.find((h) => h.name === name);
}

describe("searchEntities — matching", () => {
  // H1
  it("finds an entity through a property name", () => {
    // Fact 1: nothing in the corpus is NAMED *Email*; "Email" exists only as a
    // property. Restricting search to entity names answers the motivating
    // example with an empty list, so property matching is the point.
    const hits = searchEntities(g, "email");
    expect(hits.map((h) => h.name)).toEqual(["Student"]);
    // H1b/H1c/H1d — assert the WHOLE hit, not just name + reasons.
    // `tableName`, `namespace` and `file` are carried straight through from the
    // entity and were previously ungated: `EntitySearchResult.safeParse` cannot
    // catch a wrong value, because `file`/`tableName` are `z.string()` (so `""`
    // parses) and `namespace` is `.nullable()` (so `null` parses). `file` is the
    // field H-b navigates on, so a silently empty one would ship.
    expect(hits[0]).toEqual({
      name: "Student",
      tableName: "Students",
      namespace: "Mini.Api.Models.Entities",
      file: "Models/Entities/Student.cs",
      reasons: [{ field: "propertyName", matched: "Email", property: "Email" }],
    });
  });

  // H2
  it("is case-insensitive in both directions", () => {
    const shouting = searchEntities(g, "EMAIL");
    const alternating = searchEntities(g, "EmAiL");
    const plain = searchEntities(g, "email");
    expect(shouting).toEqual(plain);
    expect(alternating).toEqual(plain);
    // The reported string is the RAW declared one, never the lowercased needle.
    expect(shouting[0]!.reasons[0]!.matched).toBe("Email");
  });

  // H3
  it("matches a substring, not just a prefix", () => {
    const hits = searchEntities(g, "mail");
    expect(hits.map((h) => h.name)).toEqual(["Student"]);
    expect(hits[0]!.reasons[0]!.matched).toBe("Email");
  });

  // H4
  it("finds an entity through its table name alone", () => {
    // Hermetic by construction: MINI_EFCORE's table names are all dbSetName
    // derived, so Student's table is "Students" — and "Student" does not
    // contain "students", which makes this a tableName-ONLY reason.
    const hits = searchEntities(g, "students");
    const student = hitFor(hits, "Student");
    expect(student).toBeDefined();
    expect(student!.reasons).toEqual([
      { field: "tableName", matched: "Students", property: null },
    ]);
    // Advisor's `Students` navigation matches too, on a lower-ranked field.
    expect(hits.map((h) => h.name)).toEqual(["Student", "Advisor"]);
  });

  // H6
  it("yields one hit per entity, carrying every reason", () => {
    // "ent" matches Student's name, its table name AND its `Enrollments`
    // property. Three reasons, one hit — not three hits.
    const hits = searchEntities(g, "ent");
    expect(hits.filter((h) => h.name === "Student")).toHaveLength(1);
    expect(hitFor(hits, "Student")!.reasons).toEqual([
      { field: "entityName", matched: "Student", property: null },
      { field: "tableName", matched: "Students", property: null },
      { field: "propertyName", matched: "Enrollments", property: "Enrollments" },
    ]);
    // Every entity appears at most once, across the whole result.
    expect(new Set(hits.map((h) => h.name)).size).toBe(hits.length);
  });

  // H7
  it("returns nothing for an empty or whitespace query", () => {
    // Precondition: without entities this gate would pass on an empty graph
    // and prove nothing.
    expect(g.entities.length).toBeGreaterThan(0);
    expect(searchEntities(g, "")).toEqual([]);
    expect(searchEntities(g, "   ")).toEqual([]);
    // H7b — positive control for `query.trim()`. The two assertions above are
    // negative gates: they pass by finding nothing, and pass identically with
    // the trim deleted, because no declared string in MINI_EFCORE contains
    // three consecutive spaces. This one fails without the trim.
    expect(searchEntities(g, "  email  ").map((h) => h.name)).toEqual(["Student"]);
  });

  it("reports the fields it searched, and shapes are not among them", () => {
    expect([...MATCH_FIELDS]).toEqual(["entityName", "tableName", "propertyName"]);
  });
});

describe("searchEntities — determinism", () => {
  /** Same graph, entities listed backwards. */
  function reversedEntities(graph: EntityGraph): EntityGraph {
    const copy = structuredClone(graph);
    copy.entities.reverse();
    return copy;
  }

  // H9a
  it("orders hits independently of the order entities are listed in", () => {
    const forward = searchEntities(g, "ent");
    const backward = searchEntities(reversedEntities(g), "ent");
    // More than one hit shares the top rank, so a rank-only sort would let the
    // input order through.
    expect(forward.length).toBeGreaterThan(2);
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
    // H9d — pin the ORDER, not just forward/backward stability. `compareHits`
    // ranks a hit by its MINIMUM rank (`reasons[0]`, valid because reasons are
    // sorted first). Ranking by the maximum instead keeps forward === backward
    // and would slip past the assertion above, while visibly reordering output
    // to [Department, Advisor, Course, Enrollment, Student].
    expect(forward.map((h) => h.name)).toEqual([
      "Department",
      "Enrollment",
      "Student",
      "Advisor",
      "Course",
    ]);
  });

  // H9b
  it("orders reasons independently of the order properties are listed in", () => {
    const shuffled = structuredClone(g);
    const enrollment = shuffled.entities.find((e) => e.name === "Enrollment")!;
    enrollment.properties.reverse();

    const forward = searchEntities(g, "student");
    const backward = searchEntities(shuffled, "student");
    // Enrollment matches on two properties, so `properties[]` order is visible.
    expect(hitFor(forward, "Enrollment")!.reasons).toEqual([
      { field: "propertyName", matched: "Student", property: "Student" },
      { field: "propertyName", matched: "StudentId", property: "StudentId" },
    ]);
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  // H9c
  it("orders names by code unit, so NFC and NFD spellings cannot tie", () => {
    const NFC = "Caf\u00e9Menu";
    const NFD = "Cafe\u0301Menu";
    expect(NFC).not.toBe(NFD);
    expect(NFC.normalize("NFC")).toBe(NFD.normalize("NFC"));
    // `localeCompare` returns 0 for these two on this repo's node. A
    // comparator returning 0 leaves V8's stable sort holding the INPUT order,
    // so the input MUST be NFC-first: an NFD-first fixture makes both
    // comparators agree and the gate passes under its own mutant.
    expect(NFC.localeCompare(NFD)).toBe(0);

    const base = structuredClone(g.entities[0]!);
    const twins = structuredClone(g);
    twins.relations = [];
    // Identical but for the name, so nothing downstream of the name
    // comparison can break the tie for the comparator.
    twins.entities = [
      { ...structuredClone(base), name: NFC, tableName: "Menus" },
      { ...structuredClone(base), name: NFD, tableName: "Menus" },
    ];
    expect(twins.entities.map((e) => e.name)).toEqual([NFC, NFD]);

    const hits = searchEntities(twins, "caf");
    expect(hits).toHaveLength(2);
    // Code units: "e" (0x65) sorts before "é" (0xE9), so the NFD spelling
    // comes first — the reverse of the input order.
    expect(hits.map((h) => h.name)).toEqual([NFD, NFC]);
  });

  // H11
  it("handles a graph with no entities at all", () => {
    // A real 0-entity extraction, not a trimmed graph. `workspace.open` throws
    // "No entities found" before such a repo can be opened, so this path is
    // reachable at unit level only — the route is never exercised on it.
    const empty = extractDotnet(MINI_EFCORE_EMPTY_CONTEXT);
    expect(empty.entities).toHaveLength(0);
    expect(() => searchEntities(empty, "anything")).not.toThrow();
    expect(searchEntities(empty, "anything")).toEqual([]);
  });
});
