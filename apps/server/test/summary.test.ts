import { describe, it, expect, afterEach } from "vitest";
import { Workspace } from "../src/workspace.js";
import { MINI_EFCORE, MINI_FULLSTACK_CSHARP, MINI_REACT } from "../../../test/fixtures.js";

/**
 * P2c-iii D2: `RepoSummary` carries the graph's provenance — `coverage`,
 * `providerBasis`, `warningRecords` — ALWAYS present as keys, null when the
 * graph does not hold them (a hand-built or pre-P2 graph). Records follow the
 * `recordsOf` contract from `@psq/extract`, so HTTP and MCP agree on when the
 * records are trustworthy: present AND one per warning string.
 */

const AT = "2026-01-01T00:00:00.000Z";
const opened: Workspace[] = [];

function ws(): Workspace {
  const w = new Workspace(() => AT);
  opened.push(w);
  return w;
}

afterEach(() => {
  for (const w of opened.splice(0)) w.closeAll();
});

describe("summarize: provenance on the repo summary", () => {
  it("carries coverage, providerBasis and warningRecords from a fresh extraction", () => {
    const w = ws();
    const repo = w.open(MINI_EFCORE);
    const s = w.summarize(repo);
    expect(s.coverage?.entities.status).toBe("complete");
    expect(s.providerBasis?.csFiles).toBeGreaterThan(0);
    expect(s.warningRecords).toEqual([]);
  });

  it("states an absent coverage / providerBasis as null, with the key present", () => {
    const w = ws();
    const repo = w.open(MINI_EFCORE);
    delete repo.graph.coverage;
    delete repo.graph.providerBasis;
    const s = w.summarize(repo);
    // Key present AND null: `toHaveProperty(k, null)` fails on an absent key.
    expect(s).toHaveProperty("coverage", null);
    expect(s).toHaveProperty("providerBasis", null);
  });

  // Both fixtures the server can open (>= 1 entity) that carry warnings.
  for (const [label, fixture, warnings] of [
    ["mini-fullstack-csharp", MINI_FULLSTACK_CSHARP, 2],
    ["mini-react", MINI_REACT, 2],
  ] as const) {
    it(`${label}: records are passed through only when they match the strings one-for-one`, () => {
      const w = ws();
      const repo = w.open(fixture);
      expect(repo.graph.warnings).toHaveLength(warnings);
      const whole = w.summarize(repo);
      expect(whole.warningRecords).toHaveLength(warnings);
      expect(whole.warningRecords?.map((r) => r.text)).toEqual(repo.graph.warnings);

      // A length mismatch is the drift `recordsOf` catches; a bare passthrough would not.
      repo.graph.warningRecords = repo.graph.warningRecords!.slice(0, -1);
      expect(w.summarize(repo)).toHaveProperty("warningRecords", null);
    });
  }
});
