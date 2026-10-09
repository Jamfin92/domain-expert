import type { EntityGraph, Route } from "@psq/schema";

/** Code-unit order. Never localeCompare: the output must not depend on the host locale. */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function cap<T>(items: readonly T[], n: number): { items: T[]; omitted: number } {
  return { items: items.slice(0, n), omitted: Math.max(0, items.length - n) };
}

export const cite = (file: string, line?: number): string =>
  line === undefined ? file : `${file}:${line}`;

export const handlerOf = (r: Route): Route["handler"] => r.handler;

/**
 * Identity of a method: the same `Type.method` in two files is two methods
 * (`Dup.Sync` in a controller and a service). NUL cannot occur in a path.
 */
export const methodKey = (r: { file: string; type: string; method: string }): string =>
  `${r.file}\0${r.type}.${r.method}`;

/** Does this graph describe a .NET API (the attribute-route reader applies)? */
const isDotnet = (g: EntityGraph): boolean =>
  g.provider === "efcore" ||
  (g.provider === "fullstack" && (g.entityRefs.length > 0 || g.routes.some((r) => r.handler)));

/** The first path segment, the unit routes are grouped by. */
export const segmentOf = (path: string): string => path.split("/").filter(Boolean)[0] ?? "/";

/**
 * What psq cannot see, stated up front. Drawn from the schema's own catalogue
 * of misses; only the ones that can apply to this graph are returned.
 */
export function blindSpots(g: EntityGraph): string[] {
  const out = [
    "psq reads declarations and source text only: it has no runtime data, so query counts, " +
      "latency, row volumes and index usage are invisible.",
  ];
  if (g.provider === "sqlite-ddl" || g.provider === "fullstack") {
    out.push("Relations read from raw DDL are `inferred` from naming; no foreign key is declared.");
  }
  if (g.provider === "efcore" || g.provider === "fullstack") {
    out.push(
      "entityRefs are MENTIONS of an entity name inside method bodies, not call sites, and are " +
        "matched by name only: a same-named class elsewhere is reported as a ref.",
      "Constructor bodies, comments and #if blocks are not scanned for entity refs.",
    );
  }
  if (isDotnet(g)) {
    out.push(
      "psq reads ASP.NET ATTRIBUTE routes only. Conventional routing (MapControllerRoute) and " +
        "minimal APIs (MapGet, MapPost, ...) are not read; they surface as warnings.",
    );
    if (g.routes.length === 0) {
      out.push("psq found no attribute routes; the API may still have endpoints psq cannot see.");
    }
  }
  if (g.clientCalls.length > 0) {
    const matched = g.clientCalls.filter((c) => c.matches !== null).length;
    if (matched * 2 < g.clientCalls.length) {
      out.push(
        `Only ${matched} of ${g.clientCalls.length} client calls match a route psq read: ` +
          "the server side is mostly invisible to psq (routes it cannot read, or URLs it cannot resolve).",
      );
    }
  }
  if (g.clientCalls.length > 0 || g.components.length > 0) {
    out.push(
      "Client calls through wrapper functions, concatenated URLs, non-literal URLs and " +
        "baseURL-relative paths are not seen.",
      "A call is attributed only to the NEAREST component; class components and anonymous " +
        "default exports are never attributed.",
    );
  }
  return out;
}
