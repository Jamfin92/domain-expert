import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FactSource } from "@psq/schema";
import { Workspace } from "../../server/src/workspace.js";
import { cite } from "../src/common.js";
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
  /** The graph the tools read, after any perturbation. */
  graph: Json;
  routes: Json[];
  overviewRoutes: Json[];
  components: Json[];
  overviewCalls: Json[];
  clientCalls: Json[];
  refs: Json[];
  hops: Array<Json & { route: string }>;
  shapes: Json[];
}

/**
 * Every projected item of every fact-returning tool on one fixture. `perturb`
 * edits the open repo's in-memory graph before any tool reads it.
 */
function sweep(path: string, perturb?: (g: Json) => void): Seen {
  ctx.workspace.closeAll();
  const id = (tools.open_repo.run(ctx, { path }) as Json).id;
  const g = ctx.workspace.get(id)!.graph;
  perturb?.(g);
  const run = (tool: keyof typeof tools, args: Json = {}): Json => (tools[tool].run as (c: Ctx, a: Json) => unknown)(ctx, args) as Json;

  const overview = run("overview");
  const seen: Seen = {
    graph: g,
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

/** Group `items` by `key` and sort each group's values: a multiset per key. */
function multiset<T>(items: readonly T[], key: (x: T) => string, value: (x: T) => unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const x of items) (out[key(x)] ??= []).push(JSON.stringify(value(x)));
  for (const k of Object.keys(out)) out[k]!.sort();
  return out;
}

/** D3's rule, read off the graph: the first matching client call in (file, line) order. */
function expectedCalledBy(g: Json, key: string): Json {
  const first = g.clientCalls
    .filter((c: Json) => c.matches === key)
    .sort((a: Json, b: Json) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))[0];
  return first ? first.matchSource : null;
}

/**
 * P2d D1: every projected source EQUALS the graph fact's own, looked up by a
 * stable key (a multiset per key where the key is not unique). Validity alone
 * passes a projection that hardcodes the one source real data happens to hold.
 */
function expectEqualsGraph(s: Seen, path: string): void {
  const g = s.graph;
  const routeKey = (r: Json): string => `${r.method} ${r.path}`;
  const graphRoutes = multiset(g.routes, routeKey, (r: Json) => r.source);
  expect(multiset(s.routes, routeKey, (r) => r.source), `${path} routes`).toEqual(graphRoutes);
  for (const [k, v] of Object.entries(multiset(s.overviewRoutes, routeKey, (r) => r.source))) {
    expect(v, `${path} overview route ${k}`).toEqual(graphRoutes[k]);
  }
  for (const r of s.routes) {
    const want = expectedCalledBy(g, routeKey(r));
    expect(r.calledByClientSource, `${path} calledByClientSource ${routeKey(r)}`).toBe(want);
    expect(r.calledByClientSource === null, `${path} ${routeKey(r)}`).toBe(!r.calledByClient);
  }

  // No component is cut by the overview cap on these fixtures, so the lookup below is not vacuous.
  expect(s.components.length, `${path} components`).toBe(g.components.length);
  const graphComponents = multiset(g.components, (c: Json) => c.key, (c: Json) => c.source);
  for (const [k, v] of Object.entries(multiset(s.components, (c) => c.key, (c) => c.source))) {
    expect(v, `${path} component ${k}`).toEqual(graphComponents[k]);
  }

  const callKey = (c: Json): string => cite(c.file, c.line);
  const callFacts = (c: Json) => [c.matches, c.matchSource, c.componentsSource];
  expect(multiset(s.clientCalls, (c) => c.cite, callFacts), `${path} client calls`)
    .toEqual(multiset(g.clientCalls, callKey, callFacts));
  // Nested under a component: the graph calls attributed to THAT component.
  for (const comp of s.components) {
    const graphNested = multiset(
      g.clientCalls.filter((c: Json) => c.components.includes(comp.key)), callKey, callFacts,
    );
    for (const [k, v] of Object.entries(multiset(comp.clientCalls as Json[], (c) => c.cite, callFacts))) {
      expect(v, `${path} ${comp.key} nested ${k}`).toEqual(graphNested[k]);
    }
  }

  expect(multiset(s.refs, (r) => r.cite, (r) => r.source), `${path} refs`)
    .toEqual(multiset(g.entityRefs, callKey, (r: Json) => r.source));

  const shapeKey = (x: Json): string => `${x.name} ${x.cite ?? x.file}`;
  expect(multiset(s.shapes, shapeKey, (x) => [x.mirrors, x.mirrorSource]), `${path} shapes`)
    .toEqual(multiset(g.shapes, shapeKey, (x: Json) => [x.mirrors, x.mirrorSource]));

  // Flow hops: the call edge (path[-2] -> path[-1]) at `calledAt`.
  for (const h of s.hops) {
    const label = `${path} ${h.route} ${h.method}`;
    const [parent, me] = [h.path[h.path.length - 2], h.path[h.path.length - 1]];
    const edges = (g.calls ?? []).filter(
      (c: Json) => `${c.from.type}.${c.from.method}` === parent && `${c.to.type}.${c.to.method}` === me,
    );
    if (h.calledAt === null) {
      expect(edges, label).toEqual([]);
      continue;
    }
    const at = edges.filter((c: Json) => cite(c.from.file, c.line) === h.calledAt);
    expect(at.length, label).toBeGreaterThan(0);
    expect(at.map((c: Json) => c.source), label).toContain(h.calledSource);
  }
}

/**
 * Every second component, ref, matched client call and paired shape, in graph
 * order, becomes `declared`. On real data they are all `inferred`, so without
 * this a projection that hardcodes `inferred` passes the equality sweep.
 */
function perturb(g: Json): void {
  const everySecond = (xs: Json[], set: (x: Json) => void): void => xs.forEach((x, i) => { if (i % 2 === 1) set(x); });
  everySecond(g.components, (c) => { c.source = "declared"; });
  everySecond(g.entityRefs, (r) => { r.source = "declared"; });
  everySecond(g.clientCalls.filter((c: Json) => c.matches !== null), (c) => { c.matchSource = "declared"; });
  everySecond(g.shapes.filter((x: Json) => x.mirrors !== null), (x) => { x.mirrorSource = "declared"; });
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

  // P2d D1(a).
  it("projects every source equal to the graph fact's own", () => {
    const all: Record<string, Seen> = {};
    for (const [name, path] of Object.entries(FIXTURES)) {
      all[name] = sweep(path);
      expectEqualsGraph(all[name]!, name);
    }
    // Controls for calledByClientSource: both branches occur, so an all-null or never-null column fails.
    expect(all["mini-fullstack-react"]!.routes.some((r) => r.calledByClientSource === "inferred")).toBe(true);
    expect(all["mini-aspnet-routes"]!.routes.some((r) => r.calledByClientSource === null)).toBe(true);
    expect(all["mini-aspnet-routes"]!.hops).toHaveLength(49);
  });

  // P2d D1(b).
  it("still projects every source equal to the graph's after the graph is perturbed", () => {
    const all: Record<string, Seen> = {};
    for (const [name, path] of Object.entries(FIXTURES)) {
      all[name] = sweep(path, perturb);
      expectInvariants(all[name]!, name);
      expectEqualsGraph(all[name]!, name);
    }
    // Controls: the perturbation reached every family it targets, with both values present.
    const both = (xs: Json[], f: (x: Json) => unknown): void => {
      expect(xs.some((x) => f(x) === "declared")).toBe(true);
      expect(xs.some((x) => f(x) === "inferred")).toBe(true);
    };
    both(all["mini-react"]!.components, (c) => c.source);
    both(all["mini-aspnet-routes"]!.refs, (r) => r.source);
    both(all["mini-efcore-refs"]!.refs, (r) => r.source);
    both(all["mini-fullstack-react"]!.clientCalls, (c) => c.matchSource);
    both(all["mini-fullstack-react"]!.overviewCalls, (c) => c.matchSource);
    both(all["mini-node"]!.shapes, (x) => x.mirrorSource);
  });
});
