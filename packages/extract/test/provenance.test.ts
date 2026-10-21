import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { EntityGraph } from "@psq/schema";
import { extract } from "../src/detect.js";
import { MINI_EFCORE } from "../../../test/fixtures.js";

/**
 * Provenance invariant (P2c-i), checked over every hermetic fixture rather than
 * stated as a convention. Fixtures are read from disk like `warnings.test.ts`
 * does, so a new fixture is covered without editing this file.
 *
 *   - a nullable fact `X` with a provenance field `XSource`: `X === null` iff
 *     `XSource === null` (provenance is stamped on a fact, never on its absence)
 *   - a non-nullable fact (route, call edge, entity ref, component) always
 *     carries `source`
 *
 * The `(a === null) === (b === null)` checks are written so a pre-v10 graph,
 * where `b` is absent (`undefined`), FAILS them: `undefined === null` is false.
 * The positive controls below make sure the sweep actually sees every value it
 * claims to check; without them an all-null corpus would pass vacuously.
 */

const FIXTURES = dirname(MINI_EFCORE);
const ALL = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const GRAPHS = new Map(ALL.map((name) => [name, extract(join(FIXTURES, name))] as const));

describe("provenance on every fact, never on an absence (fixture sweep)", () => {
  it("found the fixture set", () => {
    expect(ALL).toContain("mini-aspnet-routes");
    expect(ALL.length).toBeGreaterThanOrEqual(15);
  });

  it.each(ALL)("%s", (name) => {
    const g = GRAPHS.get(name)!;
    expect(() => EntityGraph.parse(g), name).not.toThrow();

    for (const r of g.routes) {
      const at = `${name} route ${r.method} ${r.path}`;
      expect(r.source, at).toBe(r.file.endsWith(".cs") ? "attribute" : "declared");
    }
    for (const c of g.clientCalls) {
      const at = `${name} clientCall ${c.file}:${c.line}`;
      expect(c.matches === null, at).toBe(c.matchSource === null);
      // The non-null side by VALUE: on a graph lacking the key the iff above
      // passes for a matched call (`false === (undefined === null)`).
      if (c.matches !== null) expect(c.matchSource, at).toBe("inferred");
      expect(c.components.length === 0, at).toBe(c.componentsSource === null);
      if (c.components.length > 0) expect(["declared", "inferred"], at).toContain(c.componentsSource);
    }
    for (const comp of g.components) {
      expect(comp.source, `${name} component ${comp.key}`).toBe("inferred");
    }
    for (const ref of g.entityRefs) {
      expect(ref.source, `${name} entityRef ${ref.file}:${ref.line}`).toBe("inferred");
    }
    for (const call of g.calls ?? []) {
      const at = `${name} call ${call.from.type}.${call.from.method}->${call.to.type}.${call.to.method}@${call.line}`;
      expect(["declared", "inferred"], at).toContain(call.source);
      if (call.ambiguous === true) expect(call.source, at).toBe("inferred");
    }
    for (const s of g.shapes) {
      const at = `${name} shape ${s.file}:${s.name}`;
      expect(s.mirrors === null, at).toBe(s.mirrorSource === null);
      if (s.mirrors !== null) expect(s.mirrorSource, at).toBe("inferred");
    }
  });

  // Each control names the fixture and fact that supplies it (audit table).
  const all = [...GRAPHS.values()];
  const routes = all.flatMap((g) => g.routes);
  const clientCalls = all.flatMap((g) => g.clientCalls);
  const calls = all.flatMap((g) => g.calls ?? []);
  const shapes = all.flatMap((g) => g.shapes);

  it.each([
    // mini-aspnet-routes: every C# attribute route
    ["an attribute route", () => routes.some((r) => r.source === "attribute")],
    // mini-node: GET /health (server.ts:10)
    ["a declared route", () => routes.some((r) => r.source === "declared")],
    // mini-fullstack (7 matched) + mini-fullstack-react (6 matched)
    ["a matchSource: inferred", () => clientCalls.some((c) => c.matchSource === "inferred")],
    // mini-react: GET /api/home inside HomePage (src/components/HomePage.tsx:6)
    ["a componentsSource: declared", () => clientCalls.some((c) => c.componentsSource === "declared")],
    // mini-react: GET /api/users (src/services/api.ts:9) reached from UserList
    ["a componentsSource: inferred", () => clientCalls.some((c) => c.componentsSource === "inferred")],
    // mini-aspnet-routes: GadgetService.Retire -> EmailNotifier.Send (two implementers)
    ["an inferred, ambiguous call", () => calls.some((c) => c.source === "inferred" && c.ambiguous === true)],
    // mini-aspnet-routes: GadgetsController.Get -> GadgetService.Assemble (one implementer; 4 such edges)
    ["an inferred, unambiguous call", () => calls.some((c) => c.source === "inferred" && c.ambiguous === undefined)],
    // mini-aspnet-routes: Chain.Step0 -> Chain.Step1 (bare call)
    ["a declared call", () => calls.some((c) => c.source === "declared")],
    // mini-react: every component, e.g. src/components/admin/Card.tsx#Card
    ["an inferred component", () => all.some((g) => g.components.some((c) => c.source === "inferred"))],
    // mini-node: Crew -> crews (also Voyage, VoyageRow; mini-fullstack-csharp ProductDto -> Product)
    ["a paired shape", () => shapes.some((s) => s.mirrors !== null && s.mirrorSource === "inferred")],
  ] as const)("positive control: the corpus contains %s", (_label, seen) => {
    expect(seen()).toBe(true);
  });
});
