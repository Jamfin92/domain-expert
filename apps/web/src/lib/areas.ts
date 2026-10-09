import type { AreaEdge, AreasResult, Flow, Route, UiComponent } from "@/lib/api";
// Relative, not "@/": a value import through the alias does not resolve under vitest.
import { routeKey } from "./flow";

/**
 * View-model for the area-grouped Flow pane and the call-chain pane. Pure, no
 * React. Areas and flows are computed on the server (`areasFor`, `routeFlow`);
 * this file only joins them back onto the graph's routes and components and
 * shapes them for display. It derives no fact of its own.
 */

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface AreaLead {
  /** The area this one leads into. */
  area: string;
  /** Distinct edge kinds, sorted. */
  kinds: AreaEdge["kind"][];
  /** Every edge's evidence strings, sorted and deduped. */
  evidence: string[];
}

/** Outgoing cross-area edges of `key`, one entry per destination area, sorted by area. */
export function leadsTo(key: string, edges: AreaEdge[]): AreaLead[] {
  const by = new Map<string, { kinds: Set<AreaEdge["kind"]>; evidence: Set<string> }>();
  for (const e of edges) {
    if (e.from !== key) continue;
    let b = by.get(e.to);
    if (!b) by.set(e.to, (b = { kinds: new Set(), evidence: new Set() }));
    b.kinds.add(e.kind);
    for (const ev of e.evidence) b.evidence.add(ev);
  }
  return [...by.keys()].sort(cmp).map((area) => {
    const b = by.get(area) as { kinds: Set<AreaEdge["kind"]>; evidence: Set<string> };
    return { area, kinds: [...b.kinds].sort(cmp), evidence: [...b.evidence].sort(cmp) };
  });
}

export interface AreaGroup {
  key: string;
  label: string;
  /** "unassigned" is the bucket for what no area claimed; it is never a real area. */
  basis: "route" | "handler-dir" | "unassigned";
  routes: Route[];
  components: UiComponent[];
  entities: string[];
  /** Entities another area also touches, each with its owning area (null if unrecorded). */
  shared: Array<{ entity: string; owner: string | null }>;
  leadsTo: AreaLead[];
}

const byPathMethod = (a: Route, b: Route): number => cmp(a.path, b.path) || cmp(a.method, b.method);

/**
 * The server's areas joined back onto the graph's routes and components, in the
 * server's (key) order. A raw route key or component key the graph does not hold
 * is dropped, not invented. Whatever no area claimed goes into one trailing
 * "unassigned" group, present only when non-empty.
 */
export function areaGroups(
  result: AreasResult,
  routes: Route[],
  components: UiComponent[],
): AreaGroup[] {
  const compByKey = new Map(components.map((c) => [c.key, c]));
  const routesOf = (raw: string[]): Route[] => {
    const want = new Set(raw);
    return routes.filter((r) => want.has(routeKey(r))).sort(byPathMethod);
  };
  const compsOf = (keys: string[]): UiComponent[] =>
    keys
      .map((k) => compByKey.get(k))
      .filter((c): c is UiComponent => c !== undefined)
      .sort((a, b) => cmp(a.key, b.key));

  const groups: AreaGroup[] = result.areas.map((a) => ({
    key: a.key,
    label: a.label,
    basis: a.basis,
    routes: routesOf(a.routes),
    components: compsOf(a.components),
    entities: a.entities,
    shared: a.sharedEntities.map((entity) => ({ entity, owner: result.entityOwner[entity] ?? null })),
    leadsTo: leadsTo(a.key, result.edges),
  }));
  const u = result.unassigned;
  if (u.routes.length > 0 || u.components.length > 0) {
    groups.push({
      key: "(unassigned)",
      label: "(unassigned)",
      basis: "unassigned",
      routes: routesOf(u.routes),
      components: compsOf(u.components),
      entities: [],
      shared: [],
      leadsTo: [],
    });
  }
  return groups;
}

export interface FlowRow {
  key: string;
  label: string;
  depth: number;
  file: string;
  line: number;
  /** False when no file names this method. */
  located: boolean;
  ambiguous: boolean;
  entities: string[];
  unresolvedCalls: number;
}

/** The call chain as display rows, in the flow's own order (breadth-first). */
export function flowRows(flow: Flow): FlowRow[] {
  return flow.nodes.map((n, i) => ({
    key: `${i}:${n.type}.${n.method}`,
    label: `${n.type}.${n.method}`,
    depth: n.depth,
    file: n.file,
    line: n.line,
    located: n.file !== "",
    ambiguous: n.ambiguous,
    entities: n.entities,
    unresolvedCalls: n.unresolvedCalls,
  }));
}

/** The caveat a flow owes its reader, or null when it owes none. */
export function flowCaveat(flow: Flow): string | null {
  const parts: string[] = [];
  if (flow.truncated) parts.push(`truncated at depth ${flow.maxDepth}: methods below this are not shown`);
  if (flow.nodes.some((n) => n.ambiguous)) {
    parts.push("ambiguous: an interface call with several implementers, any of which may run");
  }
  return parts.length === 0 ? null : parts.join("; ");
}
