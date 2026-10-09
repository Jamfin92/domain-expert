import { describe, expect, it } from "vitest";
import { groupRefs, refsState } from "../src/lib/refs.js";
import type { EntityRef } from "../src/lib/api.js";

const ref = (over: Partial<EntityRef>): EntityRef => ({
  entity: "Student", file: "C/A.cs", line: 1, type: "A", method: "M", via: "entityName", ...over,
});

describe("groupRefs", () => {
  it("groups by file, then type.method, lines ascending", () => {
    const g = groupRefs([
      ref({ file: "C/B.cs", type: "B", method: "Z", line: 4 }),
      ref({ file: "C/A.cs", type: "A", method: "N", line: 9 }),
      ref({ file: "C/A.cs", type: "A", method: "M", line: 7 }),
      ref({ file: "C/A.cs", type: "A", method: "M", line: 2 }),
    ]);
    expect(g.map((f) => f.file)).toEqual(["C/A.cs", "C/B.cs"]);
    expect(g[0]?.methods.map((m) => m.method)).toEqual(["M", "N"]);
    expect(g[0]?.methods[0]?.refs.map((r) => r.line)).toEqual([2, 7]);
  });

  it("keeps same-named methods on different types apart", () => {
    const g = groupRefs([ref({ type: "A", method: "M" }), ref({ type: "B", method: "M", line: 2 })]);
    expect(g[0]?.methods.map((m) => m.type)).toEqual(["A", "B"]);
  });
});

describe("refsState", () => {
  it("unknown, known-with-zero and some are three different states", () => {
    expect(refsState({ known: false, refs: [] })).toEqual({ kind: "unknown" });
    expect(refsState({ known: true, refs: [] })).toEqual({ kind: "none" });
    const s = refsState({ known: true, refs: [ref({}), ref({ line: 2 })] });
    expect(s.kind).toBe("some");
    if (s.kind === "some") expect(s.count).toBe(2);
  });
});
