import { describe, it, expect } from "vitest";
import { Call, EntityGraph, UnresolvedCalls } from "../src/index.js";

describe("EntityGraph.calls", () => {
  const site = { type: "A", method: "M", file: "A.cs", line: 3 };
  const base = {
    kind: "entity", repo: "r", provider: "efcore", contextName: null, entities: [],
    relations: [], shapes: [], routes: [], clientCalls: [], components: [], warnings: [],
  };

  it("is optional: a graph from a provider that reads no calls still parses, with the key absent", () => {
    const parsed = EntityGraph.parse(base);
    expect(parsed.calls).toBeUndefined();
    expect("calls" in parsed).toBe(false);
    expect(parsed.unresolvedCalls).toBeUndefined();
  });

  it("round-trips a call, with and without ambiguous", () => {
    const plain = { from: site, to: { ...site, method: "N", line: 9 }, line: 4 };
    expect(Call.parse(plain)).toEqual(plain);
    const amb = { ...plain, ambiguous: true };
    expect(Call.parse(amb)).toEqual(amb);
    const g = EntityGraph.parse({ ...base, calls: [plain, amb], unresolvedCalls: [{ ...site, count: 2 }] });
    expect(g.calls).toEqual([plain, amb]);
  });

  it("rejects a call missing its call-site line or an endpoint field", () => {
    expect(() => Call.parse({ from: site, to: site })).toThrow();
    expect(() => Call.parse({ from: { type: "A", method: "M" }, to: site, line: 1 })).toThrow();
  });

  it("only counts unresolved calls above zero", () => {
    expect(() => UnresolvedCalls.parse({ ...site, count: 0 })).toThrow();
  });
});
