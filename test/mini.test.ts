import { describe, it, expect } from "vitest";
import { extractDotnet } from "@psq/extract";
import { invariants } from "@psq/graph";
import { generateEntityMcq, selftest } from "@psq/quiz";
import { MINI_EFCORE } from "./fixtures.js";

/**
 * Hermetic end-to-end coverage. Everything here lives in this repo, so the
 * suite passes on a clean checkout with no other project present.
 */
describe("mini EF fixture", () => {
  const g = extractDotnet(MINI_EFCORE);

  it("extracts a clean graph", () => {
    expect(g.contextName).toBe("MiniDbContext");
    expect(g.warnings).toEqual([]);
    expect(invariants(g)).toEqual([]);
  });

  it("resolves DbSet types through the context's usings, not by class name", () => {
    // Models/Student.cs is a stale duplicate in a namespace the context does
    // not import. Picking it would give Student the wrong properties entirely.
    expect(g.entities).toHaveLength(5);
    const student = g.entities.find((e) => e.name === "Student")!;
    expect(student.namespace).toBe("Mini.Api.Models.Entities");
    expect(student.properties.map((p) => p.name)).toContain("Gpa");
    expect(student.properties.map((p) => p.name)).not.toContain("LegacyNotes");
  });

  it("reads both DbSet property forms", () => {
    const sets = new Map(g.entities.map((e) => [e.name, e.dbSetName]));
    expect(sets.get("Student")).toBe("Students"); // => Set<Student>()
    expect(sets.get("Department")).toBe("Departments"); // { get; set; }
  });

  it("reads the composite key on the join entity", () => {
    expect(g.entities.find((e) => e.name === "Enrollment")!.keys).toEqual([
      "StudentId", "CourseId",
    ]);
  });

  it("reads both fluent styles and keeps their delete rules apart", () => {
    const byId = new Map(g.relations.map((r) => [`${r.dependent}->${r.principal}`, r]));
    // nested style
    expect(byId.get("Enrollment->Student")!.deleteBehavior).toBe("Cascade");
    expect(byId.get("Enrollment->Course")!.deleteBehavior).toBe("Restrict");
    expect(byId.get("Enrollment->Course")!.deleteBehaviorSource).toBe("fluent");
    // flat style
    expect(byId.get("Course->Department")!.cardinality).toBe("one-to-many");
    expect(byId.get("Course->Department")!.principalNavigation).toBe("Courses");
  });

  it("honors IsRequired(false) rather than treating the call as required", () => {
    const advisor = g.relations.find(
      (r) => r.dependent === "Student" && r.principal === "Advisor",
    )!;
    expect(advisor.required).toBe(false);
    expect(advisor.deleteBehavior).toBe("ClientSetNull");
  });

  it("reads precision, max length and unique indexes", () => {
    const student = g.entities.find((e) => e.name === "Student")!;
    expect(student.properties.find((p) => p.name === "Gpa")!.precision).toEqual([3, 2]);
    expect(student.properties.find((p) => p.name === "Name")!.maxLength).toBe(80);
    expect(student.indexes.some((i) => i.isUnique && i.properties[0] === "Email")).toBe(true);
    const course = g.entities.find((e) => e.name === "Course")!;
    expect(course.indexes.some((i) => i.isUnique && i.properties[0] === "Code")).toBe(true);
  });

  it("survives an interpolated raw string containing braces", () => {
    // $$"""...{{"in"}}...""" unbalances every following brace if the lexer
    // checks $" before """. The clean parse above is the real assertion; this
    // pins the specific construct.
    const ctxFile = g.entities[0]!.file;
    expect(ctxFile.length).toBeGreaterThan(0);
    expect(g.warnings).toEqual([]);
  });

  it("generates a question bank that passes the selftest gate", () => {
    const qs = generateEntityMcq(g, 99);
    expect(qs.length).toBeGreaterThan(15);
    expect(selftest(qs)).toEqual([]);
  });
});
