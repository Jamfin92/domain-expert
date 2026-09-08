import { describe, expect, it } from "vitest";
import { extractNode } from "@psq/extract";
import { MINI_FULLSTACK_REACT } from "./fixtures.js";

/**
 * The positive control for the component -> call -> matched route chain.
 *
 * Measured across every other fixture during planning, the conjunction does
 * not occur: `mini-fullstack` yields matched-but-unattributed calls only,
 * `mini-react` attributed-but-unmatched ones only. Grouping and the
 * "no matching route" copy could be tested on what already exists; the
 * matched-route cell of an attributed row could not. This fixture is that
 * cell's only gate, so a count here that drops to zero is the whole feature
 * losing its control, not a cosmetic regression.
 */

const g = extractNode(MINI_FULLSTACK_REACT);

const both = g.clientCalls.filter((c) => c.matches !== null && c.components.length > 0);

describe("a full-stack React fixture", () => {
  it("extracts without a single warning", () => {
    // Two reasons, each checked against the code that would push, not assumed:
    //   - no tsconfig, so `programFor` never enters the `existsSync` branch
    //     that holds all three of its warnings (node.ts:118-165) and takes
    //     the silent directory-scan fallback instead;
    //   - the two routes differ in both method and path, so no call can have
    //     more than one candidate and `linkCalls` (clients.ts:238-244), whose
    //     only warning is an ambiguous match, has nothing to say.
    //
    // Component attribution is NOT a third reason. Its only two warning sites
    // are a duplicate definition key (refs.ts:158) and a call with no recorded
    // AST node (refs.ts:454-458, unreachable by construction); neither is a
    // resolution failure. An intra-fixture import that failed to resolve is
    // SILENT — refs.ts:16-19, no edge and no warning — so it would leave this
    // assertion green and merely hand the call `components: []`. The gate for
    // that is the `src/lib/save-card.ts` call's two-key `components` pin in
    // "holds at least one row of every kind the panel renders" below, never
    // this case.
    //
    // The CREATE TABLE literal in the server is not about warnings at all:
    // it is what gives the fixture an entity, without which Workspace.open
    // throws "No entities found" and the API/e2e cases cannot open it.
    expect(g.warnings).toEqual([]);
  });

  it("reads the express half as routes, never as client calls", () => {
    expect(g.routes).toEqual([
      { method: "POST", path: "/api/admin/cards", file: "server.ts", line: 25 },
      { method: "GET", path: "/api/cards", file: "server.ts", line: 30 },
    ]);
    // Positive control on the every(): an empty list would satisfy it.
    expect(g.clientCalls.length).toBeGreaterThan(0);
    expect(g.clientCalls.every((c) => c.file !== "server.ts")).toBe(true);
  });

  it("keeps same-named components apart by key", () => {
    expect(g.components).toEqual([
      {
        key: "src/components/admin/Card.tsx#Card",
        name: "Card",
        file: "src/components/admin/Card.tsx",
        line: 11,
      },
      {
        key: "src/components/admin/Panel.tsx#Panel",
        name: "Panel",
        file: "src/components/admin/Panel.tsx",
        line: 11,
      },
      {
        key: "src/components/shop/Card.tsx#Card",
        name: "Card",
        file: "src/components/shop/Card.tsx",
        line: 11,
      },
      {
        key: "src/components/shop/Panel.tsx#Panel",
        name: "Panel",
        file: "src/components/shop/Panel.tsx",
        line: 6,
      },
    ]);
    // Four components, two names: EVERY component here shares its name with
    // exactly one other, so the label rules downstream — the panel's and the
    // quiz's alike — always take their disambiguating branch. If a name here
    // ever becomes unique, that branch loses its only hermetic control.
    expect(new Set(g.components.map((c) => c.name)).size).toBe(2);
    expect(g.components).toHaveLength(4);
  });

  it("holds at least one row of every kind the panel renders", () => {
    expect(g.clientCalls).toEqual([
      // attributed AND matched — the conjunction no other fixture has
      {
        method: "POST",
        path: "/api/admin/cards",
        file: "src/components/admin/Card.tsx",
        line: 13,
        enclosing: "save",
        matches: "POST /api/admin/cards",
        components: ["src/components/admin/Card.tsx#Card"],
      },
      // The three calls that make admin/Panel the busiest component, which is
      // what `client.busiest` is graded on. Sorted by file then line, so they
      // sit between the two Cards.
      {
        method: "POST",
        path: "/api/admin/cards",
        file: "src/components/admin/Panel.tsx",
        line: 13,
        enclosing: "load",
        matches: "POST /api/admin/cards",
        components: ["src/components/admin/Panel.tsx#Panel"],
      },
      {
        method: "GET",
        path: "/api/cards",
        file: "src/components/admin/Panel.tsx",
        line: 14,
        enclosing: "load",
        matches: "GET /api/cards",
        components: ["src/components/admin/Panel.tsx#Panel"],
      },
      // The second unmatched row, deliberately a path the server does not
      // declare rather than a repeat of an existing (method, path) pair.
      {
        method: "GET",
        path: "/api/admin/stats",
        file: "src/components/admin/Panel.tsx",
        line: 15,
        enclosing: "load",
        matches: null,
        components: ["src/components/admin/Panel.tsx#Panel"],
      },
      // attributed, unmatched: the server declares no such path
      {
        method: "GET",
        path: "/api/shop/wishlist",
        file: "src/components/shop/Card.tsx",
        line: 13,
        enclosing: "load",
        matches: null,
        components: ["src/components/shop/Card.tsx#Card"],
      },
      // the single-call component, which keeps the busiest one strictly ahead
      {
        method: "GET",
        path: "/api/cards",
        file: "src/components/shop/Panel.tsx",
        line: 8,
        enclosing: "refresh",
        matches: "GET /api/cards",
        components: ["src/components/shop/Panel.tsx#Panel"],
      },
      // unattributed, matched: module scope, reached by no component
      {
        method: "GET",
        path: "/api/cards",
        file: "src/lib/boot.ts",
        line: 5,
        enclosing: null,
        matches: "GET /api/cards",
        components: [],
      },
      // attributed to TWO components at once: a shared non-component helper
      // both Cards import, reached through the owner walk's reverse BFS
      {
        method: "GET",
        path: "/api/cards",
        file: "src/lib/save-card.ts",
        line: 7,
        enclosing: "saveCard",
        matches: "GET /api/cards",
        components: [
          "src/components/admin/Card.tsx#Card",
          "src/components/shop/Card.tsx#Card",
        ],
      },
    ]);
    // Per-component call counts, which `client.busiest` reads: admin/Panel 3,
    // admin/Card 2, shop/Card 2, shop/Panel 1. The margin at the top is what
    // keeps that generator's tie guard open.
    const counts = new Map<string, number>();
    for (const call of g.clientCalls) {
      for (const key of call.components) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.entries()].sort()).toEqual([
      ["src/components/admin/Card.tsx#Card", 2],
      ["src/components/admin/Panel.tsx#Panel", 3],
      ["src/components/shop/Card.tsx#Card", 2],
      ["src/components/shop/Panel.tsx#Panel", 1],
    ]);
  });

  it("yields at least one call that is both attributed and matched", () => {
    // The number the fixture exists for. Asserted as a floor rather than an
    // equality so growing the fixture cannot silently weaken it.
    expect(both.length).toBeGreaterThanOrEqual(1);
  });

  it("resolves every attributed component key against g.components", () => {
    const keys = new Set(g.components.map((c) => c.key));
    for (const call of g.clientCalls) {
      for (const key of call.components) {
        expect(keys).toContain(key);
      }
    }
    // Positive control on the loop above: a run where no call is attributed
    // would pass it by iterating nothing.
    expect(g.clientCalls.some((c) => c.components.length > 0)).toBe(true);
  });
});
