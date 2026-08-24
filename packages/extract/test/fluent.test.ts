import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCSharp } from "../src/csharp/structure.js";
import { chainsOf, entityConfigs, lambdaMembers, enumMemberArg } from "../src/csharp/fluent.js";

import { corpusRepo, type CorpusFluentExpect } from "../../../test/fixtures.js";

const repoA = corpusRepo("repoA");
const repoB = corpusRepo("repoB");

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

// Note: vitest executes even a skipped describe body during collection, so
// everything at describe scope must tolerate an absent corpus.
describe.skipIf(!repoA || !repoB)("EF fluent chains [corpus]", () => {
  const a: CorpusFluentExpect = repoA?.expect.fluent ?? {};
  const b: CorpusFluentExpect = repoB?.expect.fluent ?? {};
  const aContext = `${repoA?.path}/${a.contextFile}`;
  const bContext = `${repoB?.path}/${b.contextFile}`;

  it("parses multi-line relationship chains in the flat-style repo", () => {
    const chains = contextChains(aContext, a.contextType!);

    const rel = chains.filter((c) => c.calls.some((x) => x.name === "HasForeignKey"));
    expect(rel.length).toBeGreaterThanOrEqual(a.minRelationChains!);

    const chain = rel.find(
      (c) => c.calls[0]!.name === "Entity" && c.calls[0]!.typeArgs[0] === a.relChain!.entity,
    )!;
    expect(chain.calls.map((c) => c.name)).toEqual([
      "Entity", "HasOne", "WithMany", "HasForeignKey",
    ]);
    expect(lambdaMembers(chain.calls[1]!.args)).toEqual(a.relChain!.hasOne);
    expect(lambdaMembers(chain.calls[2]!.args)).toEqual(a.relChain!.withMany);
    expect(lambdaMembers(chain.calls[3]!.args)).toEqual(a.relChain!.foreignKey);
  });

  it("reads a composite key from an anonymous-object lambda", () => {
    const chains = contextChains(aContext, a.contextType!);
    const hasKey = chains.find((c) => c.calls.some((x) => x.name === "HasKey"))!;
    expect(hasKey.calls[0]!.typeArgs[0]).toBe(a.compositeKey!.entity);
    const key = hasKey.calls.find((c) => c.name === "HasKey")!;
    expect(lambdaMembers(key.args)).toEqual(a.compositeKey!.members);
  });

  it("reads composite unique indexes", () => {
    const chains = contextChains(aContext, a.contextType!);
    const idx = chains.filter((c) => c.calls.some((x) => x.name === "HasIndex"));
    expect(idx.length).toBeGreaterThanOrEqual(a.minIndexes!);
    const unique = idx.find((c) => c.calls[0]!.typeArgs[0] === a.uniqueIndex!.entity)!;
    expect(lambdaMembers(unique.calls.find((c) => c.name === "HasIndex")!.args))
      .toEqual(a.uniqueIndex!.members);
    expect(unique.calls.some((c) => c.name === "IsUnique")).toBe(true);
  });

  it("reads explicit OnDelete behavior in the nested-style repo", () => {
    const chains = contextConfigs(bContext, b.contextType!);
    const withDelete = chains.filter((c) => c.calls.some((x) => x.name === "OnDelete"));
    expect(withDelete).toHaveLength(b.onDelete!.count);
    for (const c of withDelete) {
      const call = c.calls.find((x) => x.name === "OnDelete")!;
      expect(enumMemberArg(call.args)).toBe(b.onDelete!.behavior);
    }
  });
});
