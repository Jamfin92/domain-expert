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
