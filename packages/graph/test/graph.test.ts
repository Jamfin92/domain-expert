import { describe, it, expect } from "vitest";
import { extractDotnet } from "@psq/extract";
import { invariants, degrees, shortestPath, orphans, mermaid } from "../src/index.js";
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
