import { degrees, orphans, routeFlow, DEFAULT_FLOW_DEPTH } from "@psq/graph";
import type { Workspace, OpenRepo } from "../../server/src/workspace.js";
import { blindSpots, cap, cite, cmp, handlerOf, methodKey, segmentOf } from "./common.js";
import { INLINE, areasView, reachedEntities, unresolvedTotal, type Reached } from "./flow.js";

/**
 * The domain brief: one markdown document an agent reads before discussing a
 * repo. Every line is rendered from the graph; nothing is summarised by a
 * model, and every list that is cut says how much it dropped.
 */

export const INSTRUCTION =
  'Every claim must cite a graph fact (file:line); say "psq cannot see this" rather than guess.';

const LIMIT = {
  entities: 60, routes: 60, components: 30, hot: 10, warnings: 20,
  districts: 30, districtMembers: 15, callsPerComponent: 10,
  flowRoutes: 15, flowEntities: 8, areas: 20, areaRoutes: 4, areaEntities: 8, areaEdges: 15, areaEvidence: 2,
} as const;

/** The brief stays under this many characters; the caps shrink until it does. */
export const BRIEF_BUDGET = 20_000;
const SCALES = [1, 0.5, 0.25, 0.1] as const;

export function renderBrief(ws: Workspace, repo: OpenRepo): string {
  let out = "";
  for (const scale of SCALES) {
    out = renderAt(ws, repo, scale);
    if (out.length <= BRIEF_BUDGET) break;
  }
  return out;
}

function renderAt(ws: Workspace, repo: OpenRepo, scale: number): string {
  const L = Object.fromEntries(
    Object.entries(LIMIT).map(([k, v]) => [k, Math.max(1, Math.floor(v * scale))]),
  ) as Record<keyof typeof LIMIT, number>;
  const g = repo.graph;
  const l3 = ws.layout3dOf(repo.id)!;
  const out: string[] = [];
  const more = (n: number, what: string): void => {
    if (n > 0) out.push(`- … ${n} more ${what} not shown (use the tools for the full list)`);
  };

  out.push(`# Domain brief: ${ws.summarize(repo).name}`, "", `> ${INSTRUCTION}`, "");
  if (scale < 1) {
    out.push(`> Lists are cut to ${Math.round(scale * 100)}% of their usual length to keep this brief under ${BRIEF_BUDGET} characters; use the tools for the full lists.`, "");
  }
  out.push(
    `Provider \`${g.provider}\`${g.contextName ? `, context \`${g.contextName}\`` : ""}: ` +
      `${g.entities.length} entities, ${g.relations.length} relations, ${g.routes.length} routes, ` +
      `${g.clientCalls.length} client calls, ${g.components.length} components, ` +
      `${g.entityRefs.length} entity refs, ${g.warnings.length} warnings.`,
    "",
  );

  // Areas
  out.push(`## Areas (districts by \`${l3.districtBasis}\`)`, "");
  const members = new Map<string, string[]>();
  for (const n of l3.nodes) members.set(n.district, [...(members.get(n.district) ?? []), n.name]);
  const districts = cap(l3.districts, L.districts);
  for (const d of districts.items) {
    const m = cap(members.get(d.name) ?? [], L.districtMembers);
    out.push(
      `- **${d.name}** (${(members.get(d.name) ?? []).length}): ${m.items.join(", ")}` +
        (m.omitted > 0 ? `, … ${m.omitted} more` : ""),
    );
  }
  more(districts.omitted, "areas");
  out.push("");

  // Entities
  out.push("## Entities and relations", "");
  const sorted = [...g.entities].sort((a, b) => cmp(a.name, b.name));
  const shownEntities = cap(sorted, L.entities);
  for (const e of shownEntities.items) {
    const fk = g.relations.filter((r) => r.dependent === e.name);
    const inbound = g.relations.filter((r) => r.principal === e.name);
    const parts = [
      fk.length ? `references ${fk.map((r) => `${r.principal}${r.source === "inferred" ? " (inferred)" : ""}`).join(", ")}` : "",
      inbound.length ? `referenced by ${inbound.map((r) => r.dependent).join(", ")}` : "",
    ].filter(Boolean);
    out.push(
      `- **${e.name}** (${e.file}) — ${e.properties.filter((p) => !p.isNavigation).length} fields` +
        (parts.length ? `; ${parts.join("; ")}` : "; no relations"),
    );
  }
  more(shownEntities.omitted, "entities");
  out.push("");

  // Routes
  out.push("## Routes", "");
  if (g.routes.length === 0) out.push("- none found");
  const routes = cap(g.routes, L.routes);
  const byGroup = new Map<string, number>();
  for (const r of g.routes) byGroup.set(segmentOf(r.path), (byGroup.get(segmentOf(r.path)) ?? 0) + 1);
  if (g.routes.length > 0) {
    out.push(`Groups: ${[...byGroup].sort((a, b) => cmp(a[0], b[0])).map(([k, n]) => `${k} (${n})`).join(", ")}`);
  }
  for (const r of routes.items) {
    const h = handlerOf(r);
    out.push(
      `- \`${r.method} ${r.path}\` (${cite(r.file, r.line)})` +
        (h ? ` → ${h.type}.${h.method} (${cite(h.file, h.line)})` : ""),
    );
  }
  more(routes.omitted, "routes");
  out.push("");

  // Flow: route -> handler -> entities reached through resolved calls
  const withHandler = g.routes.filter((r) => r.handler);
  if (withHandler.length > 0) {
    out.push(`## Flow (route → handler → entities reached through resolved calls, depth ≤ ${DEFAULT_FLOW_DEPTH})`, "");
    const flows = withHandler.map((r) => {
      const f = routeFlow(g, r)!;
      return { r, f, reached: reachedEntities(f) };
    });
    // Routes reaching entities come first (most entities first, then method+path
    // so the order is stable); the rest are counted, not listed.
    const bearing = flows
      .filter((x) => x.reached.length > 0)
      .sort(
        (a, b) =>
          b.reached.length - a.reached.length || cmp(`${a.r.method} ${a.r.path}`, `${b.r.method} ${b.r.path}`),
      );
    const bare = flows.filter((x) => x.reached.length === 0);
    const shownFlows = cap(bearing, L.flowRoutes);
    const render = (e: Reached): string =>
      e.depth === 0 ? e.entity : `${e.entity} (depth ${e.depth} via ${e.via}${e.ambiguous ? ", ambiguous" : ""})`;
    if (bearing.length === 0) out.push("- no handler reaches an entity psq can see");
    for (const { r, f, reached } of shownFlows.items) {
      const h = r.handler!;
      const ents = cap(reached, L.flowEntities);
      out.push(
        `- \`${r.method} ${r.path}\` → ${h.type}.${h.method} (${cite(h.file, h.line)}): ` +
          ents.items.map(render).join(", ") + (ents.omitted > 0 ? `, … ${ents.omitted} more` : "") +
          (f.truncated ? ` [stopped at depth ${f.maxDepth}]` : ""),
      );
    }
    more(shownFlows.omitted, "routes with handlers");
    const inline = bare.filter((x) => x.r.handler!.method === INLINE).length;
    const named = bare.length - inline;
    if (named > 0) {
      out.push(
        `- ${named} more routes with named handlers reach no entity psq can see (calls psq cannot resolve are not followed)`,
      );
    }
    if (inline > 0) {
      out.push(
        `- ${inline} more routes have inline handlers: psq reads no calls inside an inline handler, so what they reach is unknown`,
      );
    }
    if (g.calls !== undefined) {
      const un = unresolvedTotal(g);
      out.push(
        "- calls are resolved syntactically (DI fields typed by repo interfaces, this/static calls); " +
          `${un} calls in ${(g.unresolvedCalls ?? []).length} methods are unresolved and not followed; ` +
          "overloads are not distinguished; \"ambiguous\" marks a path through an interface with several implementers",
      );
    } else {
      out.push("- this graph carries no call edges: entities are those mentioned by name in the handler body only");
    }
    out.push("");
  }

  // Client wiring
  out.push("## Client-call wiring", "");
  if (g.components.length === 0 && g.clientCalls.length === 0) out.push("- no client code read");
  const byKey = new Map(g.components.map((c) => [c.key, c]));
  const callsBy = new Map<string, typeof g.clientCalls>();
  for (const c of g.clientCalls) {
    for (const k of c.components) callsBy.set(k, [...(callsBy.get(k) ?? []), c]);
  }
  const comps = cap(
    [...callsBy.keys()].sort(cmp),
    L.components,
  );
  for (const key of comps.items) {
    const comp = byKey.get(key);
    out.push(`- **${comp?.name ?? key}** (${comp ? cite(comp.file, comp.line) : key})`);
    const calls = cap(callsBy.get(key) ?? [], L.callsPerComponent);
    for (const c of calls.items) {
      out.push(`  - \`${c.method} ${c.path}\` (${cite(c.file, c.line)}) → ${c.matches ?? "no matching route"}`);
    }
    if (calls.omitted > 0) out.push(`  - … ${calls.omitted} more calls not shown (use client_calls)`);
  }
  more(comps.omitted, "components with calls");
  const unmatched = g.clientCalls.filter((c) => c.matches === null);
  if (unmatched.length) out.push(`- ${unmatched.length} client calls match no route`);
  const unowned = g.clientCalls.filter((c) => c.components.length === 0);
  if (unowned.length) out.push(`- ${unowned.length} client calls are attributed to no component`);
  const called = new Set(g.clientCalls.map((c) => c.matches));
  const uncalled = g.routes.filter((r) => !called.has(`${r.method} ${r.path}`));
  if (g.clientCalls.length > 0 && uncalled.length) {
    out.push(`- ${uncalled.length} of ${g.routes.length} routes have no client call that psq can see`);
  }
  out.push("");

  // Feature areas: route-derived, and how one leads into the next
  const av = areasView(g) as {
    areas: Array<{
      key: string; basis: string; routeCount: number; routes: string[]; components: string[];
      entities: string[]; entityCount: number; sharedEntities: string[];
    }>;
    edges: Array<{
      kind: string; from: string; to: string; evidenceCount: number;
      evidence: Array<{ text: string; cites: string[] }>;
    }>;
    unassigned: { counts: { routes: number; components: number; entities: number } };
  };
  if (av.areas.length > 0) {
    out.push("## Feature areas (from route paths) and how they lead into each other", "");
    const areaList = cap(av.areas, L.areas);
    for (const a of areaList.items) {
      const rs = cap(a.routes, L.areaRoutes);
      const es = cap(a.entities, L.areaEntities);
      out.push(
        `- **${a.key}** (${a.basis}): ${a.routeCount} route${a.routeCount === 1 ? "" : "s"}` +
          (rs.items.length ? ` (${rs.items.map((x) => `\`${x}\``).join(", ")}${rs.omitted ? `, … ${rs.omitted} more` : ""})` : "") +
          `; entities: ${es.items.length ? es.items.join(", ") + (es.omitted ? `, … ${es.omitted} more` : "") : "none mentioned directly"}` +
          (a.sharedEntities.length ? `; shared with another area: ${a.sharedEntities.join(", ")}` : "") +
          (a.components.length ? `; components: ${a.components.length}` : ""),
      );
    }
    more(areaList.omitted, "areas");
    const edgeList = cap(av.edges, L.areaEdges);
    if (av.edges.length === 0) out.push("- no cross-area edges psq can see");
    for (const e of edgeList.items) {
      const ev = cap(e.evidence, L.areaEvidence);
      out.push(
        `- **${e.from}** → **${e.to}** (${e.kind}): ` +
          ev.items.map((x) => `${x.text}${x.cites.length ? ` (${x.cites.join(", ")})` : ""}`).join("; ") +
          (e.evidenceCount > ev.items.length ? `; … ${e.evidenceCount - ev.items.length} more` : ""),
      );
    }
    more(edgeList.omitted, "cross-area edges");
    const u = av.unassigned.counts;
    if (u.routes + u.components > 0) {
      out.push(`- unassigned to any area: ${u.routes} routes, ${u.components} components`);
    }
    out.push("- an area's entities are those its handlers mention directly by name; the Flow section follows calls");
    out.push("");
  }

  // Hot spots
  out.push("## Hot spots", "");
  const refCount = new Map<string, number>();
  const methodTouch = new Map<string, { name: string; entities: Set<string>; file: string; line: number }>();
  for (const r of g.entityRefs) {
    refCount.set(r.entity, (refCount.get(r.entity) ?? 0) + 1);
    const key = methodKey(r);
    const cur = methodTouch.get(key) ?? {
      name: `${r.type}.${r.method}`, entities: new Set<string>(), file: r.file, line: r.line,
    };
    cur.entities.add(r.entity);
    methodTouch.set(key, cur);
  }
  out.push("Most-mentioned entities (mentions by name, not call sites):");
  const topEntities = [...refCount].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, L.hot);
  if (topEntities.length === 0) out.push("- no entity refs");
  for (const [name, n] of topEntities) {
    const e = g.entities.find((x) => x.name === name);
    out.push(`- ${name}: ${n} mentions (declared ${e?.file ?? "?"})`);
  }
  out.push("", "Methods touching the most entities (at least 2; line is the first mention, not the declaration):");
  const topMethods = [...methodTouch]
    .filter(([, v]) => v.entities.size >= 2)
    .sort((a, b) => b[1].entities.size - a[1].entities.size || cmp(a[0], b[0]))
    .slice(0, L.hot);
  if (topMethods.length === 0) out.push("- none");
  for (const [, v] of topMethods) {
    out.push(
      `- ${v.name} (first mention ${cite(v.file, v.line)}): ${v.entities.size} — ${[...v.entities].sort(cmp).join(", ")}`,
    );
  }
  out.push("", "Most-connected entities by relations:");
  const deg = degrees(g).filter((d) => d.degree > 0).slice(0, L.hot);
  if (deg.length === 0) out.push("- none");
  for (const d of deg) out.push(`- ${d.entity}: ${d.degree} relations`);
  const lone = orphans(g);
  if (lone.length) out.push("", `Entities with no relations: ${lone.join(", ")}`);
  out.push("");

  // Blind spots
  out.push("## Warnings and what psq cannot see", "");
  const warn = cap(g.warnings, L.warnings);
  if (g.warnings.length === 0) out.push("- extraction produced no warnings");
  for (const w of warn.items) out.push(`- warning: ${w}`);
  more(warn.omitted, "warnings");
  for (const b of blindSpots(g)) out.push(`- cannot see: ${b}`);
  out.push("", `> ${INSTRUCTION}`, "");
  return out.join("\n");
}
