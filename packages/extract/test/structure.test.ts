import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCSharp } from "../src/csharp/structure.js";

import { corpusRepo } from "../../../test/fixtures.js";

const repoA = corpusRepo("repoA");

// Note: vitest executes even a skipped describe body during collection, so
// everything at describe scope must tolerate an absent corpus. The reads all
// happen inside the tests, which never run without it.
describe.skipIf(!repoA)("C# structural parser [corpus]", () => {
  const exp = (repoA?.expect.structure ?? {}) as import("../../../test/fixtures.js").CorpusStructureExpect;
  const root = repoA?.path ?? "";

  it("reads the Identity-derived DbContext and its expression-bodied DbSets", () => {
    const src = readFileSync(`${root}/${exp.contextFile}`, "utf8");
    const p = parseCSharp(src, exp.contextFile);

    expect(p.namespace).toBe(exp.namespace);
    expect(p.usings).toContain(exp.domainUsing);

    const ctx = p.types.find((t) => t.name === exp.contextType);
    expect(ctx).toBeDefined();
    // The base is IdentityDbContext<...>, not DbContext — matching `: DbContext`
    // alone finds nothing here.
    expect(ctx!.bases[0]).toBe(exp.contextBase);

    // Every DbSet is expression-bodied `=> Set<T>()`.
    const dbSets = ctx!.properties.filter((x) => x.type.startsWith("DbSet<"));
    expect(dbSets).toHaveLength(exp.dbSetCount);
    expect(dbSets.every((d) => d.expressionBodied)).toBe(true);
    expect(dbSets.map((d) => d.name)).toContain(exp.dbSetContains);

    // OnModelCreating must be captured with a non-empty body for fluent parsing.
    const onModel = ctx!.methods.find((m) => m.name === "OnModelCreating");
    expect(onModel).toBeDefined();
    expect(onModel!.body.length).toBeGreaterThan(100);

    expect(p.warnings).toEqual([]);
  });

  it("reads modern C# members that the 0.20 tree-sitter grammar rejects", () => {
    const src = readFileSync(`${root}/${exp.entityFile}`, "utf8");
    const p = parseCSharp(src, exp.entityFile);
    const e = p.types.find((t) => t.name === exp.entityType)!;

    const byName = (n: string) => e.properties.find((x) => x.name === n)!;

    // `required string` — C# 11
    const req = byName(exp.requiredProp.name);
    expect(req.modifiers).toContain("required");
    expect(req.type).toBe(exp.requiredProp.type);
    expect(req.attributes.map((a) => a.name)).toEqual(exp.requiredProp.attributes);
    expect(req.attributes[1]!.args).toEqual(exp.requiredProp.attrArgs);

    // nullable value type and nullable reference
    expect(byName(exp.nullableValueProp.name).type).toBe(exp.nullableValueProp.type);
    expect(byName(exp.nullableRefProp.name).type).toBe(exp.nullableRefProp.type);

    // collection expression initializer `= []` — C# 12
    expect(byName(exp.collectionProp.name).type).toBe(exp.collectionProp.type);
    expect(byName(exp.collectionProp.name).initializer).toBe(exp.collectionProp.initializer);

    // null-forgiving initializer must not swallow the next member
    for (const prop of exp.nullForgivingProps) {
      expect(byName(prop.name).type).toBe(prop.type);
    }

    expect(p.warnings).toEqual([]);
  });

  it("does not treat a static constants class as an entity shape", () => {
    const src = readFileSync(`${root}/${exp.constantsFile}`, "utf8");
    const p = parseCSharp(src, exp.constantsFile);
    for (const t of p.types) expect(t.modifiers).toContain("static");
  });
});

/**
 * Hermetic. The fixture tests cover the same ground end to end, but they
 * cannot say which half broke: an empty entity model looks identical whether
 * the header reader stopped early or the DbSet reader failed. These pin the
 * header reader itself.
 */
describe("base constructor argument lists", () => {
  it("reads the body and the full base list past `: Base(args)`", () => {
    const p = parseCSharp(
      "class C(int o) : DbContext(o), IThing { public DbSet<A> As => Set<A>(); void M(){} }",
      "T.cs",
    );
    const t = p.types[0]!;
    // Before the fix: bases ["DbContext"], properties ["o"], methods [].
    // `contextName` still resolved off that first base, which is exactly why
    // the failure was silent.
    expect(t.bases).toEqual(["DbContext", "IThing"]);
    expect(t.properties.map((x) => `${x.name}:${x.type}`)).toEqual(["o:int", "As:DbSet<A>"]);
    expect(t.methods.map((m) => m.name)).toEqual(["M"]);
    expect(p.warnings).toEqual([]);
  });

  it("does the same for a record, which is not a separate code path", () => {
    const p = parseCSharp(
      'record R(int Id) : Base(Id) { public string X { get; set; } }',
      "T.cs",
    );
    const t = p.types[0]!;
    expect(t.bases).toEqual(["Base"]);
    expect(t.properties.map((x) => x.name)).toEqual(["Id", "X"]);
    expect(p.warnings).toEqual([]);
  });

  it("leaves a correctly terminated bodyless declaration silent", () => {
    const p = parseCSharp("record R(int Id) : Base(Id);", "T.cs");
    expect(p.types[0]!.properties.map((x) => x.name)).toEqual(["Id"]);
    expect(p.warnings).toEqual([]);
  });

  it("keeps `abstract` in modifiers, which the zero-entity warning reads", () => {
    // dotnet.ts skips the zero-entity warning for an abstract context; that
    // depends on this modifier surviving the header reader.
    const p = parseCSharp("abstract class BaseContext : DbContext { }", "T.cs");
    expect(p.types[0]!.modifiers).toContain("abstract");
    expect(p.warnings).toEqual([]);
  });
});

describe("unterminated type headers", () => {
  it("warns instead of emitting a truncated type silently", () => {
    // `global::` is valid C# the reader does not consume. It stops at the
    // `::`, so the body is never entered.
    const p = parseCSharp(
      "class C : global::N.Base { public int X { get; set; } public int Y { get; set; } }",
      "T.cs",
    );
    expect(p.types[0]!.properties).toEqual([]);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toContain("type C header not terminated");
    expect(p.warnings[0]).toContain("stopped at '::'");
  });

  it("also catches a base whose generic arguments close with `>>`", () => {
    const p = parseCSharp(
      "class C : Dictionary<string, List<int>> { public int X { get; set; } }",
      "T.cs",
    );
    expect(p.warnings.some((w) => /header not terminated/.test(w))).toBe(true);
  });
});
