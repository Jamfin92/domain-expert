import type { ClientCall, EntityRef, Route, RouteHandler, UiComponent } from "@/lib/api";

/**
 * The joins behind the Flow view: area -> call -> route -> handler -> entities.
 * Pure, no React, so every rule is unit-testable without a renderer.
 *
 * Nothing here infers a fact. Each hop is an exact-string join on something the
 * extractor already wrote down, and a join that finds nothing says so rather
 * than guessing. `import type` only: see client-calls.ts for why.
 */

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The raw "METHOD path" key `ClientCall.matches` stores. */
export function routeKey(route: Pick<Route, "method" | "path">): string {
  return `${route.method} ${route.path}`;
}

export interface ComponentArea {
  /** Directory of the declaring file; "(root)" for a file at the repo root. */
  dir: string;
  components: UiComponent[];
}

/** Components grouped by directory, directories and members in code-unit order. */
export function componentAreas(components: UiComponent[]): ComponentArea[] {
  const byDir = new Map<string, UiComponent[]>();
  for (const c of components) {
    const slash = c.file.lastIndexOf("/");
    const dir = slash === -1 ? "(root)" : c.file.slice(0, slash);
    const bucket = byDir.get(dir);
    if (bucket) bucket.push(c);
    else byDir.set(dir, [c]);
  }
  return [...byDir.keys()]
    .sort(cmp)
    .map((dir) => ({
      dir,
      components: [...(byDir.get(dir) as UiComponent[])].sort((a, b) => cmp(a.key, b.key)),
    }));
}

export interface RouteArea {
  /** First path segment; "/" for the root path. */
  segment: string;
  routes: Route[];
}

export function firstSegment(path: string): string {
  const seg = path.split("/").find((s) => s !== "");
  return seg === undefined ? "/" : seg;
}

/** Routes grouped by first path segment, routes ordered by path then method. */
export function routeAreas(routes: Route[]): RouteArea[] {
  const bySeg = new Map<string, Route[]>();
  for (const r of routes) {
    const seg = firstSegment(r.path);
    const bucket = bySeg.get(seg);
    if (bucket) bucket.push(r);
    else bySeg.set(seg, [r]);
  }
  return [...bySeg.keys()]
    .sort(cmp)
    .map((segment) => ({
      segment,
      routes: [...(bySeg.get(segment) as Route[])].sort(
        (a, b) => cmp(a.path, b.path) || cmp(a.method, b.method),
      ),
    }));
}

/**
 * Every route a call's `matches` key names. Usually one. More than one means
 * two routes share a method and path (different files); the caller shows all of
 * them instead of choosing. Empty for an unmatched call, and for a `matches`
 * that no route carries.
 */
export function resolveRoutes(call: ClientCall, routes: Route[]): Route[] {
  if (call.matches === null) return [];
  return routes.filter((r) => routeKey(r) === call.matches);
}

export interface CallHop {
  call: ClientCall;
  routes: Route[];
}

/** The calls a component owns, each with the routes it resolves to. */
export function callsOfComponent(
  component: UiComponent,
  calls: ClientCall[],
  routes: Route[],
): CallHop[] {
  return calls
    .filter((c) => c.components.includes(component.key))
    .sort((a, b) => cmp(a.file, b.file) || a.line - b.line)
    .map((call) => ({ call, routes: resolveRoutes(call, routes) }));
}

export interface RouteReach {
  calls: ClientCall[];
  /** Components owning any of `calls`, deduped, by key. Keys with no component are dropped. */
  components: UiComponent[];
}

/** Reverse index: route key -> the calls that matched it, and who owns them. */
export function buildReverseIndex(
  calls: ClientCall[],
  components: UiComponent[],
): Map<string, RouteReach> {
  const byKey = new Map<string, UiComponent>();
  for (const c of components) byKey.set(c.key, c);
  const index = new Map<string, RouteReach>();
  for (const call of calls) {
    if (call.matches === null) continue;
    let reach = index.get(call.matches);
    if (!reach) {
      reach = { calls: [], components: [] };
      index.set(call.matches, reach);
    }
    reach.calls.push(call);
    for (const key of call.components) {
      const comp = byKey.get(key);
      if (comp && !reach.components.some((c) => c.key === key)) reach.components.push(comp);
    }
  }
  for (const reach of index.values()) {
    reach.calls.sort((a, b) => cmp(a.file, b.file) || a.line - b.line);
    reach.components.sort((a, b) => cmp(a.key, b.key));
  }
  return index;
}

export function reachOfRoute(route: Route, index: Map<string, RouteReach>): RouteReach {
  return index.get(routeKey(route)) ?? { calls: [], components: [] };
}

export interface EntityTouch {
  entity: string;
  refs: EntityRef[];
}

/**
 * The entities a handler's method mentions: `entityRefs` joined on exactly
 * `(type, method)`. `null` means the route carries no handler — unknown, which
 * is a different statement from `[]`, a known handler that mentions no entity.
 *
 * A mention, not a call (see `EntityRef`): this is what the method names, and
 * the view says "mentions", not "reads" or "writes". Overloads share a name and
 * are not told apart.
 */
export function entitiesOfHandler(
  handler: RouteHandler | undefined,
  refs: EntityRef[],
): EntityTouch[] | null {
  if (!handler) return null;
  const byEntity = new Map<string, EntityRef[]>();
  for (const r of refs) {
    if (r.type !== handler.type || r.method !== handler.method) continue;
    const bucket = byEntity.get(r.entity);
    if (bucket) bucket.push(r);
    else byEntity.set(r.entity, [r]);
  }
  return [...byEntity.keys()].sort(cmp).map((entity) => ({
    entity,
    refs: [...(byEntity.get(entity) as EntityRef[])].sort(
      (a, b) => cmp(a.file, b.file) || a.line - b.line,
    ),
  }));
}
