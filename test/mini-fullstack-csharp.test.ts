import { describe, it, expect } from "vitest";
import { detectProvider, extract } from "@psq/extract";
import { invariants } from "@psq/graph";
import { generateDsMcq, generateDsCloze, generateEntityMcq, selftest } from "@psq/quiz";
import { MINI_FULLSTACK_CSHARP } from "./fixtures.js";

/**
 * A React + .NET repo read as both, end to end through the real `extract()`.
 *
 * Every assertion here runs against the merged graph, not against either
 * reader, because the merge is what this phase adds. See `fixtures.ts` for
 * what each part of the fixture is a control for.
 */
describe("a full-stack C# + React repo", () => {
  const g = extract(MINI_FULLSTACK_CSHARP);

  it("is detected as fullstack rather than as a .NET repo", () => {
    // Fails if the `hasDotnet && hasNode` branch is removed from
    // `detectProvider`: it falls back to "efcore" and the whole client half —
    // shapes, the call, the component — disappears from the graph below.
    expect(detectProvider(MINI_FULLSTACK_CSHARP)).toBe("fullstack");
    expect(g.provider).toBe("fullstack");
  });

  it("keeps the .NET entity model, contextName included", () => {
    expect(g.contextName).toBe("ShopDbContext");
    expect(g.entities.map((e) => `${e.name}@${e.file}`)).toEqual([
      "Category@server/Models/Category.cs",
      "Product@server/Models/Product.cs",
    ]);
    expect(g.relations.map((r) => r.id)).toEqual(["Product.CategoryId->Category"]);
    expect(invariants(g)).toEqual([]);
  });

  it("attributes the aliased client call to its component", () => {
    // THE control for two-root selection. Read the TypeScript side from the
    // fixture root instead of from client/ and this is the only assertion in
    // the file that fails: `components` comes back empty while the shape
    // count, the component count, the call count and every path stay
    // identical. Measured, not assumed.
    expect(
      g.clientCalls.map((c) => ({
        method: c.method,
        path: c.path,
        file: c.file,
        components: c.components,
      })),
    ).toEqual([
      {
        method: "GET",
        path: "/api/products",
        file: "client/src/services/products.ts",
        components: ["client/src/components/ProductList.tsx#ProductList"],
      },
    ]);
    expect(g.clientCalls.every((c) => c.components.length > 0)).toBe(true);
  });

  it("re-prefixes every node-side path into the merge root", () => {
    // `client/` is where the node reader ran; the merged graph must speak the
    // outer root's coordinates. A DefKey that kept the inner path would not
    // resolve against `components` below.
    expect(g.components).toEqual([
      {
        key: "client/src/components/ProductList.tsx#ProductList",
        name: "ProductList",
        file: "client/src/components/ProductList.tsx",
        line: 11,
      },
    ]);
    const keys = new Set(g.components.map((c) => c.key));
    for (const call of g.clientCalls) {
      for (const k of call.components) expect(keys.has(k)).toBe(true);
    }
    expect(g.routes).toEqual([]);
  });

  it("carries the shared DTO name twice, keyed by file", () => {
    // A name-dedupe in the merge would drop one of these and could not say
    // which. The exact multiset is asserted, so a silent dedupe fails.
    expect(g.shapes.map((s) => `${s.file}#${s.name}`)).toEqual([
      "client/src/types/product-dto.ts#CategorySummary",
      "client/src/types/product-dto.ts#ProductDto",
      "server/Dtos/ProductDto.cs#ProductDto",
    ]);
    const productDtos = g.shapes.filter((s) => s.name === "ProductDto");
    expect(productDtos).toHaveLength(2);
    expect(new Set(productDtos.map((s) => s.file)).size).toBe(2);
    // The pair is the same DTO twice: same field count, optional differing
    // only by casing. This is the cross-stack drift the merge makes
    // computable; nothing computes it yet (see the warning below).
    expect(productDtos.map((s) => s.fields.length)).toEqual([4, 4]);
    expect(productDtos.map((s) => s.fields.filter((f) => f.optional).map((f) => f.name)))
      .toEqual([["description"], ["Description"]]);
  });

  it("says exactly what it could not do, and states no wrong fact", () => {
    // Asserted as a list, not sampled: the false "no schema" warning is
    // invisible to every count-based check in this file.
    expect(g.warnings).toEqual([
      "No CREATE TABLE statement was found on the TypeScript side; this graph's schema " +
        "comes from the .NET entity model instead. psq reads a TypeScript schema from raw " +
        "DDL only; an ORM-defined schema is not read.",
      '2 shapes from the TypeScript side were not paired against the .NET entity model; ' +
        'psq pairs shapes within a stack only, so mirrors:null on a TS shape means ' +
        '"not computed", not "no mirror".',
    ]);
    // The unrewritten node warning claims this repo has no schema. It has one.
    expect(g.warnings.some((w) => /this repo has shapes but no schema/.test(w))).toBe(false);
    // Only one stack contributed entities, so the two-entity-languages warning
    // must be silent here. It is exercised from literals in merge.test.ts.
    expect(g.warnings.some((w) => /both stacks contributed entities/.test(w))).toBe(false);
    // Root selection was unambiguous: one candidate, nothing lost, no warning.
    expect(g.warnings.some((w) => /candidates below it/.test(w))).toBe(false);
  });

  it("yields a bank worth running the selftest against", () => {
    // "selftest is clean" on an empty bank is not a result. Assert the floor
    // first: questions from more than one generator, then that they grade.
    const questions = [
      ...generateEntityMcq(g, 7),
      ...generateDsMcq(g, 7),
      ...generateDsCloze(g, 7),
    ];
    expect(questions.length).toBeGreaterThanOrEqual(4);
    expect(new Set(questions.map((q) => q.generator)).size).toBeGreaterThanOrEqual(2);
    // Both ProductDto twins are asked about separately — the shared name does
    // not collapse the bank either.
    expect(questions.filter((q) => q.generator === "field-optional").length).toBe(2);

    // Clean, and that is the point: this is the hermetic guard for Phase
    // 1b-ii. `selftest` keys its cross-question answer table on the RAW prompt
    // (`selftest.ts:123-129`), and the five DS prompt sites used to name only
    // `shape.name` while keying the id on `shape.file`. The two ProductDto
    // twins therefore read as one prompt with two answers — `description` and
    // `Description`. The prompts now carry `shapeLabel()`, which appends the
    // declaring file whenever a shape name is not unique in the graph, so the
    // twins ask two distinct questions.
    //
    // The pinned prompts below are what proves the label engaged. Without them
    // an empty or collapsed bank would also make `selftest` return [].
    expect(selftest(questions)).toEqual([]);

    const optional = questions.filter((q) => q.generator === "field-optional");
    expect(optional.map((q) => q.prompt).sort()).toEqual([
      "Which field of ProductDto (client/src/types/product-dto.ts) is optional?",
      "Which field of ProductDto (server/Dtos/ProductDto.cs) is optional?",
    ]);
    // Ids are persisted keys and never changed: only the prompt text did.
    expect(optional.map((q) => q.id).sort()).toEqual([
      "ds.optional.client/src/types/product-dto.ts.ProductDto",
      "ds.optional.server/Dtos/ProductDto.cs.ProductDto",
    ]);
  });
});
