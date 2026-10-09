import type { EntityGraph, Route } from "@psq/schema";

/** Code-unit order. Never localeCompare: the output must not depend on the host locale. */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function cap<T>(items: readonly T[], n: number): { items: T[]; omitted: number } {
  return { items: items.slice(0, n), omitted: Math.max(0, items.length - n) };
}

export const cite = (file: string, line?: number): string =>
  line === undefined ? file : `${file}:${line}`;

/** The optional `handler` another task adds to Route, read without depending on it. */
export type RouteHandler = { type?: string; method?: string; file?: string; line?: number };
export const handlerOf = (r: Route): RouteHandler | undefined =>
  (r as Route & { handler?: RouteHandler }).handler;

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
