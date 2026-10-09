import type { EntityGraph } from "@psq/schema";

/**
 * Feature areas: a partition of the app built only by joining facts the graph
 * already holds. Nothing here re-parses source or guesses; a thing with no
 * evidence lands in `unassigned`.
 *
 * Precedence, in order:
 *  1. A route belongs to the area named by its first path segment that is not
 *     `api`, a version (`v1`, `v2.0`) or a parameter (`:id`, `{id}`, `*`).
 *     Keys are lowercased. basis `route`.
 *  2. A route with no such segment but with a handler belongs to
 *     `dir:<handler directory>`. basis `handler-dir`. Otherwise it is unassigned.
 *  3. A handler rides its route's area.
 *  4. A component's home is an area whose key equals a directory segment of the
 *     component's file (the last such segment wins); failing that, the area of
 *     most of its matched client calls (ties: alphabetical key); failing that,
 *     unassigned.
 *  5. An entity is touched by an area when an `EntityRef` joins one of its
 *     handlers on (type, method, file). Touched by two or more areas it is
 *     shared. Its owner is the area with the most refs (ties: alphabetical key).
 *
 * Cross-area edges are how one section leads into the next:
 *  - `calls-route`: a component homed in A calls a route in B.
 *  - `touches-entity`: a handler in A mentions an entity owned by B.
 *
 * Pure and deterministic; every list is sorted. Caps are the caller's job.
 */

export type AreaBasis = "route" | "handler-dir";

export interface AreaHandler {
  type: string;
  method: string;
  file: string;
}

export interface Area {
  key: string;
  label: string;
  basis: AreaBasis;
  /** Raw "METHOD path" strings. */
  routes: string[];
  handlers: AreaHandler[];
  /** Component keys homed here. */
  components: string[];
  /** Every entity a handler here mentions. */
  entities: string[];
  /** The subset of `entities` also touched by another area. */
  sharedEntities: string[];
}

export interface AreaEdge {
  kind: "calls-route" | "touches-entity";
  from: string;
  to: string;
  /** "<component key> -> <METHOD path>" or "<Type.method> -> <entity>", sorted. */
  evidence: string[];
}

export interface AreasResult {
  areas: Area[];
  unassigned: { routes: string[]; components: string[]; entities: string[] };
  edges: AreaEdge[];
  /** Entity -> owning area key, for entities some area touches. */
  entityOwner: Record<string, string>;
}

const VERSION = /^v\d+([._]\d+)*$/i;

/** First path segment that is not `api`, a version, or a parameter; else null. */
export function areaSegment(path: string): string | null {
  for (const seg of path.split(/[?#]/)[0]!.split("/")) {
    if (seg === "" || seg === "~") continue;
    if (/[{}:*]/.test(seg)) continue;
    const low = seg.toLowerCase();
    if (low === "api" || VERSION.test(low)) continue;
    return low;
  }
  return null;
}

const dirOf = (file: string): string => {
  const i = file.lastIndexOf("/");
  return i < 0 ? "" : file.slice(0, i);
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const hKey = (h: AreaHandler): string => `${h.type}\0${h.method}\0${h.file}`;
const byHandler = (a: AreaHandler, b: AreaHandler): number => cmp(hKey(a), hKey(b));

export function areasFor(graph: EntityGraph): AreasResult {
  interface Acc {
    key: string;
    label: string;
    basis: AreaBasis;
    routes: Set<string>;
    handlers: Map<string, AreaHandler>;
    components: Set<string>;
    refCount: Map<string, number>;
  }
  const accs = new Map<string, Acc>();
  const acc = (key: string, label: string, basis: AreaBasis): Acc => {
    let a = accs.get(key);
    if (!a) {
      a = { key, label, basis, routes: new Set(), handlers: new Map(), components: new Set(), refCount: new Map() };
      accs.set(key, a);
    }
    return a;
  };

  const unRoutes = new Set<string>();
  const routeArea = new Map<string, string>(); // raw "METHOD path" -> area key

  // 1-3: routes and handlers
  for (const r of graph.routes) {
    const raw = `${r.method} ${r.path}`;
    const seg = areaSegment(r.path);
    let a: Acc | null = null;
    if (seg !== null) a = acc(seg, seg, "route");
    else if (r.handler) {
      const dir = dirOf(r.handler.file);
      a = acc(`dir:${dir}`, dir.slice(dir.lastIndexOf("/") + 1) || "(root)", "handler-dir");
    }
    if (!a) {
      unRoutes.add(raw);
      continue;
    }
    a.routes.add(raw);
    routeArea.set(raw, a.key);
    if (r.handler) {
      const h = { type: r.handler.type, method: r.handler.method, file: r.handler.file };
      a.handlers.set(hKey(h), h);
    }
  }

  // 5 (part): refs joined onto handlers
  const refsByHandler = new Map<string, string[]>();
  for (const ref of graph.entityRefs) {
    const k = hKey({ type: ref.type, method: ref.method, file: ref.file });
    const list = refsByHandler.get(k) ?? [];
    list.push(ref.entity);
    refsByHandler.set(k, list);
  }
  const touchedBy = new Map<string, Set<string>>(); // entity -> area keys
  const edgeEv = new Map<string, Set<string>>(); // kind\0from\0to -> evidence
  const addEdge = (kind: AreaEdge["kind"], from: string, to: string, ev: string): void => {
    const k = `${kind}\0${from}\0${to}`;
    const s = edgeEv.get(k) ?? new Set<string>();
    s.add(ev);
    edgeEv.set(k, s);
  };
  for (const a of accs.values()) {
    for (const hk of a.handlers.keys()) {
      for (const ent of refsByHandler.get(hk) ?? []) {
        a.refCount.set(ent, (a.refCount.get(ent) ?? 0) + 1);
        const s = touchedBy.get(ent) ?? new Set<string>();
        s.add(a.key);
        touchedBy.set(ent, s);
      }
    }
  }

  const entityOwner: Record<string, string> = {};
  for (const [ent, areas] of touchedBy) {
    let best = "";
    let bestN = -1;
    for (const k of [...areas].sort(cmp)) {
      const n = accs.get(k)!.refCount.get(ent)!;
      if (n > bestN) {
        best = k;
        bestN = n;
      }
    }
    entityOwner[ent] = best;
  }

  // handler -> entity edges across areas
  for (const a of accs.values()) {
    for (const [hk, h] of a.handlers) {
      for (const ent of new Set(refsByHandler.get(hk) ?? [])) {
        const owner = entityOwner[ent]!;
        if (owner !== a.key) addEdge("touches-entity", a.key, owner, `${h.type}.${h.method} -> ${ent}`);
      }
    }
  }

  // 4: components
    const callsByComp = new Map<string, Map<string, string[]>>(); // comp -> area -> raw routes
  for (const c of graph.clientCalls) {
    if (c.matches === null) continue;
    const area = routeArea.get(c.matches);
    if (area === undefined) continue;
    for (const ck of c.components) {
      const m = callsByComp.get(ck) ?? new Map<string, string[]>();
      const l = m.get(area) ?? [];
      l.push(c.matches);
      m.set(area, l);
      callsByComp.set(ck, m);
    }
  }
  const unComponents: string[] = [];
  const compHome = new Map<string, string>();
  for (const c of [...graph.components].sort((x, y) => cmp(x.key, y.key))) {
    const segs = dirOf(c.file).split("/").map((s) => s.toLowerCase());
    let home: string | undefined;
    for (const s of segs) if (accs.get(s)?.basis === "route") home = s;
    if (home === undefined) {
      let n = 0;
      for (const [area, l] of [...(callsByComp.get(c.key) ?? [])].sort((x, y) => cmp(x[0], y[0]))) {
        if (l.length > n) {
          home = area;
          n = l.length;
        }
      }
    }
    if (home === undefined) unComponents.push(c.key);
    else {
      accs.get(home)!.components.add(c.key);
      compHome.set(c.key, home);
    }
  }
  for (const [ck, m] of callsByComp) {
    const home = compHome.get(ck);
    if (home === undefined) continue;
    for (const [area, routes] of m) {
      if (area === home) continue;
      for (const r of routes) addEdge("calls-route", home, area, `${ck} -> ${r}`);
    }
  }

  // assemble
  const areas: Area[] = [...accs.values()]
    .sort((x, y) => cmp(x.key, y.key))
    .map((a) => {
      const entities = [...a.refCount.keys()].sort(cmp);
      return {
        key: a.key,
        label: a.label,
        basis: a.basis,
        routes: [...a.routes].sort(cmp),
        handlers: [...a.handlers.values()].sort(byHandler),
        components: [...a.components].sort(cmp),
        entities,
        sharedEntities: entities.filter((e) => touchedBy.get(e)!.size > 1),
      };
    });

  const edges: AreaEdge[] = [...edgeEv.entries()]
    .map(([k, ev]) => {
      const [kind, from, to] = k.split("\0") as [AreaEdge["kind"], string, string];
      return { kind, from, to, evidence: [...ev].sort(cmp) };
    })
    .sort((x, y) => cmp(x.kind, y.kind) || cmp(x.from, y.from) || cmp(x.to, y.to));

  const unEntities = graph.entities.map((e) => e.name).filter((n) => !touchedBy.has(n)).sort(cmp);
  return {
    areas,
    unassigned: {
      routes: [...unRoutes].sort(cmp),
      components: unComponents,
      entities: unEntities,
    },
    edges,
    entityOwner,
  };
}
