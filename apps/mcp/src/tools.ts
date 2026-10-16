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
import { areasView, findFlow, flowView } from "./flow.js";
import {
  cap, cite, cmp, handlerOf, methodKey, segmentOf, blindSpots, identityOf, withLimit, NO_ENTITIES,
  type LimitId,
} from "./common.js";

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

/**
 * Every MCP open goes through here. `allowEmpty`: an agent can still read the
 * routes, shapes and client calls of a repo where psq found no schema, so the
 * MCP opens it and says `coverage: {entities: "none-found"}` instead of
 * refusing (the HTTP server keeps refusing; its quiz would have nothing to ask).
 * The identity is taken here, once per open, so `repoHead` is the HEAD at open.
 */
export function openRepo(ws: Workspace, path: string): OpenRepo {
  const repo = ws.open(path, { allowEmpty: true });
  identityOf(repo);
  return repo;
}

/**
 * A JSON tool result, stamped with the snapshot it was read from and, for a
 * repo with no entities, the coverage note.
 */
function stamp<T extends Record<string, unknown>>(repo: OpenRepo, body: T): T & { graphDigest: string } {
  return {
    ...body,
    ...(repo.graph.entities.length === 0 ? { coverage: NO_ENTITIES } : {}),
    graphDigest: identityOf(repo).graphDigest,
  };
}

/**
 * The answer an entity-only tool gives on a repo with no entities: a normal
 * result, not an error, because "psq found no schema" is a fact about the
 * repo, not a failure of the call.
 */
const noEntities = (repo: OpenRepo): Record<string, unknown> | null =>
  repo.graph.entities.length === 0 ? stamp(repo, { error: "no-entities" }) : null;

/** A follow-up call the answer could not show; `args` validate against `tools[tool].shape`. */
export interface Next {
  tool: ToolName;
  args: Record<string, unknown>;
  why: string;
}

const NEXT_CAP = 5;

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
  if (existsSync(ref) && statSync(ref).isDirectory()) return openRepo(ws, ref);
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
  limit: LimitId,
  shape: S,
  run: (ctx: Ctx, args: z.infer<z.ZodObject<S>>) => unknown,
) {
  return { description: withLimit(description, limit), limit, shape, run };
}

const repoArg = z
  .string()
  .optional()
  .describe("Repo id from open_repo (or a path). Optional when one repo is open.");

export const tools = {
  open_repo: def(
    "Open a repo (extract its graph) and return its id, summary counts and identity: `repoHead` " +
      "(git commit and subfolder prefix, null outside git), `extractorVersion`, `graphDigest` (every " +
      "other result carries it too) and `sourceFingerprint`. A repo with no entities opens; its results " +
      'say `coverage: {entities: "none-found"}`. Call this first.',
    "coverage",
    { path: z.string().describe("Path to the repo root") },
    (ctx, { path }) => {
      const repo = openRepo(ctx.workspace, path);
      const { repoHead, extractorVersion, sourceFingerprint } = identityOf(repo);
      return stamp(repo, { ...summaryOf(ctx.workspace, repo), repoHead, extractorVersion, sourceFingerprint });
    },
  ),

  overview: def(
    "The areas view: districts (with the basis they were derived from), components with their " +
      "client calls, and routes grouped by first path segment. Capped; see `truncated`.",
    "grouping",
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
      return stamp(repo, {
        repo: repo.id,
        districtBasis: l3.districtBasis,
        districts: districtOut,
        components: componentOut,
        routeGroups,
        truncated: Object.values(omitted).some((n) => n > 0),
        omitted,
        warnings: g.warnings.length,
      });
    },
  ),

  search_entities: def(
    "Find entities whose name, table name or property name contains the query (case-insensitive). " +
      "wholeWord=true requires the query to be a whole identifier word (camelCase and _ split words). " +
      "`next` suggests follow-up calls.",
    "entitySearch",
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
      const next: Next[] = [];
      // No `offset` yet (P3): a cut list can only be narrowed, never paged.
      if (shown.omitted > 0 && wholeWord !== true) {
        next.push({
          tool: "search_entities",
          args: { repo: repo.id, query, wholeWord: true },
          why: `${shown.omitted} hits were cut; whole-word matching narrows the list.`,
        });
      }
      for (const h of shown.items.slice(0, NEXT_CAP - next.length)) {
        next.push({
          tool: "entity",
          args: { repo: repo.id, name: h.name },
          why: "Fields, relations and mirroring shapes of this hit; a search hit shows only why it matched.",
        });
      }
      return stamp(repo, {
        query,
        wholeWord: wholeWord === true,
        searched: [...MATCH_FIELDS],
        total: hits.length,
        truncated: shown.omitted > 0,
        hits: shown.items.map((h) => ({ ...h, cite: h.file })),
        next,
      });
    },
  ),

  entity: def(
    "One entity: fields, relations in and out, shapes that mirror it, and a summary of where it is " +
      "mentioned. `next` suggests follow-up calls.",
    "mirrors",
    { repo: repoArg, name: z.string().describe("Exact entity name") },
    (ctx, { repo: ref, name }) => {
      const repo = resolveRepo(ctx, ref);
      const empty = noEntities(repo);
      if (empty) return empty;
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
      const topMethods = [...methodCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count || cmp(a[0], b[0]))
        .slice(0, 5)
        .map(([, v]) => ({ method: v.method, file: v.file, count: v.count }));

      const next: Next[] = [];
      if (refs.length > 0) {
        next.push({
          tool: "refs",
          args: { repo: repo.id, entity: e.name },
          why: `This answer counts ${refs.length} mentions; refs gives the file:line of each.`,
        });
      }
      // The busiest method's call chain, when the graph can name it uniquely.
      const top = refs.find((r) => `${r.type}.${r.method}` === topMethods[0]?.method && r.file === topMethods[0]?.file);
      if (top && findFlow(g, { handler: { type: top.type, method: top.method } }).ok) {
        next.push({
          tool: "flow",
          args: { repo: repo.id, handler: { type: top.type, method: top.method } },
          why: `${top.type}.${top.method} mentions this entity most; flow follows the calls around it.`,
        });
      }
      const related = [
        ...new Set(
          g.relations.flatMap((r) => (r.dependent === name ? [r.principal] : r.principal === name ? [r.dependent] : [])),
        ),
      ].sort(cmp);
      for (const other of related.slice(0, Math.max(0, NEXT_CAP - next.length))) {
        next.push({
          tool: "entity",
          args: { repo: repo.id, name: other },
          why: "Related entity; this answer shows only the relation, not its fields.",
        });
      }

      return stamp(repo, {
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
          topMethods,
          note: "Mentions by name, not call sites. Use the refs tool for file:line.",
        },
        next,
      });
    },
  ),

  refs: def(
    "Where an entity is MENTIONED in method bodies (file:line, enclosing type.method). Not call sites.",
    "refMentions",
    { repo: repoArg, entity: z.string(), via: RefVia.optional() },
    (ctx, { repo: ref, entity, via }) => {
      const repo = resolveRepo(ctx, ref);
      const empty = noEntities(repo);
      if (empty) return empty;
      const all = refsFor(repo.graph, entity, { via });
      const shown = cap(all, CAP.refs);
      return stamp(repo, {
        entity,
        via: via ?? null,
        known: repo.graph.entities.some((e) => e.name === entity),
        total: all.length,
        truncated: shown.omitted > 0,
        refs: shown.items.map((r) => ({
          cite: cite(r.file, r.line), type: r.type, method: r.method, via: r.via,
        })),
      });
    },
  ),

  routes: def(
    "HTTP routes with file:line (and the handler when psq knows it), optionally under a path prefix. " +
      "`next` suggests follow-up calls.",
    "missingRoutes",
    { repo: repoArg, prefix: z.string().optional() },
    (ctx, { repo: ref, prefix }) => {
      const repo = resolveRepo(ctx, ref);
      const all = repo.graph.routes.filter((r) => prefix === undefined || r.path.startsWith(prefix));
      const shown = cap(all, CAP.routes);
      const called = new Set(repo.graph.clientCalls.map((c) => c.matches));
      const next: Next[] = [];
      if (shown.omitted > 0) {
        // No `offset` yet (P3): narrow by a longer prefix, largest group first.
        const groups = new Map<string, number>();
        for (const r of all) {
          const seg = r.path.split("/").filter(Boolean);
          const depth = prefix === undefined ? 0 : prefix.split("/").filter(Boolean).length;
          if (seg.length <= depth) continue;
          const p = `/${seg.slice(0, depth + 1).join("/")}`;
          groups.set(p, (groups.get(p) ?? 0) + 1);
        }
        const ranked = [...groups].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
        for (const [p, n] of ranked.slice(0, 2)) {
          if (p === prefix) continue;
          next.push({
            tool: "routes",
            args: { repo: repo.id, prefix: p },
            why: `${shown.omitted} routes were cut; ${n} are under ${p}.`,
          });
        }
      }
      // A route list shows the handler, not what it reaches. Not on a repo with
      // no entities: flow would only answer `no-entities` there.
      for (const r of repo.graph.entities.length > 0 ? shown.items : []) {
        if (next.length >= NEXT_CAP) break;
        if (!r.handler) continue;
        const target = `${r.method} ${r.path}`;
        if (!findFlow(repo.graph, { route: target }).ok) continue;
        next.push({
          tool: "flow",
          args: { repo: repo.id, route: target },
          why: "The calls and entities this route's handler reaches.",
        });
      }
      return stamp(repo, {
        prefix: prefix ?? null,
        total: all.length,
        truncated: shown.omitted > 0,
        routes: shown.items.map((r) => ({
          ...routeItem(r),
          calledByClient: called.has(`${r.method} ${r.path}`),
        })),
        next,
      });
    },
  ),

  client_calls: def(
    "HTTP calls found in client code, with the component they attribute to and the route they matched.",
    "clientMatch",
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
      return stamp(repo, {
        component: component ?? null,
        total: all.length,
        unmatched: all.filter((c) => c.matches === null).length,
        unattributed: all.filter((c) => c.components.length === 0).length,
        truncated: shown.omitted > 0,
        calls: shown.items.map((c) => ({
          method: c.method, path: c.path, cite: cite(c.file, c.line), enclosing: c.enclosing,
          matches: c.matches, components: c.components,
        })),
      });
    },
  ),

  warnings: def(
    "Extraction warnings plus the standing list of what psq cannot see. Read this before drawing conclusions.",
    "runtime",
    { repo: repoArg },
    (ctx, { repo: ref }) => {
      const repo = resolveRepo(ctx, ref);
      return stamp(repo, {
        count: repo.graph.warnings.length,
        warnings: repo.graph.warnings,
        cannotSee: blindSpots(repo.graph),
      });
    },
  ),

  mermaid: def(
    "Mermaid erDiagram source for the entity graph; its second line is a `%% graphDigest` comment.",
    "ddlRelations",
    { repo: repoArg },
    (ctx, { repo: ref }) => {
      const repo = resolveRepo(ctx, ref);
      // After the `erDiagram` line, not inside `@psq/graph`'s `mermaid()`:
      // the server shares that function and its output starts `erDiagram\n`.
      const src = mermaid(repo.graph);
      const tag = `%% graphDigest ${identityOf(repo).graphDigest}`;
      const nl = src.indexOf("\n");
      return nl === -1 ? `${src}\n${tag}\n` : `${src.slice(0, nl + 1)}${tag}\n${src.slice(nl + 1)}`;
    },
  ),

  flow: def(
    "Follow a route (or a handler Type.method) through the method calls psq resolved, hop by hop: " +
      "file:line of each method, the call-site line, the entities each method mentions, ambiguous edges " +
      "(interface with several implementers) and unresolved-call counts. `truncated` means maxDepth " +
      "(default 4) or the node cap stopped the walk. `next` suggests follow-up calls.",
    "calls",
    {
      repo: repoArg,
      route: z.string().optional().describe('"METHOD /path" (or just the path when unique)'),
      handler: z.object({ type: z.string(), method: z.string() }).optional(),
      maxDepth: z.number().int().min(0).max(10).optional(),
    },
    (ctx, { repo: ref, route, handler, maxDepth }) => {
      const repo = resolveRepo(ctx, ref);
      const empty = noEntities(repo);
      if (empty) return empty;
      const t = findFlow(repo.graph, { route, handler, maxDepth });
      if (!t.ok) throw new Error(t.error);
      const view = flowView(repo.graph, t.flow, {
        repo: repo.id,
        route: t.route && route !== undefined ? { method: t.route.method, path: t.route.path, cite: cite(t.route.file, t.route.line) } : null,
      });
      const next: Next[] = [];
      const target = route !== undefined ? { route } : handler !== undefined ? { handler } : {};
      if (t.flow.truncated && t.flow.maxDepth < 10) {
        next.push({
          tool: "flow",
          args: { repo: repo.id, ...target, maxDepth: Math.min(10, t.flow.maxDepth + 2) },
          why: `maxDepth ${t.flow.maxDepth} stopped the walk; a deeper walk may reach more.`,
        });
      }
      const reached = [...new Set(t.flow.entities)].sort(cmp);
      for (const name of reached.slice(0, Math.max(0, NEXT_CAP - next.length))) {
        if (!repo.graph.entities.some((e) => e.name === name)) continue;
        next.push({
          tool: "entity",
          args: { repo: repo.id, name },
          why: "An entity this flow reaches; the flow shows only that it is mentioned.",
        });
      }
      return stamp(repo, { ...view, next });
    },
  ),

  areas: def(
    "Feature areas (route-derived) with their routes, components and entities, the entities shared " +
      "between areas, what is unassigned, and the cross-area edges (how one section leads into the next) " +
      "with citations. Capped; see `truncated`.",
    "grouping",
    { repo: repoArg },
    (ctx, { repo: ref }) => {
      const repo = resolveRepo(ctx, ref);
      const empty = noEntities(repo);
      if (empty) return empty;
      return stamp(repo, { repo: repo.id, ...areasView(repo.graph) });
    },
  ),

  brief: def(
    "A markdown domain brief (areas, entities, routes, call-following flow, wiring, hot spots, blind spots) " +
      "to ground a discussion. Its `> snapshot:` line names the commit, extractor and graphDigest.",
    "runtime",
    { repo: repoArg },
    (ctx, { repo: ref }) => renderBrief(ctx.workspace, resolveRepo(ctx, ref)),
  ),
};

export type ToolName = keyof typeof tools;
