import { existsSync, statSync } from "node:fs";
import { z } from "zod";
import { drift } from "@psq/extract";
import { mermaid, refsFor, searchEntities, MATCH_FIELDS } from "@psq/graph";
import { RefVia } from "@psq/schema";
import type { Route } from "@psq/schema";
// `@psq/server` exports only its app; the Workspace (open, extract, id,
// layout, mermaid) is the existing store of opened repos and is reused as-is.
import { Workspace, type OpenRepo } from "../../server/src/workspace.js";
import { renderBrief } from "./brief.js";
import { cap, cite, cmp, handlerOf, methodKey, segmentOf, blindSpots } from "./common.js";

/**
 * Tool handlers. Pure functions of (context, args) returning JSON-able data,
 * exported so tests call them directly and the server only adapts them.
 *
 * Every fact comes from the EntityGraph (rule 2). Where the graph has a
 * file:line, the item carries a `cite`; where it has none (entities and
 * relations are located by file only) the cite is the file alone, never a
 * made-up line.
 */

export interface Ctx {
  workspace: Workspace;
}

export const CAP = {
  districts: 30,
  districtMembers: 40,
  components: 40,
  callsPerComponent: 10,
  routeGroups: 30,
  routesPerGroup: 12,
  hits: 50,
  refs: 100,
  routes: 200,
  calls: 200,
} as const;

/** `repo` is an open repo id, or a path to open. Omitted: the only open repo. */
export function resolveRepo(ctx: Ctx, ref?: string): OpenRepo {
  const ws = ctx.workspace;
  if (ref === undefined || ref === "") {
    const open = ws.list();
    if (open.length > 1) {
      throw new Error(
        `${open.length} repos are open (${open.map((r) => r.id).join(", ")}); pass \`repo\` to say which.`,
      );
    }
    const found = open.length === 1 ? ws.get(open[0]!.id) : undefined;
    if (found) return found;
    throw new Error("No repo is selected. Call open_repo with a path first, or pass `repo`.");
  }
  const byId = ws.get(ref);
  if (byId) return byId;
  if (existsSync(ref) && statSync(ref).isDirectory()) return ws.open(ref);
  throw new Error(
    `Unknown repo "${ref}". Open ids: ${ws.list().map((r) => r.id).join(", ") || "(none)"}. ` +
      "Call open_repo with a path.",
  );
}

function routeItem(r: Route): Record<string, unknown> {
  const h = handlerOf(r);
  return {
    method: r.method,
    path: r.path,
    cite: cite(r.file, r.line),
    ...(h ? { handler: h, handlerCite: cite(h.file, h.line) } : {}),
  };
}

function summaryOf(ws: Workspace, repo: OpenRepo): Record<string, unknown> {
  const g = repo.graph;
  return {
    id: repo.id,
    name: ws.summarize(repo).name,
    provider: g.provider,
    contextName: g.contextName,
    entities: g.entities.length,
    relations: g.relations.length,
    shapes: g.shapes.length,
    routes: g.routes.length,
    clientCalls: g.clientCalls.length,
    components: g.components.length,
    entityRefs: g.entityRefs.length,
    warnings: g.warnings.length,
    districtBasis: ws.layout3dOf(repo.id)?.districtBasis ?? "single",
  };
}

// ---------------------------------------------------------------------------

function def<S extends z.ZodRawShape>(
  description: string,
  shape: S,
  run: (ctx: Ctx, args: z.infer<z.ZodObject<S>>) => unknown,
) {
  return { description, shape, run };
}

const repoArg = z
  .string()
  .optional()
  .describe("Repo id from open_repo (or a path). Optional when one repo is open.");

export const tools = {
  open_repo: def(
    "Open a repo (extract its graph) and return its id and summary counts. Call this first.",
    { path: z.string().describe("Path to the repo root") },
    (ctx, { path }) => {
      return summaryOf(ctx.workspace, ctx.workspace.open(path));
    },
  ),

  overview: def(
    "The areas view: districts (with the basis they were derived from), components with their " +
      "client calls, and routes grouped by first path segment. Capped; see `truncated`.",
    { repo: repoArg },
    (ctx, { repo: ref }) => {
      const repo = resolveRepo(ctx, ref);
      const g = repo.graph;
      const l3 = ctx.workspace.layout3dOf(repo.id)!;

      const members = new Map<string, string[]>();
      for (const n of l3.nodes) members.set(n.district, [...(members.get(n.district) ?? []), n.name]);
      const districts = cap(l3.districts, CAP.districts);
      let omittedMembers = 0;
      const districtOut = districts.items.map((d) => {
        const m = cap(members.get(d.name) ?? [], CAP.districtMembers);
        omittedMembers += m.omitted;
        return { name: d.name, size: (members.get(d.name) ?? []).length, members: m.items };
      });

      const callsByComponent = new Map<string, Array<Record<string, unknown>>>();
      for (const c of g.clientCalls) {
        for (const key of c.components) {
          const list = callsByComponent.get(key) ?? [];
          list.push({ method: c.method, path: c.path, matches: c.matches, cite: cite(c.file, c.line) });
          callsByComponent.set(key, list);
        }
      }
      const components = cap([...g.components].sort((a, b) => cmp(a.key, b.key)), CAP.components);
      let omittedCalls = 0;
      const componentOut = components.items.map((c) => {
        const calls = cap(callsByComponent.get(c.key) ?? [], CAP.callsPerComponent);
        omittedCalls += calls.omitted;
        return {
          key: c.key,
          name: c.name,
          cite: cite(c.file, c.line),
          clientCalls: calls.items,
          clientCallCount: (callsByComponent.get(c.key) ?? []).length,
        };
      });

      const groups = new Map<string, Route[]>();
      for (const r of g.routes) groups.set(segmentOf(r.path), [...(groups.get(segmentOf(r.path)) ?? []), r]);
      const groupList = cap([...groups.entries()].sort((a, b) => cmp(a[0], b[0])), CAP.routeGroups);
      let omittedRoutes = 0;
      const routeGroups = groupList.items.map(([segment, rs]) => {
        const shown = cap(rs, CAP.routesPerGroup);
        omittedRoutes += shown.omitted;
        return { segment, count: rs.length, routes: shown.items.map(routeItem) };
      });

      const omitted = {
        districts: districts.omitted,
        districtMembers: omittedMembers,
        components: components.omitted,
        componentCalls: omittedCalls,
        routeGroups: groupList.omitted,
        routes: omittedRoutes,
      };
      return {
        repo: repo.id,
        districtBasis: l3.districtBasis,
        districts: districtOut,
        components: componentOut,
        routeGroups,
        truncated: Object.values(omitted).some((n) => n > 0),
        omitted,
        warnings: g.warnings.length,
      };
    },
  ),

  search_entities: def(
    "Find entities whose name, table name or property name contains the query (case-insensitive). " +
      "wholeWord=true requires the query to be a whole identifier word (camelCase and _ split words).",
    {
      repo: repoArg,
      query: z.string(),
      wholeWord: z.boolean().optional(),
    },
    (ctx, { repo: ref, query, wholeWord }) => {
      const repo = resolveRepo(ctx, ref);
      let hits = searchEntities(repo.graph, query);
      if (wholeWord === true) {
        const needle = query.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(^| )${needle}( |$)`);
        const words = (s: string): string =>
          s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[^A-Za-z0-9]+/g, " ").toLowerCase();
        hits = hits
          .map((h) => ({ ...h, reasons: h.reasons.filter((r) => re.test(words(r.matched))) }))
          .filter((h) => h.reasons.length > 0);
      }
      const shown = cap(hits, CAP.hits);
      return {
        query,
        wholeWord: wholeWord === true,
        searched: [...MATCH_FIELDS],
        total: hits.length,
        truncated: shown.omitted > 0,
        hits: shown.items.map((h) => ({ ...h, cite: h.file })),
      };
    },
  ),

  entity: def(
    "One entity: fields, relations in and out, shapes that mirror it, and a summary of where it is mentioned.",
    { repo: repoArg, name: z.string().describe("Exact entity name") },
    (ctx, { repo: ref, name }) => {
      const repo = resolveRepo(ctx, ref);
      const g = repo.graph;
      const e = g.entities.find((x) => x.name === name);
      if (!e) {
        const near = searchEntities(g, name).slice(0, 5).map((h) => h.name);
        throw new Error(`No entity named "${name}".${near.length ? ` Did you mean: ${near.join(", ")}?` : ""}`);
      }
      const byName = new Map(g.entities.map((x) => [x.name, x]));
      const relation = (r: (typeof g.relations)[number], other: string, nav: string | null) => ({
        id: r.id,
        other,
        foreignKey: r.foreignKeyProperty,
        navigation: nav,
        cardinality: r.cardinality,
        required: r.required,
        deleteBehavior: r.deleteBehavior,
        deleteBehaviorSource: r.deleteBehaviorSource,
        source: r.source,
        cite: byName.get(r.dependent)?.file ?? e.file,
      });
      const refs = refsFor(g, name);
      const methodCounts = new Map<string, { method: string; file: string; count: number }>();
      for (const r of refs) {
        const k = methodKey(r);
        const cur = methodCounts.get(k) ?? { method: `${r.type}.${r.method}`, file: r.file, count: 0 };
        cur.count++;
        methodCounts.set(k, cur);
      }
      const shapes = g.shapes.filter((s) => s.mirrors === name);
      return {
        name: e.name,
        namespace: e.namespace,
        tableName: e.tableName,
        dbSetName: e.dbSetName,
        cite: e.file,
        keys: e.keys,
        fields: e.properties
          .filter((p) => !p.isNavigation)
          .map((p) => ({
            name: p.name, type: p.type, nullable: p.nullable, primaryKey: p.isPrimaryKey,
            foreignKey: p.isForeignKey, maxLength: p.maxLength,
          })),
        navigations: e.properties
          .filter((p) => p.isNavigation)
          .map((p) => ({ name: p.name, type: p.type, collection: p.isCollection })),
        indexes: e.indexes,
        relations: {
          out: g.relations.filter((r) => r.dependent === name).map((r) => relation(r, r.principal, r.dependentNavigation)),
          in: g.relations.filter((r) => r.principal === name).map((r) => relation(r, r.dependent, r.principalNavigation)),
        },
        shapes: shapes.map((s) => ({
          name: s.name, kind: s.kind, cite: s.file, mirrorSource: s.mirrorSource, drift: drift(e, s),
        })),
        refs: {
          total: refs.length,
          byVia: {
            entityName: refs.filter((r) => r.via === "entityName").length,
            dbSetName: refs.filter((r) => r.via === "dbSetName").length,
          },
          files: new Set(refs.map((r) => r.file)).size,
          topMethods: [...methodCounts.entries()]
            .sort((a, b) => b[1].count - a[1].count || cmp(a[0], b[0]))
            .slice(0, 5)
            .map(([, v]) => ({ method: v.method, file: v.file, count: v.count })),
          note: "Mentions by name, not call sites. Use the refs tool for file:line.",
        },
      };
    },
  ),

  refs: def(
    "Where an entity is MENTIONED in method bodies (file:line, enclosing type.method). Not call sites.",
    { repo: repoArg, entity: z.string(), via: RefVia.optional() },
    (ctx, { repo: ref, entity, via }) => {
      const repo = resolveRepo(ctx, ref);
      const all = refsFor(repo.graph, entity, { via });
      const shown = cap(all, CAP.refs);
      return {
        entity,
        via: via ?? null,
        known: repo.graph.entities.some((e) => e.name === entity),
        total: all.length,
        truncated: shown.omitted > 0,
        refs: shown.items.map((r) => ({
          cite: cite(r.file, r.line), type: r.type, method: r.method, via: r.via,
        })),
      };
    },
  ),

  routes: def(
    "HTTP routes with file:line (and the handler when psq knows it), optionally under a path prefix.",
    { repo: repoArg, prefix: z.string().optional() },
    (ctx, { repo: ref, prefix }) => {
      const repo = resolveRepo(ctx, ref);
      const all = repo.graph.routes.filter((r) => prefix === undefined || r.path.startsWith(prefix));
      const shown = cap(all, CAP.routes);
      const called = new Set(repo.graph.clientCalls.map((c) => c.matches));
      return {
        prefix: prefix ?? null,
        total: all.length,
        truncated: shown.omitted > 0,
        routes: shown.items.map((r) => ({
          ...routeItem(r),
          calledByClient: called.has(`${r.method} ${r.path}`),
        })),
      };
    },
  ),

  client_calls: def(
    "HTTP calls found in client code, with the component they attribute to and the route they matched.",
    { repo: repoArg, component: z.string().optional().describe("Component key or name") },
    (ctx, { repo: ref, component }) => {
      const repo = resolveRepo(ctx, ref);
      const g = repo.graph;
      const keys = new Set(
        component === undefined
          ? []
          : g.components.filter((c) => c.key === component || c.name === component).map((c) => c.key),
      );
      const all = g.clientCalls.filter(
        (c) => component === undefined || c.components.some((k) => keys.has(k)),
      );
      const shown = cap(all, CAP.calls);
      return {
        component: component ?? null,
        total: all.length,
        unmatched: all.filter((c) => c.matches === null).length,
        unattributed: all.filter((c) => c.components.length === 0).length,
        truncated: shown.omitted > 0,
        calls: shown.items.map((c) => ({
          method: c.method, path: c.path, cite: cite(c.file, c.line), enclosing: c.enclosing,
          matches: c.matches, components: c.components,
        })),
      };
    },
  ),

  warnings: def(
    "Extraction warnings plus the standing list of what psq cannot see. Read this before drawing conclusions.",
    { repo: repoArg },
    (ctx, { repo: ref }) => {
      const repo = resolveRepo(ctx, ref);
      return {
        count: repo.graph.warnings.length,
        warnings: repo.graph.warnings,
        cannotSee: blindSpots(repo.graph),
      };
    },
  ),

  mermaid: def(
    "Mermaid erDiagram source for the entity graph.",
    { repo: repoArg },
    (ctx, { repo: ref }) => mermaid(resolveRepo(ctx, ref).graph),
  ),

  brief: def(
    "A markdown domain brief (areas, entities, routes, wiring, hot spots, blind spots) to ground a discussion.",
    { repo: repoArg },
    (ctx, { repo: ref }) => renderBrief(ctx.workspace, resolveRepo(ctx, ref)),
  ),
};

export type ToolName = keyof typeof tools;
