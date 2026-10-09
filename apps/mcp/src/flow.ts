import { areasFor, flowFor, routeFlow, DEFAULT_FLOW_DEPTH } from "@psq/graph";
import type { Flow, FlowNode } from "@psq/graph";
import type { EntityGraph, Route } from "@psq/schema";
import { cap, cite, cmp } from "./common.js";

/**
 * Views over the graph's flow and areas, shared by the tools and the brief so
 * the two cannot disagree. Pure: nothing here reads source or guesses.
 */

export const FLOW_CAP = { nodes: 200, areas: 40, routesPerArea: 15, entitiesPerArea: 30, edges: 60, evidence: 5, unassigned: 30 } as const;

export const INLINE = "<inline>";

export const rawRoute = (r: Pick<Route, "method" | "path">): string => `${r.method} ${r.path}`;

/** An entity a flow reaches: shallowest depth, preferring a path with no ambiguous edge. */
export interface Reached {
  entity: string;
  depth: number;
  via: string;
  ambiguous: boolean;
}

export function reachedEntities(f: Flow): Reached[] {
  const best = new Map<string, Reached>();
  for (const n of f.nodes) {
    for (const entity of n.entities) {
      const cur = best.get(entity);
      // Nodes are in breadth-first order, so the first sighting is the shallowest;
      // only a clean path may displace an ambiguous one.
      if (!cur || (cur.ambiguous && !n.ambiguous)) {
        best.set(entity, { entity, depth: n.depth, via: `${n.type}.${n.method}`, ambiguous: n.ambiguous });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.depth - b.depth || cmp(a.entity, b.entity));
}

export const unresolvedTotal = (g: EntityGraph): number =>
  (g.unresolvedCalls ?? []).reduce((n, u) => n + u.count, 0);

/** The call-site line of the edge that first reached `node`, from its parent. */
function callSite(g: EntityGraph, node: FlowNode): string | null {
  if (node.path.length < 2) return null;
  const parent = node.path[node.path.length - 2]!;
  const me = node.path[node.path.length - 1]!;
  let best: { file: string; line: number } | null = null;
  for (const c of g.calls ?? []) {
    if (`${c.from.type}.${c.from.method}` !== parent || `${c.to.type}.${c.to.method}` !== me) continue;
    if (!best || c.line < best.line || (c.line === best.line && cmp(c.from.file, best.file) < 0)) {
      best = { file: c.from.file, line: c.line };
    }
  }
  return best ? cite(best.file, best.line) : null;
}

export function flowView(g: EntityGraph, f: Flow, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const shown = cap(f.nodes, FLOW_CAP.nodes);
  const inline = f.start.method === INLINE;
  return {
    ...extra,
    start: { type: f.start.type, method: f.start.method, cite: cite(f.nodes[0]!.file, f.nodes[0]!.line) },
    maxDepth: f.maxDepth,
    truncated: f.truncated || shown.omitted > 0,
    truncatedByDepth: f.truncated,
    omittedNodes: shown.omitted,
    entities: f.entities,
    reached: reachedEntities(f),
    unresolvedCalls: f.nodes.reduce((n, x) => n + x.unresolvedCalls, 0),
    hops: shown.items.map((n) => ({
      depth: n.depth,
      method: `${n.type}.${n.method}`,
      cite: cite(n.file, n.line),
      calledAt: callSite(g, n),
      path: n.path,
      ambiguous: n.ambiguous,
      entities: n.entities,
      unresolvedCalls: n.unresolvedCalls,
    })),
    notes: [
      ...(inline
        ? ["Inline handler: psq reads no calls inside it, so the flow is only what it mentions by name."]
        : g.calls === undefined
          ? ["This graph carries no call edges: only entities mentioned in the handler body are shown."]
          : []),
      "Calls are resolved syntactically (DI fields typed by repo interfaces, this/static calls); " +
        "unresolved calls are counted, not followed. Overloads are not distinguished. " +
        "`ambiguous` marks a path through an interface with several implementers: any of them may run.",
    ],
  };
}

export type FlowTarget =
  | { ok: true; flow: Flow; route: Route | null }
  | { ok: false; error: string };

export function findFlow(
  g: EntityGraph,
  args: { route?: string; handler?: { type: string; method: string }; maxDepth?: number },
): FlowTarget {
  const opts = { maxDepth: args.maxDepth ?? DEFAULT_FLOW_DEPTH };
  if ((args.route === undefined) === (args.handler === undefined)) {
    return { ok: false, error: "Pass exactly one of `route` (\"GET /path\" or just the path) or `handler` ({type, method})." };
  }
  if (args.route !== undefined) {
    const want = args.route.trim();
    const hits = g.routes.filter((r) => rawRoute(r) === want || r.path === want);
    if (hits.length === 0) return { ok: false, error: `No route "${want}". Use the routes tool to list them.` };
    if (hits.length > 1) {
      return { ok: false, error: `"${want}" matches ${hits.length} routes (${hits.map(rawRoute).join(", ")}); pass "METHOD path".` };
    }
    const route = hits[0]!;
    const flow = routeFlow(g, route, opts);
    if (!flow) return { ok: false, error: `Route "${rawRoute(route)}" has no handler psq could name, so there is nothing to follow.` };
    return { ok: true, flow, route };
  }
  const { type, method } = args.handler!;
  const routes = g.routes.filter((r) => r.handler?.type === type && r.handler.method === method);
  const files = new Set<string>(routes.map((r) => r.handler!.file));
  if (files.size === 0) {
    for (const c of g.calls ?? []) if (c.from.type === type && c.from.method === method) files.add(c.from.file);
  }
  if (files.size === 0) {
    for (const r of g.entityRefs) if (r.type === type && r.method === method) files.add(r.file);
  }
  if (files.size === 0) return { ok: false, error: `No method ${type}.${method} is known to the graph (no route handler, call or entity mention).` };
  if (files.size > 1) {
    return { ok: false, error: `${type}.${method} is declared in ${files.size} files (${[...files].sort(cmp).join(", ")}); pass \`route\` instead.` };
  }
  const file = [...files][0]!;
  const h = routes.find((r) => r.handler!.file === file)?.handler;
  const flow = flowFor(g, { type, method, file, ...(h ? { line: h.line } : {}) }, opts);
  return { ok: true, flow, route: routes[0] ?? null };
}

// ---------------------------------------------------------------------------

/** Cite for the `Type.method` of a route handler, when some route names it. */
function handlerCite(g: EntityGraph, label: string): string | null {
  const r = g.routes.find((x) => x.handler && `${x.handler.type}.${x.handler.method}` === label);
  return r?.handler ? cite(r.handler.file, r.handler.line) : null;
}

function evidenceCite(g: EntityGraph, kind: string, ev: string): { text: string; cites: string[] } {
  const [left, right] = ev.split(" -> ") as [string, string];
  if (kind === "touches-entity") {
    const c = handlerCite(g, left);
    return { text: ev, cites: c ? [c] : [] };
  }
  const comp = g.components.find((x) => x.key === left);
  const route = g.routes.find((x) => rawRoute(x) === right);
  return {
    text: ev,
    cites: [comp ? cite(comp.file, comp.line) : null, route ? cite(route.file, route.line) : null].filter(
      (x): x is string => x !== null,
    ),
  };
}

export function areasView(g: EntityGraph): Record<string, unknown> {
  const res = areasFor(g);
  const areas = cap(res.areas, FLOW_CAP.areas);
  const edges = cap(res.edges, FLOW_CAP.edges);
  const omitted = { areas: areas.omitted, routes: 0, entities: 0, edges: edges.omitted, evidence: 0, unassigned: 0 };
  const un = (xs: string[]): string[] => {
    const c = cap(xs, FLOW_CAP.unassigned);
    omitted.unassigned += c.omitted;
    return c.items;
  };
  const areaOut = areas.items.map((a) => {
    const routes = cap(a.routes, FLOW_CAP.routesPerArea);
    const ents = cap(a.entities, FLOW_CAP.entitiesPerArea);
    omitted.routes += routes.omitted;
    omitted.entities += ents.omitted;
    return {
      key: a.key,
      label: a.label,
      basis: a.basis,
      routeCount: a.routes.length,
      routes: routes.items,
      handlers: a.handlers.length,
      components: a.components,
      entities: ents.items,
      entityCount: a.entities.length,
      sharedEntities: a.sharedEntities,
    };
  });
  const edgeOut = edges.items.map((e) => {
    const ev = cap(e.evidence, FLOW_CAP.evidence);
    omitted.evidence += ev.omitted;
    return {
      kind: e.kind,
      from: e.from,
      to: e.to,
      evidenceCount: e.evidence.length,
      evidence: ev.items.map((x) => evidenceCite(g, e.kind, x)),
    };
  });
  return {
    areas: areaOut,
    edges: edgeOut,
    unassigned: {
      routes: un(res.unassigned.routes),
      components: un(res.unassigned.components),
      entities: un(res.unassigned.entities),
      counts: {
        routes: res.unassigned.routes.length,
        components: res.unassigned.components.length,
        entities: res.unassigned.entities.length,
      },
    },
    truncated: Object.values(omitted).some((n) => n > 0),
    omitted,
    notes: [
      "An area's entities are those its route handlers mention directly by name; calls into services are " +
        "not followed here (use the flow tool per route).",
      "Areas come from the first path segment that is not api/version/parameter; edges are " +
        "`calls-route` (a component calls a route in another area) and `touches-entity` (a handler " +
        "mentions an entity owned by another area).",
    ],
  };
}
