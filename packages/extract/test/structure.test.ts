import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCSharp } from "../src/csharp/structure.js";

import { CORPUS, hasCorpus } from "../../../test/fixtures.js";

const API = CORPUS.corpus-repo-a;

describe.skipIf(!hasCorpus(API))("C# structural parser [corpus]", () => {
  it("reads the Identity-derived DbContext and its expression-bodied DbSets", () => {
    const src = readFileSync(`${API}/Data/AppDbContext.cs`, "utf8");
    const p = parseCSharp(src, "Data/AppDbContext.cs");

    expect(p.namespace).toBe("corpus-repo-a.Api.Data");
    expect(p.usings).toContain("corpus-repo-a.Api.Models.Domain");

    const ctx = p.types.find((t) => t.name === "AppDbContext");
    expect(ctx).toBeDefined();
    // The base is IdentityDbContext<...>, not DbContext — matching `: DbContext`
    // alone finds nothing here.
    expect(ctx!.bases[0]).toBe("IdentityDbContext<User,IdentityRole<Guid>,Guid>");

    // All 16 DbSets are expression-bodied `=> Set<T>()`.
    const dbSets = ctx!.properties.filter((x) => x.type.startsWith("DbSet<"));
    expect(dbSets).toHaveLength(16);
    expect(dbSets.every((d) => d.expressionBodied)).toBe(true);
    expect(dbSets.map((d) => d.name)).toContain("LicenseApplications");

    // OnModelCreating must be captured with a non-empty body for fluent parsing.
    const onModel = ctx!.methods.find((m) => m.name === "OnModelCreating");
    expect(onModel).toBeDefined();
    expect(onModel!.body.length).toBeGreaterThan(100);

    expect(p.warnings).toEqual([]);
  });

  it("reads modern C# members that the 0.20 tree-sitter grammar rejects", () => {
    const src = readFileSync(`${API}/Models/Domain/LicenseApplication.cs`, "utf8");
    const p = parseCSharp(src, "Models/Domain/LicenseApplication.cs");
    const e = p.types.find((t) => t.name === "LicenseApplication")!;

    const byName = (n: string) => e.properties.find((x) => x.name === n)!;

    // `required string` — C# 11
    expect(byName("ConfirmationNumber").modifiers).toContain("required");
    expect(byName("ConfirmationNumber").type).toBe("string");
    expect(byName("ConfirmationNumber").attributes.map((a) => a.name)).toEqual([
      "Required",
      "MaxLength",
    ]);
    expect(byName("ConfirmationNumber").attributes[1]!.args).toEqual(["20"]);

    // nullable value type and nullable reference
    expect(byName("FormTemplateId").type).toBe("int?");
    expect(byName("FormData").type).toBe("string?");

    // collection expression initializer `= []` — C# 12
    expect(byName("ApplicationDocuments").type).toBe("ICollection<ApplicationDocument>");
    expect(byName("ApplicationDocuments").initializer).toBe("[ ]");

    // null-forgiving initializer must not swallow the next member
    expect(byName("User").type).toBe("User");
    expect(byName("LicenseType").type).toBe("LicenseType");

    expect(p.warnings).toEqual([]);
  });

  it("does not treat a static constants class as an entity shape", () => {
    const src = readFileSync(`${API}/Models/Domain/FormTemplateStatus.cs`, "utf8");
    const p = parseCSharp(src, "Models/Domain/FormTemplateStatus.cs");
    for (const t of p.types) expect(t.modifiers).toContain("static");
  });
});
