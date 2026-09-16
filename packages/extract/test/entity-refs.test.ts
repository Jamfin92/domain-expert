import { describe, it, expect } from "vitest";
import type { EntityRef } from "@psq/schema";
import { extractDotnet } from "../src/dotnet.js";
import { MINI_EFCORE, MINI_EFCORE_REFS } from "../../../test/fixtures.js";

// `extractDotnet` imported directly rather than through `../src/index.js`,
// the idiom `merge.test.ts:6` and `dotnet.test.ts:2` already use.

const graph = extractDotnet(MINI_EFCORE_REFS);
const refs = graph.entityRefs;

const STUDENTS = "Controllers/StudentsController.cs";
const COURSES = "Controllers/CoursesController.cs";

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
  //       (`Create` is declared on line 10 and its ref is on 16)
  //   G9  `file` is the REFERENCING file, not `Entity.file`
  //       (every `Student` ref below, none of which is `Models/Student.cs`)
  //   G10 two mentions on two lines are two refs (Pair, 22 and 24)
  //   G11 two mentions on one line are one ref (Pair line 22 holds two)
  //   G16 `via` is `dbSetName` only for a `.`-preceded DbSet match
  //   G17 the order, code-unit only, with both tie-breaking keys exercised:
  //       StudentsController:16 ties on entity+file+line and separates on
  //       `via`; CoursesController:28 ties on entity+file+line+via and
  //       separates on `method`.
  it("is exactly this, in exactly this order", () => {
    const expected: EntityRef[] = [
      { entity: "Course", file: COURSES, line: 20, type: "CoursesController", method: "Slug", via: "entityName" },
      { entity: "Course", file: COURSES, line: 28, type: "CoursesController", method: "Left", via: "entityName" },
      { entity: "Course", file: COURSES, line: 28, type: "CoursesController", method: "Right", via: "entityName" },
      { entity: "Course", file: "Data/RefsDbContext.cs", line: 18, type: "RefsDbContext", method: "SeedFirstCourse", via: "entityName" },
      { entity: "Course", file: "Services/EnrollmentService.cs", line: 15, type: "EnrollmentService", method: "Enroll", via: "dbSetName" },
      { entity: "Student", file: STUDENTS, line: 16, type: "StudentsController", method: "Create", via: "dbSetName" },
      { entity: "Student", file: STUDENTS, line: 16, type: "StudentsController", method: "Create", via: "entityName" },
      { entity: "Student", file: STUDENTS, line: 22, type: "StudentsController", method: "Pair", via: "entityName" },
      { entity: "Student", file: STUDENTS, line: 24, type: "StudentsController", method: "Pair", via: "entityName" },
      { entity: "Student", file: STUDENTS, line: 47, type: "StudentsController", method: "Locals", via: "entityName" },
      { entity: "Student", file: STUDENTS, line: 48, type: "StudentsController", method: "Locals", via: "dbSetName" },
      { entity: "Student", file: "Services/EnrollmentService.cs", line: 14, type: "EnrollmentService", method: "Enroll", via: "entityName" },
      { entity: "Student", file: "Stale/Student.cs", line: 17, type: "Student", method: "Touch", via: "entityName" },
    ];
    expect(refs).toEqual(expected);
  });

  // G17's two keys, stated separately from the array so a future edit that
  // deletes either tie from the fixture fails HERE, naming the reason, rather
  // than only shifting one row of the diff above. A sort key with no tie in
  // the input is unreachable code, and the plan's own rule is that unreachable
  // keys are deleted from the comparator, not written and left ungated.
  it("the fixture really does tie on entity+file+line, so the `via` key is reachable", () => {
    const tie = refs.filter((r) => r.entity === "Student" && r.file === STUDENTS && r.line === 16);
    expect(tie.map((r) => r.via)).toEqual(["dbSetName", "entityName"]);
  });

  it("and on entity+file+line+via, so the `method` key is reachable", () => {
    const tie = refs.filter((r) => r.entity === "Course" && r.file === COURSES && r.line === 28);
    expect(tie.map((r) => r.via)).toEqual(["entityName", "entityName"]);
    expect(tie.map((r) => r.method)).toEqual(["Left", "Right"]);
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
  it("no ref names it, while another method on the same class does contribute", () => {
    expect(refs.filter((r) => r.method === "OnModelCreating")).toEqual([]);
    // The control has to be on RefsDbContext itself: "no OnModelCreating ref"
    // is equally true of a walker that skips the whole context type.
    expect(refs.filter((r) => r.type === "RefsDbContext").map((r) => r.method))
      .toEqual(["SeedFirstCourse"]);
  });
});

describe("G12: the match is exact and case-sensitive", () => {
  it("the local `student` on line 43 yields nothing; `Student` on 47 does", () => {
    const inLocals = refs.filter((r) => r.file === STUDENTS && r.method === "Locals");
    expect(inLocals.map((r) => r.line)).toEqual([47, 48]);
  });
});

describe("G13: a dbSetName match requires a preceding `.`", () => {
  it("the local `Students` on line 45 yields nothing; `_db.Students` on 48 does", () => {
    const dbSet = refs.filter((r) => r.file === STUDENTS && r.via === "dbSetName");
    expect(dbSet.map((r) => r.line)).toEqual([16, 48]);
    // Line 45 declares `int Students` and line 49 names it again; neither is
    // preceded by a `.`, and neither appears above.
  });
});

describe("G14: equality, not substring — which is also what keeps literals out", () => {
  it("`StudentDto`, \"Student\" and $\"{Student}\" all yield nothing", () => {
    // Lines 34, 35 and 36 of StudentsController. The string cases are not a
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
    expect(refs.filter((r) => r.file === "Stale/Student.cs")).toEqual([
      { entity: "Student", file: "Stale/Student.cs", line: 17, type: "Student", method: "Touch", via: "entityName" },
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
    expect(refs.length).toBe(13);
  });
});
