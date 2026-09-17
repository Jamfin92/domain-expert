import { describe, it, expect } from "vitest";
import { extractDotnet } from "@psq/extract";
import { refsFor } from "../src/index.js";
import { MINI_EFCORE_REFS } from "../../../test/fixtures.js";

// EXTRACTED, never a hand-written EntityGraph literal — the convention
// `search.test.ts:7-10` documents deliberately. A literal encodes what the
// author believed about the payload in both the code and the test, so the two
// agree while both are wrong.
//
// mini-efcore-refs yields exactly two entities (Course, Student) and 20 refs.
// Measured on this tree: Course carries 11 and Student 9, and BOTH carry both
// vias — which is what makes G28 and G29 reachable at all.
const g = extractDotnet(MINI_EFCORE_REFS);

/** Compact, order-sensitive rendering of a ref list. */
const at = (rs: ReturnType<typeof refsFor>): string[] => rs.map((r) => `${r.file}:${r.line}`);

describe("G24: refsFor filters to the named entity", () => {
  it("returns that entity's refs and no others", () => {
    const course = refsFor(g, "Course");
    expect(course.length).toBe(11);
    expect([...new Set(course.map((r) => r.entity))]).toEqual(["Course"]);
    // The positive control, in the same graph and the same run: the refs that
    // were filtered OUT exist. Without it a walker emitting only Course refs
    // would pass the assertions above for the wrong reason.
    expect(g.entityRefs.length).toBe(20);
    expect(refsFor(g, "Student").length).toBe(9);
  });
});

describe("G25: the match is exact and case-sensitive", () => {
  it("`student` finds nothing while `Student` finds nine", () => {
    // The negative half is paired with its positive control in one `it` on
    // purpose: "[] " is also what a broken selector returns for everything.
    expect(refsFor(g, "student")).toEqual([]);
    expect(refsFor(g, "STUDENT")).toEqual([]);
    expect(refsFor(g, "Student").length).toBe(9);
  });
});

describe("G26: an entity the graph has never heard of", () => {
  it("returns [], matching relationsOf's precedent", () => {
    // DOCUMENTATION, not a gated claim, and recorded as such: G25's negative
    // half already exercises the unknown-name path, so this test has no mutant
    // of its own. It is here because the empty answer is part of the contract
    // the route's `known` flag exists to disambiguate (D-Hb2-4), and a reader
    // should find it stated rather than inferred.
    expect(g.entities.map((e) => e.name)).toEqual(["Course", "Student"]);
    expect(refsFor(g, "Enrollment")).toEqual([]);
    expect(refsFor(g, "")).toEqual([]);
  });
});

describe("G27: order is inherited from the graph, never re-sorted", () => {
  it("comes out in the walker's order, which is not sorted by file or line", () => {
    // Pinned as a literal sequence rather than compared against a filter of
    // `entityRefs`, which would just restate the implementation. The sequence
    // is deliberately non-monotonic in `line` (55 then 18 then 15), so any
    // re-sort — including a reverse — moves it.
    expect(at(refsFor(g, "Course"))).toEqual([
      "Controllers/CoursesController.cs:20",
      "Controllers/CoursesController.cs:35",
      "Controllers/CoursesController.cs:35",
      "Controllers/CoursesController.cs:47",
      "Controllers/CoursesController.cs:47",
      "Controllers/CoursesController.cs:55",
      "Data/RefsDbContext.cs:18",
      "Services/EnrollmentService.cs:15",
      "Services/EnrollmentService.cs:24",
      "Services/EnrollmentService.cs:55",
      "_Stale/Student.cs:41",
    ]);
  });
});

describe("G28: opts.via filters", () => {
  it("each via returns its own rows, and the two partition the whole list", () => {
    const entityName = refsFor(g, "Course", { via: "entityName" });
    const dbSetName = refsFor(g, "Course", { via: "dbSetName" });
    expect(at(dbSetName)).toEqual(["Services/EnrollmentService.cs:15"]);
    expect([...new Set(dbSetName.map((r) => r.via))]).toEqual(["dbSetName"]);
    // Both halves non-empty: a filter that returned nothing would satisfy a
    // one-sided assertion.
    expect(entityName.length).toBe(10);
    expect([...new Set(entityName.map((r) => r.via))]).toEqual(["entityName"]);
    expect(entityName.length + dbSetName.length).toBe(refsFor(g, "Course").length);
  });
});

describe("G29: an omitted via means BOTH vias, not neither", () => {
  it("refsFor with no opts returns the rows of both vias", () => {
    // The trap this gates: writing the predicate as `r.via === opts?.via`
    // compares every row against `undefined` when no via was asked for, and
    // returns [].
    //
    // MEASURED, suite-wide, not predicted: that mutant reddens SIX tests —
    // G24, G25, G27, G28 and G29 in this file, plus G30 in
    // `apps/server/test/api.test.ts`. It is subsumed: every no-`via` lookup in
    // this file empties at once, so no mutant reddens G29 alone. G28 does have
    // a mutant that singles it out in this file (ignore `opts.via`, which
    // reddens G28 here and nothing else here); G29 has none, so G29 is
    // DOCUMENTATION of the contract, in the same category as G26 — keep it,
    // but do not count it as an independent gate.
    //
    // G28's third assertion — the partition control, `refs.test.ts:87` — is
    // one of the six, and it stays. Deleting a positive control to make a
    // predicted failure set come true weakens the gate; the overlap is the
    // finding, not a defect to tidy away.
    const both = refsFor(g, "Student");
    expect([...new Set(both.map((r) => r.via))].sort()).toEqual(["dbSetName", "entityName"]);
    expect(both.length).toBe(9);
    expect(refsFor(g, "Student", undefined).length).toBe(9);
    expect(refsFor(g, "Student", {}).length).toBe(9);
  });
});
