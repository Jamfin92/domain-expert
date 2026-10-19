import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Coverage, EntityGraph, FacetCoverage, ProviderBasis } from "@psq/schema";
import { extract } from "../src/detect.js";
import {
  MINI_EFCORE, MINI_EFCORE_EMPTY_CONTEXT, MINI_FULLSTACK_CSHARP, MINI_NODE, MINI_TYPES_ONLY,
} from "../../../test/fixtures.js";

/**
 * Coverage invariants over EVERY hermetic fixture, `not-a-project` included
 * (P2a). The fixture list is read from disk so a new fixture is covered
 * without editing this file.
 */
const FIXTURES = join(dirname(MINI_EFCORE));
const ALL = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("every extracted graph carries coverage and providerBasis", () => {
  it("found the fixture set", () => {
    expect(ALL).toContain("not-a-project");
    expect(ALL.length).toBeGreaterThanOrEqual(15);
  });

  it.each(ALL)("%s", (name) => {
    const g = extract(join(FIXTURES, name));
    expect(g.coverage).toBeDefined();
    expect(g.providerBasis).toBeDefined();
    // The zod refine: a reason whenever status is not complete.
    expect(() => Coverage.parse(g.coverage)).not.toThrow();
    expect(() => ProviderBasis.parse(g.providerBasis)).not.toThrow();
    for (const [facet, c] of Object.entries(g.coverage)) {
      if (c.status !== "complete") expect(c.reason, `${name}.${facet}`).toBeTruthy();
      if (c.status === "not-read") expect(c.readers, `${name}.${facet}`).toEqual([]);
    }
  });
});

describe("coverage on specific fixtures", () => {
  it("mini-efcore: clientCalls not-read, and no test-file skip (the C# reader reads test files)", () => {
    const g = extract(MINI_EFCORE);
    expect(g.coverage.clientCalls.status).toBe("not-read");
    expect(g.coverage.clientCalls.reason).toBe("no TypeScript reader runs under provider efcore");
    expect(g.coverage.entities.status).toBe("complete");
    expect(g.coverage.entities.skipped.map((s) => s.why)).not.toContain("test-file");
  });

  it("mini-node: entityRefs not-read", () => {
    const g = extract(MINI_NODE);
    expect(g.coverage.entityRefs.status).toBe("not-read");
    expect(g.coverage.entities.status).toBe("complete");
  });

  it("mini-types-only: entities none-found, mentioning CREATE TABLE", () => {
    const g = extract(MINI_TYPES_ONLY);
    expect(g.coverage.entities.status).toBe("none-found");
    expect(g.coverage.entities.reason).toContain("CREATE TABLE");
    expect(g.coverage.shapes.status).toBe("complete");
  });

  it("mini-efcore-empty-context: entities none-found with the existing warning sentence", () => {
    const g = extract(MINI_EFCORE_EMPTY_CONTEXT);
    expect(g.coverage.entities.status).toBe("none-found");
    expect(g.warnings).toContain(g.coverage.entities.reason);
  });

  it("mini-fullstack-csharp: pairing partial with the merge warning, node roots prefixed, readers unioned", () => {
    const g = extract(MINI_FULLSTACK_CSHARP);
    expect(g.coverage.pairing.status).toBe("partial");
    expect(g.coverage.pairing.reason).not.toBeNull();
    expect(g.warnings).toContain(g.coverage.pairing.reason);
    expect(g.coverage.pairing.reason).toMatch(/^\d+ shapes from the TypeScript side were not paired/);
    expect(g.coverage.entities.readers).toEqual(["efcore", "sqlite-ddl"]);
    // Complete merged facet: the TS half's "no CREATE TABLE" reason is not carried.
    expect(g.coverage.entities.status).toBe("complete");
    expect(g.coverage.entities.reason).toBeNull();
    // Pairing spans both runs: the .NET entities and the client's unpaired shapes.
    expect(g.coverage.pairing.roots).toEqual([".", "client"]);
    expect(g.coverage.pairing.filesRead).toBe(g.coverage.shapes.filesRead);
    expect(g.coverage.entities.roots).toEqual([".", "client"]);
    expect(g.coverage.clientCalls.roots).toEqual(["client"]);
    expect(g.coverage.clientCalls.status).toBe("complete");
    expect(g.providerBasis).toMatchObject({ testOnlyCs: 0, testOnlyTs: 0 });
  });
});

describe("FacetCoverage refine: a reason unless complete", () => {
  const base = { readers: [], roots: [], filesRead: 0, skipped: [] };
  it("rejects none-found with a null reason", () => {
    expect(FacetCoverage.safeParse({ ...base, status: "none-found", reason: null }).success).toBe(false);
  });
  it("rejects partial with an empty reason", () => {
    expect(FacetCoverage.safeParse({ ...base, status: "partial", reason: "" }).success).toBe(false);
  });
  it("accepts complete with a null reason", () => {
    expect(FacetCoverage.safeParse({ ...base, status: "complete", reason: null }).success).toBe(true);
  });
  it("rejects a reasonless facet nested inside an EntityGraph", () => {
    const g = extract(MINI_EFCORE);
    expect(EntityGraph.safeParse(g).success).toBe(true);
    const bad = { ...g, coverage: { ...g.coverage, routes: { ...g.coverage.routes, status: "not-read", reason: null } } };
    expect(EntityGraph.safeParse(bad).success).toBe(false);
  });
});
