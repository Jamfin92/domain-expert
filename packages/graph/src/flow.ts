import type { EntityGraph, Route } from "@psq/schema";

/**
 * Follow a C# method through the calls it makes, and say which entities the
 * methods it reaches mention.
 *
 * Pure and deterministic, like everything in this package. It reads only
 * `graph.calls`, `graph.entityRefs` and `graph.unresolvedCalls`; a graph from a
 * provider that wrote none of them yields a flow of just the start method.
 *
 * ## Identity
 *
 * A node is `type` + method NAME. psq does no overload resolution, so every
 * overload is one node — the same key `EntityRef` joins on. `file` narrows only
 * the START (two same-named types in different files); every node reached after
 * that is keyed by name alone.
 *
 * ## Order
 *
 * Breadth-first. Within a method, edges are taken in call-site order, then by
 * target. A method reachable several ways is reported once, at its shallowest
 * depth, with the first path that reached it. `nodes[0]` is the start.
 */

export interface FlowStart {
  type: string;
  method: string;
  /** Narrows the START node only. */
  file?: string;
  /** Declaration line of the start, used when no call names it. */
  line?: number;
}

export interface FlowNode {
  type: string;
  method: string;
  /** Declaring file (the first overload's, or the start's). "" when nothing names one. */
  file: string;
  line: number;
  /** Calls from the start; 0 for the start itself. */
  depth: number;
  /** `Type.method` labels from the start to this node, both included. */
  path: string[];
  /**
   * True when the path to this node crosses an edge the extractor marked
   * ambiguous: an interface with several implementers, any of which may run.
   */
  ambiguous: boolean;
  /** Distinct entity names this method itself mentions, sorted. */
  entities: string[];
  /** Calls in this method no rule could resolve (`EntityGraph.unresolvedCalls`). */
  unresolvedCalls: number;
}

export interface Flow {
  start: FlowStart;
  maxDepth: number;
  nodes: FlowNode[];
  /** Union of every node's entities, sorted. */
  entities: string[];
  /**
   * True when `maxDepth` stopped the walk with at least one method still
   * unreached. A flow that ran out of calls on its own is not truncated.
   */
  truncated: boolean;
}

export const DEFAULT_FLOW_DEPTH = 4;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const nodeKey = (type: string, method: string): string => `${type}\u0000${method}`;
const label = (type: string, method: string): string => `${type}.${method}`;

export function flowFor(
  graph: EntityGraph,
  start: FlowStart,
  opts?: { maxDepth?: number },
): Flow {
  const maxDepth = Math.max(0, Math.floor(opts?.maxDepth ?? DEFAULT_FLOW_DEPTH));
  const calls = graph.calls ?? [];

  const out = new Map<string, typeof calls>();
  for (const c of calls) {
    const k = nodeKey(c.from.type, c.from.method);
    const list = out.get(k);
    if (list) list.push(c);
    else out.set(k, [c]);
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        a.line - b.line ||
        cmp(a.to.type, b.to.type) ||
        cmp(a.to.method, b.to.method) ||
        cmp(a.to.file, b.to.file) ||
        a.to.line - b.to.line,
    );
  }

  const entitiesOf = (type: string, method: string, file?: string): string[] => {
    const names = new Set<string>();
    for (const r of graph.entityRefs) {
      if (r.type === type && r.method === method && (file === undefined || r.file === file)) {
        names.add(r.entity);
      }
    }
    return [...names].sort(cmp);
  };
  const unresolvedOf = (type: string, method: string): number => {
    let n = 0;
    for (const u of graph.unresolvedCalls ?? []) if (u.type === type && u.method === method) n += u.count;
    return n;
  };

  // Where the start is declared: an edge out of it, else what the caller said.
  const startEdges = (out.get(nodeKey(start.type, start.method)) ?? []).filter(
    (c) => start.file === undefined || c.from.file === start.file,
  );
  const startFrom = startEdges[0]?.from;
  const startNode: FlowNode = {
    type: start.type,
    method: start.method,
    file: start.file ?? startFrom?.file ?? "",
    line: start.line ?? startFrom?.line ?? 0,
    depth: 0,
    path: [label(start.type, start.method)],
    ambiguous: false,
    entities: entitiesOf(start.type, start.method, start.file),
    unresolvedCalls: unresolvedOf(start.type, start.method),
  };

  const nodes: FlowNode[] = [startNode];
  const seen = new Set<string>([nodeKey(start.type, start.method)]);
  let truncated = false;

  for (let head = 0; head < nodes.length; head++) {
    const node = nodes[head]!;
    const edges = head === 0 ? startEdges : (out.get(nodeKey(node.type, node.method)) ?? []);
    for (const c of edges) {
      const k = nodeKey(c.to.type, c.to.method);
      if (seen.has(k)) continue;
      if (node.depth >= maxDepth) {
        truncated = true;
        continue;
      }
      seen.add(k);
      nodes.push({
        type: c.to.type,
        method: c.to.method,
        file: c.to.file,
        line: c.to.line,
        depth: node.depth + 1,
        path: [...node.path, label(c.to.type, c.to.method)],
        ambiguous: node.ambiguous || c.ambiguous === true,
        entities: entitiesOf(c.to.type, c.to.method),
        unresolvedCalls: unresolvedOf(c.to.type, c.to.method),
      });
    }
  }

  const union = new Set<string>();
  for (const n of nodes) for (const e of n.entities) union.add(e);

  return { start, maxDepth, nodes, entities: [...union].sort(cmp), truncated };
}

/**
 * The flow of a route: `flowFor` from `route.handler`. Null when the route has
 * no handler (the Express reader sets none), because there is nothing to
 * start from and an empty flow would read as "touches nothing".
 */
export function routeFlow(
  graph: EntityGraph,
  route: Pick<Route, "handler">,
  opts?: { maxDepth?: number },
): Flow | null {
  const h = route.handler;
  if (!h) return null;
  return flowFor(graph, { type: h.type, method: h.method, file: h.file, line: h.line }, opts);
}
