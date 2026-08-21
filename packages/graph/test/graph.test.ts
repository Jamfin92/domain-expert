import { describe, it, expect } from "vitest";
import { extractDotnet } from "@psq/extract";
import { invariants, degrees, shortestPath, orphans, mermaid, layout } from "../src/index.js";
import { MINI_EFCORE } from "../../../test/fixtures.js";

import { CORPUS, hasCorpus } from "../../../test/fixtures.js";

const PP = CORPUS.corpus-repo-a;
const present = hasCorpus(PP);
const g = present ? extractDotnet(PP) : extractDotnet(MINI_EFCORE);

describe("graph invariants", () => {
  it("holds for a real extracted graph", () => {
    expect(invariants(g)).toEqual([]);
  });

  it("catches a foreign key that does not resolve", () => {
    const broken = structuredClone(g);
    broken.relations[0]!.foreignKeyProperty = "NoSuchColumn";
    expect(invariants(broken).join("\n")).toContain("is not a property of");
  });

  it("catches a relation pointing at an entity that is not in the graph", () => {
    const broken = structuredClone(g);
    broken.relations[0]!.principal = "Ghost";
    expect(invariants(broken).join("\n")).toContain('unknown principal "Ghost"');
  });

  it("catches a key that is not a declared property", () => {
    const broken = structuredClone(g);
    broken.entities[0]!.keys = ["NotThere"];
    expect(invariants(broken).join("\n")).toContain("is not a declared property");
  });
});

describe.skipIf(!present)("graph algorithms [corpus]", () => {
  it("ranks the hub entity highest and is stable", () => {
    const d = degrees(g);
    expect(d[0]!.entity).toBe("User");
    expect(d[0]!.degree).toBe(7);
    expect(degrees(g)).toEqual(d);
  });

  it("finds shortest paths and reports disconnection", () => {
    expect(shortestPath(g, "County", "LicenseApplication")).toEqual([
      "County", "Department", "LicenseType", "LicenseApplication",
    ]);
    expect(shortestPath(g, "County", "County")).toEqual(["County"]);
    // JobRun has no relations at all, so nothing reaches it.
    expect(shortestPath(g, "County", "JobRun")).toBeNull();
    expect(shortestPath(g, "County", "Nope")).toBeNull();
  });

  it("reports unconnected entities", () => {
    expect(orphans(g)).toEqual(["JobRun", "WaitlistEntry"]);
  });

  it("emits mermaid that names every entity and relation", () => {
    const m = mermaid(g);
    expect(m.startsWith("erDiagram")).toBe(true);
    for (const e of g.entities) expect(m).toContain(`    ${e.name} {`);
    expect(m.split("\n").filter((l) => l.includes("--")).length).toBe(g.relations.length);
  });
});

describe("diagram layout", () => {
  const l = layout(g);

  it("places every entity exactly once", () => {
    expect(l.nodes).toHaveLength(g.entities.length);
    expect(new Set(l.nodes.map((n) => n.name)).size).toBe(g.entities.length);
    expect(l.edges).toHaveLength(g.relations.length);
  });

  it("puts a principal above its dependents", () => {
    const level = new Map(l.nodes.map((n) => [n.name, n.level]));
    for (const r of g.relations) {
      if (r.principal === r.dependent) continue;
      expect(level.get(r.principal)!).toBeLessThan(level.get(r.dependent)!);
    }
  });

  it("never overlaps two boxes on the same row", () => {
    const rows = new Map<number, typeof l.nodes>();
    for (const n of l.nodes) rows.set(n.level, [...(rows.get(n.level) ?? []), n]);
    for (const row of rows.values()) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.x).toBeGreaterThanOrEqual(sorted[i - 1]!.x + sorted[i - 1]!.width);
      }
    }
  });

  it("keeps every box inside the reported canvas", () => {
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(l.width);
      expect(n.y + n.height).toBeLessThanOrEqual(l.height);
    }
  });

  it("is deterministic", () => {
    expect(layout(g)).toEqual(l);
  });
});
