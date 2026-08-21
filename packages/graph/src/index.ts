import type { EntityGraph, Relation } from "@psq/schema";

/**
 * Graph-level operations over an extracted EntityGraph.
 *
 * Everything here is pure and deterministic: same graph in, same answer out.
 * Question generators depend on that — a quiz that reshuffles its own truth
 * between runs cannot be graded.
 */

/**
 * Structural checks that must hold before any question is generated.
 *
 * A generator reading a broken graph produces questions that look plausible
 * and are wrong, which is the one failure mode psq cannot tolerate. Run this
 * first and refuse to generate when it returns anything.
 */
export function invariants(g: EntityGraph): string[] {
  const problems: string[] = [];
  const byName = new Map(g.entities.map((e) => [e.name, e]));

  const seen = new Set<string>();
  for (const e of g.entities) {
    if (seen.has(e.name)) problems.push(`duplicate entity name: ${e.name}`);
    seen.add(e.name);

    const propNames = new Set(e.properties.map((p) => p.name));
    for (const k of e.keys) {
      if (!propNames.has(k)) problems.push(`${e.name}: key "${k}" is not a declared property`);
    }
    if (e.keys.length === 0) problems.push(`${e.name}: no primary key`);

    for (const idx of e.indexes) {
      for (const p of idx.properties) {
        if (!propNames.has(p)) problems.push(`${e.name}: index references unknown property "${p}"`);
      }
    }
  }

  for (const r of g.relations) {
    if (!byName.has(r.principal)) problems.push(`${r.id}: unknown principal "${r.principal}"`);
    if (!byName.has(r.dependent)) problems.push(`${r.id}: unknown dependent "${r.dependent}"`);
    if (r.foreignKeyProperty) {
      const dep = byName.get(r.dependent);
      if (dep && !dep.properties.some((p) => p.name === r.foreignKeyProperty)) {
        problems.push(`${r.id}: foreign key "${r.foreignKeyProperty}" is not a property of ${r.dependent}`);
      }
    }
  }

  return problems;
}

/** Relations touching an entity, in either direction. */
export function relationsOf(g: EntityGraph, entity: string): Relation[] {
  return g.relations.filter((r) => r.principal === entity || r.dependent === entity);
}

/** Number of relations touching each entity, highest first. */
export function degrees(g: EntityGraph): Array<{ entity: string; degree: number }> {
  const counts = new Map<string, number>(g.entities.map((e) => [e.name, 0]));
  for (const r of g.relations) {
    counts.set(r.principal, (counts.get(r.principal) ?? 0) + 1);
    counts.set(r.dependent, (counts.get(r.dependent) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([entity, degree]) => ({ entity, degree }))
    // ties break by name so the ordering is stable across runs
    .sort((a, b) => b.degree - a.degree || a.entity.localeCompare(b.entity));
}

/** Undirected adjacency, with each edge's relation id. */
function adjacency(g: EntityGraph): Map<string, Array<{ to: string; via: string }>> {
  const adj = new Map<string, Array<{ to: string; via: string }>>();
  const add = (from: string, to: string, via: string): void => {
    const list = adj.get(from) ?? [];
    list.push({ to, via });
    adj.set(from, list);
  };
  for (const e of g.entities) adj.set(e.name, []);
  for (const r of g.relations) {
    add(r.dependent, r.principal, r.id);
    add(r.principal, r.dependent, r.id);
  }
  // deterministic neighbour order
  for (const [, list] of adj) list.sort((a, b) => a.to.localeCompare(b.to) || a.via.localeCompare(b.via));
  return adj;
}

/**
 * Shortest path between two entities, treating relations as undirected.
 * Returns the entity names in order, or null when they are not connected.
 * Ties are broken alphabetically so the answer is single-valued.
 */
export function shortestPath(g: EntityGraph, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const adj = adjacency(g);
  if (!adj.has(from) || !adj.has(to)) return null;

  const prev = new Map<string, string>();
  const seen = new Set<string>([from]);
  let frontier = [from];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const edge of adj.get(node) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        prev.set(edge.to, node);
        if (edge.to === to) {
          const path = [to];
          let cur = to;
          while (prev.has(cur)) {
            cur = prev.get(cur)!;
            path.push(cur);
          }
          return path.reverse();
        }
        next.push(edge.to);
      }
    }
    next.sort();
    frontier = next;
  }
  return null;
}

/** Entities with no relations at all. */
export function orphans(g: EntityGraph): string[] {
  return degrees(g).filter((d) => d.degree === 0).map((d) => d.entity);
}

/** Mermaid erDiagram source, for export and for the .mmd artifact. */
export function mermaid(g: EntityGraph): string {
  const lines = ["erDiagram"];
  for (const r of g.relations) {
    // left is the principal ("one" side), right is the dependent
    const marker =
      r.cardinality === "one-to-one"
        ? r.required ? "||--||" : "||--o|"
        : r.cardinality === "many-to-many"
          ? "}o--o{"
          : r.required ? "||--o{" : "|o--o{";
    const label = r.foreignKeyProperty ?? r.dependentNavigation ?? "relates";
    lines.push(`    ${r.principal} ${marker} ${r.dependent} : "${label}"`);
  }
  for (const e of g.entities) {
    lines.push(`    ${e.name} {`);
    for (const p of e.properties) {
      if (p.isNavigation) continue;
      const flags = [p.isPrimaryKey ? "PK" : "", p.isForeignKey ? "FK" : ""].filter(Boolean).join(",");
      const type = p.type.replace(/[^A-Za-z0-9_]/g, "_");
      lines.push(`        ${type} ${p.name}${flags ? ` "${flags}"` : ""}`);
    }
    lines.push("    }");
  }
  return lines.join("\n");
}
