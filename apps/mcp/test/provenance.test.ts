import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FactSource } from "@psq/schema";
import { Workspace } from "../../server/src/workspace.js";
import { tools, type Ctx } from "../src/tools.js";
import {
  MINI_EFCORE_REFS, MINI_FULLSTACK_CSHARP, MINI_FULLSTACK_REACT, MINI_NODE, MINI_REACT, MINI_TYPES_ONLY,
} from "../../../test/fixtures.js";

/**
 * P2c-ii: the graph's provenance survives projection. Every MCP tool that
 * builds new objects from graph facts carries the fact's provenance beside it,
 * and a nullable fact's provenance is null exactly when the fact is. The
 * graph-side sweep is `packages/extract/test/provenance.test.ts`; this one
 * reads the TOOL OUTPUT, so a projection that drops a field fails here.
 */

const MINI_ASPNET_ROUTES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/mini-aspnet-routes");

let ctx: Ctx;
beforeEach(() => {
  ctx = { workspace: new Workspace() };
});
afterEach(() => ctx.workspace.closeAll());

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SOURCES: readonly string[] = FactSource.options;

interface Seen {
  routes: Json[];
  overviewRoutes: Json[];
  components: Json[];
  overviewCalls: Json[];
  clientCalls: Json[];
  refs: Json[];
  hops: Array<Json & { route: string }>;
  shapes: Json[];
}

/** Every projected item of every fact-returning tool on one fixture. */
function sweep(path: string): Seen {
  ctx.workspace.closeAll();
  const id = (tools.open_repo.run(ctx, { path }) as Json).id;
  const g = ctx.workspace.get(id)!.graph;
  const run = (tool: keyof typeof tools, args: Json = {}): Json => (tools[tool].run as (c: Ctx, a: Json) => unknown)(ctx, args) as Json;

  const overview = run("overview");
  const seen: Seen = {
    routes: run("routes").routes,
    overviewRoutes: overview.routeGroups.flatMap((x: Json) => x.routes),
    components: overview.components,
    overviewCalls: overview.components.flatMap((c: Json) => c.clientCalls),
    clientCalls: run("client_calls").calls,
    refs: g.entities.flatMap((e) => run("refs", { entity: e.name }).refs),
    hops: [],
    shapes: run("shapes").shapes,
  };
  if (g.entities.length > 0) {
    for (const r of g.routes.filter((x) => x.handler)) {
      const route = `${r.method} ${r.path}`;
      seen.hops.push(...run("flow", { route }).hops.map((h: Json) => ({ ...h, route })));
    }
  }
  // The sweep reads what the graph holds: nothing is skipped by a cap.
  expect(seen.routes.length, path).toBe(g.routes.length);
  expect(seen.clientCalls.length, path).toBe(g.clientCalls.length);
  expect(seen.refs.length, path).toBe(g.entityRefs.length);
  expect(seen.shapes.length, path).toBe(g.shapes.length);
  return seen;
}

function expectInvariants(s: Seen, path: string): void {
  for (const r of [...s.routes, ...s.overviewRoutes]) expect(SOURCES, `${path} route ${r.method} ${r.path}`).toContain(r.source);
  for (const c of s.components) expect(SOURCES, `${path} component ${c.key}`).toContain(c.source);
  for (const r of s.refs) expect(SOURCES, `${path} ref ${r.cite}`).toContain(r.source);
  for (const c of [...s.clientCalls, ...s.overviewCalls]) {
    expect(c, `${path} client call ${c.cite}`).toHaveProperty("matchSource");
    expect(c.matches === null, `${path} ${c.cite}`).toBe(c.matchSource === null);
    if (c.matchSource !== null) expect(SOURCES).toContain(c.matchSource);
  }
  for (const c of s.clientCalls) {
    expect(c, `${path} client call ${c.cite}`).toHaveProperty("componentsSource");
    expect(c.components.length === 0, `${path} ${c.cite}`).toBe(c.componentsSource === null);
    if (c.componentsSource !== null) expect(SOURCES).toContain(c.componentsSource);
  }
  // Nested under a component, the call IS attributed: its attribution source is never null.
  for (const c of s.overviewCalls) expect(SOURCES, `${path} nested ${c.cite}`).toContain(c.componentsSource);
  for (const h of s.hops) {
    expect(h, `${path} ${h.route} ${h.method}`).toHaveProperty("calledSource");
    expect(h.calledAt === null, `${path} ${h.route} ${h.method}`).toBe(h.calledSource === null);
    if (h.calledSource !== null) expect(SOURCES).toContain(h.calledSource);
  }
  for (const x of s.shapes) {
    expect(x.mirrors === null, `${path} shape ${x.name}`).toBe(x.mirrorSource === null);
    expect(x.mirrors === null, `${path} shape ${x.name}`).toBe(x.drift === null);
  }
}

describe("provenance through every projecting tool", () => {
  const FIXTURES = {
    "mini-aspnet-routes": MINI_ASPNET_ROUTES,
    "mini-fullstack-react": MINI_FULLSTACK_REACT,
    "mini-react": MINI_REACT,
    "mini-node": MINI_NODE,
    "mini-types-only": MINI_TYPES_ONLY,
    "mini-fullstack-csharp": MINI_FULLSTACK_CSHARP,
    "mini-efcore-refs": MINI_EFCORE_REFS,
  };

  it("holds the invariants on every item, with positive controls for every source", () => {
    const all: Record<string, Seen> = {};
    for (const [name, path] of Object.entries(FIXTURES)) {
      all[name] = sweep(path);
      expectInvariants(all[name]!, name);
    }
    const aspnet = all["mini-aspnet-routes"]!;
    const react = all["mini-react"]!;
    const fsReact = all["mini-fullstack-react"]!;

    // Controls: each value the invariants accept actually occurs, so a sweep
    // over all-null or all-one-source output cannot pass.
    expect(aspnet.routes.some((r) => r.source === "attribute")).toBe(true);
    expect(fsReact.routes.some((r) => r.source === "declared")).toBe(true);
    expect(fsReact.overviewRoutes.some((r) => r.source === "declared")).toBe(true);
    expect(fsReact.clientCalls.some((c) => c.matchSource === "inferred")).toBe(true);
    expect(fsReact.overviewCalls.some((c) => c.matchSource === "inferred")).toBe(true);
    expect(fsReact.clientCalls.some((c) => c.matchSource === null)).toBe(true);
    expect(react.clientCalls.some((c) => c.componentsSource === "declared")).toBe(true);
    expect(react.clientCalls.some((c) => c.componentsSource === "inferred")).toBe(true);
    expect(react.clientCalls.some((c) => c.componentsSource === null)).toBe(true);
    expect(react.overviewCalls.some((c) => c.componentsSource === "declared")).toBe(true);
    expect(react.overviewCalls.some((c) => c.componentsSource === "inferred")).toBe(true);
    expect(react.components.some((c) => c.source === "inferred")).toBe(true);
    expect(aspnet.refs.some((r) => r.source === "inferred")).toBe(true);
    expect(all["mini-node"]!.shapes.some((s) => s.mirrors !== null && s.mirrorSource === "inferred" && s.drift !== null)).toBe(true);

    // Flow edges: an inferred, ambiguous dispatch and two declared call sites.
    const hop = (route: string, method: string): Json =>
      aspnet.hops.find((h) => h.route === route && h.method === method);
    expect(hop("PUT /api/Gadgets/{id}/retire", "SmsNotifier.Send")).toMatchObject({
      calledAt: "Services/GadgetService.cs:26", calledSource: "inferred", ambiguous: true,
    });
    expect(hop("GET /api/Gadgets/{id}", "IGadgetService.Assemble")).toMatchObject({
      calledAt: "Controllers/GadgetsController.cs:20", calledSource: "declared",
    });
    expect(hop("GET /api/Gadgets/{id}", "GadgetService.Rebalance")).toMatchObject({
      calledAt: "Services/GadgetService.cs:20", calledSource: "declared",
    });
    expect(aspnet.hops.some((h) => h.calledAt === null && h.calledSource === null)).toBe(true);
    expect(aspnet.hops.some((h) => h.calledSource === "declared")).toBe(true);
    expect(aspnet.hops.some((h) => h.calledSource === "inferred")).toBe(true);
  });
});
