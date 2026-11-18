import { describe, expect, it } from "vitest";
import {
  coverageCaveatText,
  coverageCaveats,
  coverageHeadline,
  coverageRows,
  coverageSummary,
  warningItems,
} from "../src/lib/coverage.js";
import type { Coverage, FacetCoverage, WarningRecord } from "../src/lib/api.js";

const complete = (over: Partial<FacetCoverage> = {}): FacetCoverage => ({
  status: "complete", readers: ["r"], roots: ["."], filesRead: 4, skipped: [], reason: null, ...over,
});

/** All nine facets complete, in schema order. */
function clean(over: Partial<Coverage> = {}): Coverage {
  return {
    entities: complete(),
    relations: complete(),
    shapes: complete(),
    routes: complete(),
    clientCalls: complete(),
    components: complete(),
    entityRefs: complete(),
    calls: complete(),
    pairing: complete(),
    ...over,
  };
}

const partialRoutes = complete({ status: "partial", reason: "walk limit hit at 5000 files" });
const noneFound = complete({ status: "none-found", filesRead: 12, reason: "no CREATE TABLE in 12 files" });
const notRead = complete({ status: "not-read", readers: [], roots: [], filesRead: 0, reason: "no client reader" });
const testFileSkip = complete({ skipped: [{ why: "test-file", count: 3 }] });
const walkLimitSkip = complete({
  skipped: [{ why: "walk-limit", count: 1 }, { why: "test-file", count: 26 }],
});

/** One facet of each kind; built in a NON-schema key order on purpose. */
const mixed: Coverage = {
  pairing: complete(),
  routes: partialRoutes,
  entities: noneFound,
  clientCalls: notRead,
  shapes: testFileSkip,
  components: walkLimitSkip,
  relations: complete(),
  calls: complete(),
  entityRefs: complete(),
};

describe("coverageRows", () => {
  it("follows the coverage object's own key order, not a hardcoded facet list", () => {
    expect(coverageRows(mixed).map((r) => r.facet)).toEqual([
      "pairing", "routes", "entities", "clientCalls", "shapes", "components", "relations", "calls", "entityRefs",
    ]);
  });

  it("carries status, files read, readers, reason and skips per facet", () => {
    const row = coverageRows(mixed).find((r) => r.facet === "entities");
    expect(row).toEqual({
      facet: "entities", status: "none-found", filesRead: 12, readers: ["r"],
      reason: "no CREATE TABLE in 12 files", skipped: [],
    });
  });
});

describe("coverageCaveats", () => {
  it("is empty on a clean read", () => {
    expect(coverageCaveats(clean())).toEqual([]);
  });

  it("is exactly the partial facet and the facet with a walk-limit skip", () => {
    expect(coverageCaveats(mixed).map((r) => r.facets)).toEqual([["routes"], ["components"]]);
  });

  it("does not count none-found, not-read, or a policy (test-file) skip as a caveat", () => {
    const only = (facet: keyof Coverage, f: FacetCoverage) => coverageCaveats(clean({ [facet]: f }));
    expect(only("entities", noneFound)).toEqual([]);
    expect(only("clientCalls", notRead)).toEqual([]);
    expect(only("shapes", testFileSkip)).toEqual([]);
    expect(only("shapes", complete({ skipped: [{ why: "migrations", count: 2 }, { why: "declaration", count: 9 }] })))
      .toEqual([]);
  });

  it("counts unreadable and other-project skips as caveats", () => {
    expect(coverageCaveats(clean({ calls: complete({ skipped: [{ why: "unreadable", count: 1 }] }) }))
      .map((r) => r.facets)).toEqual([["calls"]]);
    expect(coverageCaveats(clean({ routes: complete({ skipped: [{ why: "other-project", count: 2 }] }) }))
      .map((r) => r.facets)).toEqual([["routes"]]);
  });
});

describe("coverageCaveatText", () => {
  it("states the facet, its status and its reason", () => {
    const [routes] = coverageCaveats(mixed);
    expect(coverageCaveatText(routes!)).toBe("routes: partial — walk limit hit at 5000 files");
  });

  it("lists only the caveat skips, in the MCP brief's `skipped N why` grammar", () => {
    const [, components] = coverageCaveats(mixed);
    expect(coverageCaveatText(components!)).toBe("components: complete (skipped 1 walk-limit)");
  });

  it("joins several caveat skips with a comma", () => {
    const [row] = coverageCaveats(clean({
      calls: complete({
        status: "partial", reason: "two projects not read",
        skipped: [{ why: "other-project", count: 2 }, { why: "test-file", count: 4 }, { why: "unreadable", count: 1 }],
      }),
    }));
    expect(coverageCaveatText(row!))
      .toBe("calls: partial — two projects not read (skipped 2 other-project, 1 unreadable)");
  });
});

describe("coverageCaveats grouping (P2d D5)", () => {
  const shared = "tsconfig.json: 2 referenced projects; reading only tsconfig.app.json";
  // `filesRead` differs per facet on purpose: it is not part of the rendered line, so it must not split a group.
  const otherProject = (count: number, filesRead = 4) => complete({
    status: "partial", reason: shared, filesRead,
    skipped: [{ why: "other-project", count }, { why: "test-file", count: 9 }],
  });

  it("puts facets that share a rendered reason on one line, in facet order, beside a distinct reason", () => {
    // Overrides are written routes, entities, calls, shapes, but spreading clean() first keeps
    // clean()'s key positions: groups and their facets follow the object's key order (entities, shapes, routes).
    const c = {
      ...clean(),
      routes: otherProject(2, 11),
      entities: otherProject(2, 23),
      // Same status and the same skip text as the three: only the reason differs, so it must stay its own line.
      calls: complete({
        status: "partial", reason: "solution lists 3 projects; reading only Api.csproj", filesRead: 5,
        skipped: [{ why: "other-project", count: 2 }],
      }),
      shapes: otherProject(2, 37),
    } satisfies Coverage;
    const rows = coverageCaveats(c);
    expect(rows.map((r) => r.facets)).toEqual([["entities", "shapes", "routes"], ["calls"]]);
    expect(rows.map((r) => r.key)).toEqual(["entities,shapes,routes", "calls"]);
    expect(rows.map(coverageCaveatText)).toEqual([
      `entities, shapes, routes: partial — ${shared} (skipped 2 other-project)`,
      "calls: partial — solution lists 3 projects; reading only Api.csproj (skipped 2 other-project)",
    ]);
  });

  it("keeps the same reason with different skip counts as two lines", () => {
    const rows = coverageCaveats(clean({ entities: otherProject(1), routes: otherProject(3) }));
    expect(rows.map(coverageCaveatText)).toEqual([
      `entities: partial — ${shared} (skipped 1 other-project)`,
      `routes: partial — ${shared} (skipped 3 other-project)`,
    ]);
  });

  it("keeps the same reason under two statuses as two lines", () => {
    const rows = coverageCaveats(clean({
      entities: otherProject(1),
      routes: complete({ reason: shared, skipped: [{ why: "other-project", count: 1 }] }),
    }));
    expect(rows.map((r) => r.facets)).toEqual([["entities"], ["routes"]]);
  });

  it("collapses mini-react's seven identical rows to one line naming all seven", () => {
    // mini-react's coverage as extracted: seven facets share one reason and one skip.
    const one = complete({ status: "partial", reason: shared, skipped: [{ why: "other-project", count: 1 }] });
    const c = clean({
      entities: one, relations: one, shapes: one, routes: one, clientCalls: one, components: one, pairing: one,
    });
    const rows = coverageCaveats(c);
    expect(rows).toHaveLength(1);
    expect(coverageCaveatText(rows[0]!)).toBe(
      `entities, relations, shapes, routes, clientCalls, components, pairing: partial — ${shared} (skipped 1 other-project)`,
    );
  });
});

describe("coverageSummary / coverageHeadline", () => {
  it("counts none-found as read in full, and sums to the facet count", () => {
    const s = coverageSummary(mixed);
    // six complete (two of them carrying skips) + one none-found = 7 read in full.
    expect(s).toEqual({ read: 7, partial: 1, notRead: 1 });
    expect(s.read + s.partial + s.notRead).toBe(9);
  });

  it("reads a clean coverage as all nine in full", () => {
    expect(coverageSummary(clean())).toEqual({ read: 9, partial: 0, notRead: 0 });
    expect(coverageHeadline(clean()))
      .toBe("Read 9 of 9 facets in full · 0 partial · 0 not read");
  });

  it("states the mixed read exactly", () => {
    expect(coverageHeadline(mixed))
      .toBe("Read 7 of 9 facets in full · 1 partial · 1 not read");
  });

  it("counts the facets it is given, not a fixed nine", () => {
    // A tenth facet from a newer server: the web has no facet list to update.
    const ten = { ...clean(), tenth: complete() } as unknown as Coverage;
    expect(coverageRows(ten)).toHaveLength(10);
    expect(coverageHeadline(ten)).toBe("Read 10 of 10 facets in full · 0 partial · 0 not read");
  });
});

describe("warningItems", () => {
  const rec = (i: number): WarningRecord => ({
    code: "no-schema", file: null, line: null, about: null, text: `record ${i}`,
  });

  it("reads the records first, with their codes, ignoring the strings", () => {
    expect(warningItems({ warnings: ["string a", "string b"], warningRecords: [rec(1), rec(2)] })).toEqual([
      { code: "no-schema", text: "record 1" },
      { code: "no-schema", text: "record 2" },
    ]);
  });

  it("falls back to the strings, code null, when there are no records", () => {
    expect(warningItems({ warnings: ["a", "a"], warningRecords: null })).toEqual([
      { code: null, text: "a" },
      { code: null, text: "a" },
    ]);
  });

  it("falls back to the strings when the records key is missing (an older server)", () => {
    expect(warningItems({ warnings: ["a"], warningRecords: undefined as unknown as null })).toEqual([
      { code: null, text: "a" },
    ]);
  });

  it("caps at six", () => {
    const recs = [1, 2, 3, 4, 5, 6, 7].map(rec);
    const items = warningItems({ warnings: recs.map((r) => r.text), warningRecords: recs });
    expect(items).toHaveLength(6);
    expect(items[5]).toEqual({ code: "no-schema", text: "record 6" });
    expect(warningItems({ warnings: ["1", "2", "3", "4", "5", "6", "7"], warningRecords: null })).toHaveLength(6);
  });
});
