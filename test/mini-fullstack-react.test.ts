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
    // No tsconfig (so no dropped-reference warning), a CREATE TABLE literal
    // in the server (so the shapes-but-no-schema warning cannot fire), and
    // two unambiguous routes (so linkCalls has nothing to warn about).
    expect(g.warnings).toEqual([]);
  });

  it("reads the express half as routes, never as client calls", () => {
    expect(g.routes).toEqual([
      { method: "POST", path: "/api/admin/cards", file: "server.ts", line: 25 },
      { method: "GET", path: "/api/cards", file: "server.ts", line: 30 },
    ]);
    expect(g.clientCalls.every((c) => c.file !== "server.ts")).toBe(true);
  });

  it("keeps two same-named components apart by key", () => {
    expect(g.components).toEqual([
      {
        key: "src/components/admin/Card.tsx#Card",
        name: "Card",
        file: "src/components/admin/Card.tsx",
        line: 6,
      },
      {
        key: "src/components/shop/Card.tsx#Card",
        name: "Card",
        file: "src/components/shop/Card.tsx",
        line: 6,
      },
    ]);
    // The label rule downstream exists because these two are indistinguishable
    // by name; if that ever stops being true here, the rule loses its control.
    expect(new Set(g.components.map((c) => c.name)).size).toBe(1);
  });

  it("holds one row of every kind the panel renders", () => {
    expect(g.clientCalls).toEqual([
      // attributed AND matched — the conjunction no other fixture has
      {
        method: "POST",
        path: "/api/admin/cards",
        file: "src/components/admin/Card.tsx",
        line: 8,
        enclosing: "save",
        matches: "POST /api/admin/cards",
        components: ["src/components/admin/Card.tsx#Card"],
      },
      // attributed, unmatched: the server declares no such path
      {
        method: "GET",
        path: "/api/shop/wishlist",
        file: "src/components/shop/Card.tsx",
        line: 8,
        enclosing: "load",
        matches: null,
        components: ["src/components/shop/Card.tsx#Card"],
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
