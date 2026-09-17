import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EntityRef } from "@psq/schema";
import { extractDotnet } from "../src/dotnet.js";
import { MINI_EFCORE, MINI_EFCORE_REFS } from "../../../test/fixtures.js";

// `extractDotnet` imported directly rather than through `../src/index.js`,
// the idiom `merge.test.ts:6` and `dotnet.test.ts:2` already use.

const graph = extractDotnet(MINI_EFCORE_REFS);
const refs = graph.entityRefs;

const STUDENTS = "Controllers/StudentsController.cs";
const COURSES = "Controllers/CoursesController.cs";
const STALE = "_Stale/Student.cs";
const SERVICE = "Services/EnrollmentService.cs";

/**
 * `Dup.Sync` is declared at this line in BOTH `COURSES` and `SERVICE`, which
 * is the only way two refs can tie on everything except `file`. The equality
 * of the two line numbers is the gate; the value itself is arbitrary.
 */
const DUP_LINE = 55;

/**
 * The fixture's shape, pinned. If any of these move, a gate below is reading
 * a different repo than the one it was written against and its "yields
 * nothing" assertions stop meaning anything.
 */
describe("the mini-efcore-refs fixture itself", () => {
  it("is the two-entity, warning-free graph every gate below assumes", () => {
    expect(graph.entities.map((e) => e.name)).toEqual(["Course", "Student"]);
    expect(graph.entities.map((e) => e.dbSetName)).toEqual(["Courses", "Students"]);
    expect(graph.shapes).toEqual([]);
    expect(graph.relations.map((r) => r.id)).toEqual(["Student.CourseId->Course"]);
    expect(graph.warnings).toEqual([]);
  });
});

describe("G1/G2/G3/G8/G9/G10/G11/G16/G17: the whole ordered array", () => {
  // ONE `toEqual` over the entire array, deliberately (H-a rule 4): a
  // field-by-field assertion still passes when the payload grows a field, and
  // several of the behaviours below have no other home. The cost is that they
  // all redden under one test name — read the vitest DIFF, not the name, to
  // find which one drifted.
  //
  //   G1  the array is populated at all
  //   G2  `method` is the enclosing method
  //   G3  `type` is the enclosing type
  //   G8  `line` is the matched TOKEN's line, not the method's
  //       (`Create` is declared on line 10 and its refs are on 23)
  //   G9  `file` is the REFERENCING file, not `Entity.file`
  //       (every `Student` ref below, none of which is `Models/Student.cs`)
  //   G10 two mentions on two lines are two refs (Pair, 30 and 32)
  //   G11 two mentions on one line are one ref (Pair line 30 holds two)
  //   G16 `via` is `dbSetName` only for a `.`-preceded DbSet match
  //   G17 the order, code-unit only, with every tie-breaking key exercised:
  //       StudentsController:23 ties on entity+file+line and separates on
  //       `via`; CoursesController:35 ties on entity+file+line+via and
  //       separates on `method`; CoursesController:47 ties on everything but
  //       `type`; `Dup.Sync` at DUP_LINE in two files ties on everything but
  //       `file`; and `_Stale/` vs the letter-named
  //       directories is the one file pair ICU orders differently from code
  //       units, which is what makes the localeCompare mutant reddenable.
  it("is exactly this, in exactly this order", () => {
    const expected: EntityRef[] = [
      { entity: "Course", file: COURSES, line: 20, type: "CoursesController", method: "Slug", via: "entityName" },
      { entity: "Course", file: COURSES, line: 35, type: "CoursesController", method: "Alpha", via: "entityName" },
      { entity: "Course", file: COURSES, line: 35, type: "CoursesController", method: "Zulu", via: "entityName" },
      { entity: "Course", file: COURSES, line: 47, type: "CourseAdmin", method: "Sync", via: "entityName" },
      { entity: "Course", file: COURSES, line: 47, type: "CourseAudit", method: "Sync", via: "entityName" },
      { entity: "Course", file: COURSES, line: DUP_LINE, type: "Dup", method: "Sync", via: "entityName" },
      { entity: "Course", file: "Data/RefsDbContext.cs", line: 18, type: "RefsDbContext", method: "SeedFirstCourse", via: "entityName" },
      { entity: "Course", file: SERVICE, line: 15, type: "EnrollmentService", method: "Enroll", via: "dbSetName" },
      { entity: "Course", file: SERVICE, line: 24, type: "EnrollmentService", method: "Both", via: "entityName" },
      { entity: "Course", file: SERVICE, line: DUP_LINE, type: "Dup", method: "Sync", via: "entityName" },
      { entity: "Course", file: STALE, line: 41, type: "RefsDbContext", method: "OnModelCreating", via: "entityName" },
      { entity: "Student", file: STUDENTS, line: 23, type: "StudentsController", method: "Create", via: "dbSetName" },
      { entity: "Student", file: STUDENTS, line: 23, type: "StudentsController", method: "Create", via: "entityName" },
      { entity: "Student", file: STUDENTS, line: 30, type: "StudentsController", method: "Pair", via: "entityName" },
      { entity: "Student", file: STUDENTS, line: 32, type: "StudentsController", method: "Pair", via: "entityName" },
      { entity: "Student", file: STUDENTS, line: 55, type: "StudentsController", method: "Locals", via: "entityName" },
      { entity: "Student", file: STUDENTS, line: 56, type: "StudentsController", method: "Locals", via: "dbSetName" },
      { entity: "Student", file: SERVICE, line: 14, type: "EnrollmentService", method: "Enroll", via: "entityName" },
      { entity: "Student", file: SERVICE, line: 24, type: "EnrollmentService", method: "Both", via: "entityName" },
      { entity: "Student", file: STALE, line: 24, type: "Student", method: "Touch", via: "entityName" },
    ];
    expect(refs).toEqual(expected);
  });

  // G17's two keys, stated separately from the array so a future edit that
  // deletes either tie from the fixture fails HERE, naming the reason, rather
  // than only shifting one row of the diff above. A sort key with no tie in
  // the input is unreachable code, and the plan's own rule is that unreachable
  // keys are deleted from the comparator, not written and left ungated.
  it("the fixture really does tie on entity+file+line, so the `via` key is reachable", () => {
    const tie = refs.filter((r) => r.entity === "Student" && r.file === STUDENTS && r.line === 23);
    expect(tie.map((r) => r.via)).toEqual(["dbSetName", "entityName"]);
  });

  it("and on everything but `type`, so the `type` key is reachable", () => {
    // Two types on ONE line with same-named methods. Added in review round 1:
    // `type` was in the emitted tuple and in the dedupe key but not in the
    // comparator, so a pair like this tied completely and came out in the
    // order the walker happened to emit it. Source order is `CourseAudit`
    // then `CourseAdmin`; the comparator is what reverses them.
    const tie = refs.filter((r) => r.entity === "Course" && r.file === COURSES && r.line === 47);
    expect(tie.map((r) => r.method)).toEqual(["Sync", "Sync"]);
    expect(tie.map((r) => r.type)).toEqual(["CourseAdmin", "CourseAudit"]);
  });

  it("and on entity+file+line+via, so the `method` key is reachable", () => {
    const tie = refs.filter((r) => r.entity === "Course" && r.file === COURSES && r.line === 35);
    expect(tie.map((r) => r.via)).toEqual(["entityName", "entityName"]);
    // Source order on that line is `Zulu` then `Alpha`; the comparator is
    // the only thing that puts them the other way round.
    expect(tie.map((r) => r.method)).toEqual(["Alpha", "Zulu"]);
  });
});

describe("D-Hb-6: every component of the dedupe key", () => {
  it("two types with same-named methods on ONE line are two refs, not one", () => {
    // The dedupe key is the whole emitted tuple. Drop `type` from it and the
    // pair on CoursesController:47 collapses, losing a real fact — one of the
    // two classes stops being reported as referencing the entity at all.
    // Ungated until review round 1: deleting `ref.type` from the key left the
    // full hermetic suite green at 382/58.
    const tie = refs.filter((r) => r.file === COURSES && r.line === 47);
    expect(tie.length).toBe(2);
    expect(new Set(tie.map((r) => r.type)).size).toBe(2);
  });

  it("two DIFFERENT entities on one line are two refs, not one", () => {
    // The `entity` component, found ungated by probing all six components of
    // the key after the reviewer found `type` ungated. Same failure mode: the
    // second entity mentioned on the line stops being reported at all.
    const tie = refs.filter((r) => r.file === SERVICE && r.line === 24);
    expect(tie.map((r) => r.entity)).toEqual(["Course", "Student"]);
  });

  it("the same type, method, entity and via in TWO files are two refs", () => {
    // The `file` component, and the last one to get a mutant. Round 1 wrote it
    // off as needing a new fixture file; round 2 disproved that by building it
    // in two files this phase already edits. `Dup.Sync` sits at DUP_LINE in
    // both, so the pair ties on entity, line, type, method and via and can
    // only be separated by `file`.
    const tie = refs.filter((r) => r.line === DUP_LINE && r.type === "Dup");
    expect(tie.map((r) => r.file)).toEqual([COURSES, SERVICE]);
  });

  it("and the two Dup declarations really are on the same line", () => {
    // A DIAGNOSTIC, not a necessary gate — and round 2's comment here claimed
    // the opposite. It said drift would mean "the gate would not fail, it
    // would just stop being a gate". Measured in round 3: adding one comment
    // line above `Dup` reddens THREE tests, and two of them are not this one.
    // The whole-array pin holds `line: DUP_LINE` for both rows, and the gate
    // above filters on `r.line === DUP_LINE`, so drift fails loudly with or
    // without this test — deleting it from the suite still leaves 2 red.
    //
    // It is also NOT STRONGER than the pins it duplicates, in any case
    // measured. The regex is prefix-anchored, so reflowing `Dup`'s body onto a
    // second line keeps this green while moving the `Course` token — and that
    // reddens two OTHER tests, the array pin and the `file` gate above (which
    // filters on `r.line === DUP_LINE`, so the tie empties).
    //
    // "Not stronger in any measured case" is as far as the evidence goes, and
    // deliberately not "strictly weaker", which is false: a whitespace-only
    // edit to this line — a second space after `public` — reddens THIS test
    // alone, 1 of 20, while the lexer ignores the change so the graph and
    // both pins stay green. So it does catch one thing nothing else does.
    //
    // The everyday reason to keep it is smaller and more useful: on drift the
    // other two report a 20-row array diff and a file-list mismatch, both of
    // which read as "the walker is broken". This one names the actual cause —
    // line DUP_LINE is no longer the declaration — and sends the reader to the
    // fixture instead of the extractor.
    for (const file of [COURSES, SERVICE]) {
      const lines = readFileSync(join(MINI_EFCORE_REFS, file), "utf8").split("\n");
      expect(lines[DUP_LINE - 1]).toMatch(/^public class Dup \{ public void Sync\(\)/);
    }
  });
});

describe("G4: the walker is not controller-scoped", () => {
  it("a plain service class contributes refs, and the controllers still do", () => {
    expect(refs.filter((r) => r.type === "EnrollmentService").length).toBeGreaterThan(0);
    // The positive control. Without it, a walker that emitted nothing at all
    // would fail this test for the right reason but a scoped one could still
    // pass a service-only assertion by accident of ordering.
    expect(refs.filter((r) => r.type === "StudentsController").length).toBeGreaterThan(0);
  });
});

describe("G6: a mention outside any method body yields nothing", () => {
  it("the nav property `Course? Course` on Models/Student.cs:15 is not a ref", () => {
    expect(refs.filter((r) => r.file === "Models/Student.cs")).toEqual([]);
    // Control, in the same graph: `Course` named INSIDE a method is present.
    expect(refs.filter((r) => r.entity === "Course").length).toBeGreaterThan(0);
  });
});

describe("G7: OnModelCreating on the detected context contributes nothing", () => {
  it("no ref comes from it, while another method on the same class does contribute", () => {
    expect(refs.filter((r) => r.file === "Data/RefsDbContext.cs" && r.method === "OnModelCreating"))
      .toEqual([]);
    // The control has to be on RefsDbContext itself: "no OnModelCreating ref"
    // is equally true of a walker that skips the whole context type.
    expect(refs.filter((r) => r.file === "Data/RefsDbContext.cs").map((r) => r.method))
      .toEqual(["SeedFirstCourse"]);
  });

  it("but a gutted class merely SHARING its name is not the detected context", () => {
    // D-Hb-5 excludes one declaration, compared by object identity. Compare by
    // NAME instead and this ref disappears — and before review round 1 there
    // was no such class in the fixture, so that rewrite left the suite green.
    expect(refs.filter((r) => r.file === STALE && r.method === "OnModelCreating")).toEqual([
      { entity: "Course", file: STALE, line: 41, type: "RefsDbContext", method: "OnModelCreating", via: "entityName" },
    ]);
  });
});

describe("G12: the match is exact and case-sensitive", () => {
  it("the local `student` on line 51 yields nothing; `Student` on 55 does", () => {
    const inLocals = refs.filter((r) => r.file === STUDENTS && r.method === "Locals");
    expect(inLocals.map((r) => r.line)).toEqual([55, 56]);
  });
});

describe("G13: a dbSetName match requires a preceding `.`", () => {
  it("the local `Students` on line 53 yields nothing; `_db.Students` on 56 does", () => {
    const dbSet = refs.filter((r) => r.file === STUDENTS && r.via === "dbSetName");
    expect(dbSet.map((r) => r.line)).toEqual([23, 56]);
    // Line 53 declares `int Students` and line 57 names it again; neither is
    // preceded by a `.`, and neither appears above.
  });
});

describe("G14: equality, not substring — which is also what keeps literals out", () => {
  it("`StudentDto`, \"Student\" and $\"{Student}\" all yield nothing", () => {
    // Lines 42, 43 and 44 of StudentsController. The string cases are not a
    // separate rule: string tokens carry their delimiters, so their text can
    // never equal `Student`. A substring match reports all three.
    expect(refs.filter((r) => r.file === STUDENTS && r.method === "Names")).toEqual([]);
    // Control: an exact `Student` elsewhere in the same file is present.
    expect(refs.filter((r) => r.file === STUDENTS).length).toBe(6);
  });
});

describe("G15: a non-entity class in the repo's type index yields nothing", () => {
  it("`CourseSlug` on line 19 is not a ref; `Course` on line 20 is", () => {
    const inSlug = refs.filter((r) => r.file === COURSES && r.method === "Slug");
    expect(inSlug).toEqual([
      { entity: "Course", file: COURSES, line: 20, type: "CoursesController", method: "Slug", via: "entityName" },
    ]);
  });
});

describe("G18: `entity` is always Entity.name, and always resolves", () => {
  it("every ref names a class in graph.entities, never a DbSet property", () => {
    const names = new Set(graph.entities.map((e) => e.name));
    const setNames = new Set(graph.entities.map((e) => e.dbSetName));
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(names.has(r.entity)).toBe(true);
      // `Students`/`Courses` must never appear as an `entity`, including on
      // the `dbSetName` refs whose matched TOKEN was the property name.
      expect(setNames.has(r.entity)).toBe(false);
    }
  });
});

describe("G19: D-Hb-13 — name-keying, made visible rather than hidden", () => {
  it("a same-named class in an out-of-scope namespace IS reported", () => {
    // `Refs.Api.Stale.Student` is not the entity: `resolveType` keeps it out
    // of `graph.entities`, which is the whole reason that function exists.
    // The walker has no symbol table and reports its mention anyway. This is
    // the stated imprecision; the phase audit puts a number on its cost.
    expect(graph.entities.find((e) => e.name === "Student")!.file)
      .toBe("Models/Student.cs");
    expect(refs.filter((r) => r.file === STALE && r.type === "Student")).toEqual([
      { entity: "Student", file: STALE, line: 24, type: "Student", method: "Touch", via: "entityName" },
    ]);
    // In-scope refs are unaffected.
    expect(refs.filter((r) => r.file === STUDENTS).length).toBe(6);
  });
});

describe("G21: a repo whose only mentions are in OnModelCreating yields []", () => {
  it("mini-efcore is empty, in the same run in which mini-efcore-refs is not", () => {
    // MINI_EFCORE names Student, Course, Enrollment, Department and Advisor
    // throughout `OnModelCreating` and nowhere else that is a method body:
    // its DbSet properties are expression-bodied PROPERTIES, its navigation
    // properties are declarations, and its constructor is never captured as a
    // method at all. D-Hb-5 is the only thing standing between it and a
    // dozen refs.
    expect(extractDotnet(MINI_EFCORE).entityRefs).toEqual([]);
    // The positive control, and it must be in this same run: "[] " is also
    // what a walker that never emits anything returns.
    expect(refs.length).toBe(20);
  });
});

describe("G37: the environmental precondition that makes G17 discriminating", () => {
  it("code-unit and localeCompare order this fixture's files differently", () => {
    // G17 asserts the walker sorts by CODE UNIT. That claim is only
    // discriminating while the fixture contains a file pair the two orderings
    // disagree about — today `_Stale/` versus the letter-named directories.
    // Swap the comparator for `localeCompare` and G17 reddens; but if a future
    // edit removed the `_Stale/` rows, or a node upgrade changed ICU's
    // handling of a leading `_`, G17 would go on passing while gating nothing.
    //
    // Derived from the live ref set rather than asserted on the literal pair:
    // a hardcoded `"_Stale/Student.cs".localeCompare("Stale/Student.cs")` fires
    // on an ICU change but stays GREEN if the rows leave the fixture, which
    // disarms G17 just as completely.
    //
    // Derived from ALL refs, not the `Course` subset. G17 sorts the WHOLE ref
    // array, so the whole array is what has to stay discriminating; narrowing
    // the derivation to one entity would leave this green after an edit that
    // removed only `_Stale/Student.cs:24` (a Student row) while taking half of
    // what makes G17's sort discriminating with it.
    //
    // This does not duplicate G17 and does not desensitise it: G17's claim is
    // behavioural (what the walker emits), this one is environmental (that the
    // two orderings can be told apart at all). Measured today on node v24.19.0
    // / ICU 78.3.
    const files = refs.map((r) => r.file);
    expect(new Set(files).size).toBeGreaterThan(1);
    const byCodeUnit = [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const byLocale = [...files].sort((a, b) => a.localeCompare(b));
    expect(byCodeUnit).not.toEqual(byLocale);
    // Named, so the failure says WHICH pair went away rather than only that
    // two sorted arrays agree.
    expect(files).toContain(STALE);
  });
});
