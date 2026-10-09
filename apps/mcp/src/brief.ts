import { degrees, orphans } from "@psq/graph";
import type { Workspace, OpenRepo } from "../../server/src/workspace.js";
import { blindSpots, cap, cite, cmp, handlerOf, methodKey, segmentOf } from "./common.js";

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
  flowRoutes: 15, flowEntities: 8,
} as const;

export function renderBrief(ws: Workspace, repo: OpenRepo): string {
  const g = repo.graph;
  const l3 = ws.layout3dOf(repo.id)!;
  const out: string[] = [];
  const more = (n: number, what: string): void => {
    if (n > 0) out.push(`- … ${n} more ${what} not shown (use the tools for the full list)`);
  };

  out.push(`# Domain brief: ${ws.summarize(repo).name}`, "", `> ${INSTRUCTION}`, "");
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
  const districts = cap(l3.districts, LIMIT.districts);
  for (const d of districts.items) {
    const m = cap(members.get(d.name) ?? [], LIMIT.districtMembers);
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
  const shownEntities = cap(sorted, LIMIT.entities);
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
  const routes = cap(g.routes, LIMIT.routes);
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

  // Flow: route -> handler -> entities the handler mentions
  const withHandler = g.routes.filter((r) => r.handler);
  if (withHandler.length > 0) {
    out.push("## Flow (route → handler → entities mentioned in the handler body)", "");
    const touched = new Map<string, Set<string>>();
    for (const r of g.entityRefs) {
      const k = methodKey(r);
      touched.set(k, (touched.get(k) ?? new Set<string>()).add(r.entity));
    }
    // Routes whose handler touches entities come first (most entities first,
    // then method+path so the order is stable); the rest are counted, not listed.
    const entsOf = (r: (typeof withHandler)[number]): string[] =>
      [...(touched.get(methodKey(r.handler!)) ?? [])].sort(cmp);
    const bearing = withHandler
      .filter((r) => entsOf(r).length > 0)
      .sort(
        (a, b) =>
          entsOf(b).length - entsOf(a).length || cmp(`${a.method} ${a.path}`, `${b.method} ${b.path}`),
      );
    const bare = withHandler.length - bearing.length;
    const flows = cap(bearing, LIMIT.flowRoutes);
    for (const r of flows.items) {
      const h = r.handler!;
      const ents = cap(entsOf(r), LIMIT.flowEntities);
      out.push(
        `- \`${r.method} ${r.path}\` → ${h.type}.${h.method} (${cite(h.file, h.line)}): ` +
          ents.items.join(", ") + (ents.omitted > 0 ? `, … ${ents.omitted} more` : ""),
      );
    }
    more(flows.omitted, "routes with handlers");
    if (bare > 0) {
      out.push(
        `- ${bare} more routes with handlers touching no entity directly — they likely delegate to ` +
          "services, which psq does not follow yet",
      );
    }
    out.push("- entities are mentioned by name in the handler body only; calls into services are not followed");
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
    LIMIT.components,
  );
  for (const key of comps.items) {
    const comp = byKey.get(key);
    out.push(`- **${comp?.name ?? key}** (${comp ? cite(comp.file, comp.line) : key})`);
    const calls = cap(callsBy.get(key) ?? [], LIMIT.callsPerComponent);
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
  const topEntities = [...refCount].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, LIMIT.hot);
  if (topEntities.length === 0) out.push("- no entity refs");
  for (const [name, n] of topEntities) {
    const e = g.entities.find((x) => x.name === name);
    out.push(`- ${name}: ${n} mentions (declared ${e?.file ?? "?"})`);
  }
  out.push("", "Methods touching the most entities (at least 2; line is the first mention, not the declaration):");
  const topMethods = [...methodTouch]
    .filter(([, v]) => v.entities.size >= 2)
    .sort((a, b) => b[1].entities.size - a[1].entities.size || cmp(a[0], b[0]))
    .slice(0, LIMIT.hot);
  if (topMethods.length === 0) out.push("- none");
  for (const [, v] of topMethods) {
    out.push(
      `- ${v.name} (first mention ${cite(v.file, v.line)}): ${v.entities.size} — ${[...v.entities].sort(cmp).join(", ")}`,
    );
  }
  out.push("", "Most-connected entities by relations:");
  const deg = degrees(g).filter((d) => d.degree > 0).slice(0, LIMIT.hot);
  if (deg.length === 0) out.push("- none");
  for (const d of deg) out.push(`- ${d.entity}: ${d.degree} relations`);
  const lone = orphans(g);
  if (lone.length) out.push("", `Entities with no relations: ${lone.join(", ")}`);
  out.push("");

  // Blind spots
  out.push("## Warnings and what psq cannot see", "");
  const warn = cap(g.warnings, LIMIT.warnings);
  if (g.warnings.length === 0) out.push("- extraction produced no warnings");
  for (const w of warn.items) out.push(`- warning: ${w}`);
  more(warn.omitted, "warnings");
  for (const b of blindSpots(g)) out.push(`- cannot see: ${b}`);
  out.push("", `> ${INSTRUCTION}`, "");
  return out.join("\n");
}
