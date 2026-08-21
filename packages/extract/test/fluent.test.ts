import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCSharp } from "../src/csharp/structure.js";
import { chainsOf, entityConfigs, lambdaMembers, enumMemberArg } from "../src/csharp/fluent.js";

import { CORPUS, hasCorpus } from "../../../test/fixtures.js";

const PP = CORPUS.corpus-repo-a;
const BI = CORPUS.corpus-repo-b;

function contextConfigs(file: string, typeName: string) {
  const p = parseCSharp(readFileSync(file, "utf8"), file);
  const ctx = p.types.find((t) => t.name === typeName)!;
  const onModel = ctx.methods.find((m) => m.name === "OnModelCreating")!;
  return entityConfigs(onModel.body);
}

function contextChains(file: string, typeName: string) {
  const p = parseCSharp(readFileSync(file, "utf8"), file);
  const ctx = p.types.find((t) => t.name === typeName)!;
  const onModel = ctx.methods.find((m) => m.name === "OnModelCreating")!;
  return chainsOf(onModel.body);
}

describe.skipIf(!hasCorpus(PP) || !hasCorpus(BI))("EF fluent chains [corpus]", () => {
  it("parses multi-line relationship chains in corpus-repo-a", () => {
    const chains = contextChains(`${PP}/Data/AppDbContext.cs`, "AppDbContext");

    const rel = chains.filter((c) => c.calls.some((x) => x.name === "HasForeignKey"));
    expect(rel.length).toBeGreaterThanOrEqual(15);

    const dept = rel.find(
      (c) => c.calls[0]!.name === "Entity" && c.calls[0]!.typeArgs[0] === "Department",
    )!;
    expect(dept.calls.map((c) => c.name)).toEqual([
      "Entity", "HasOne", "WithMany", "HasForeignKey",
    ]);
    expect(lambdaMembers(dept.calls[1]!.args)).toEqual(["County"]);
    expect(lambdaMembers(dept.calls[2]!.args)).toEqual(["Departments"]);
    expect(lambdaMembers(dept.calls[3]!.args)).toEqual(["CountyId"]);
  });

  it("reads a composite key from an anonymous-object lambda", () => {
    const chains = contextChains(`${PP}/Data/AppDbContext.cs`, "AppDbContext");
    const hasKey = chains.find((c) => c.calls.some((x) => x.name === "HasKey"))!;
    expect(hasKey.calls[0]!.typeArgs[0]).toBe("UserCounty");
    const key = hasKey.calls.find((c) => c.name === "HasKey")!;
    expect(lambdaMembers(key.args)).toEqual(["UserId", "CountyId"]);
  });

  it("reads composite unique indexes", () => {
    const chains = contextChains(`${PP}/Data/AppDbContext.cs`, "AppDbContext");
    const idx = chains.filter((c) => c.calls.some((x) => x.name === "HasIndex"));
    expect(idx.length).toBeGreaterThanOrEqual(3);
    const dept = idx.find((c) => c.calls[0]!.typeArgs[0] === "Department")!;
    expect(lambdaMembers(dept.calls.find((c) => c.name === "HasIndex")!.args)).toEqual([
      "CountyId", "Slug",
    ]);
    expect(dept.calls.some((c) => c.name === "IsUnique")).toBe(true);
  });

  it("reads explicit OnDelete behavior in corpus-repo-b (nested style)", () => {
    const chains = contextConfigs(`${BI}/Data/DebtTrackerDbContext.cs`, "DebtTrackerDbContext");
    const withDelete = chains.filter((c) => c.calls.some((x) => x.name === "OnDelete"));
    expect(withDelete).toHaveLength(7);
    for (const c of withDelete) {
      const call = c.calls.find((x) => x.name === "OnDelete")!;
      expect(enumMemberArg(call.args)).toBe("Cascade");
    }
  });
});
