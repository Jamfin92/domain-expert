import type { EntityGraph } from "@psq/schema";

/**
 * A deterministic layered layout for the entity diagram.
 *
 * Computed on the server so the picture is identical everywhere and can be
 * exported, and so the browser never needs a layout library. A force
 * simulation would settle differently on every load, which makes a diagram
 * impossible to talk about ("the box on the left" stops meaning anything).
 *
 * Principals sit above their dependents, so foreign keys read downward.
 */

export interface LayoutNode {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  /** Relations touching this entity — drives emphasis in the UI. */
  degree: number;
  rowCount: number;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  required: boolean;
  /** True when the edge was inferred rather than declared. */
  inferred: boolean;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

/**
 * A deep graph costs height, and height is what forces the fit-to-view scale
 * down until the labels stop being readable. Corpus repo A is 9 levels deep,
 * so every pixel per level is multiplied by nine. Box height still varies with
 * property count, because that carries real information, but it is capped.
 */
const NODE_WIDTH = 172;
const MIN_HEIGHT = 48;
const ROW_HEIGHT = 10;
const MAX_ROWS_SHOWN = 4;
const GAP_X = 40;
const GAP_Y = 58;
const PAD = 28;

/**
 * Assign each entity a level: a principal is always above every entity that
 * depends on it. Cycles are broken by visiting in name order and refusing to
 * revisit, so the result is stable rather than dependent on traversal luck.
 */
function levels(g: EntityGraph): Map<string, number> {
  const level = new Map<string, number>(g.entities.map((e) => [e.name, 0]));
  const parents = new Map<string, string[]>();
  for (const e of g.entities) parents.set(e.name, []);
  for (const r of g.relations) {
    if (r.principal === r.dependent) continue;
    parents.get(r.dependent)?.push(r.principal);
  }

  // Relax repeatedly. Bounded by entity count, which also bounds any cycle.
  const names = [...level.keys()].sort();
  for (let pass = 0; pass < g.entities.length; pass++) {
    let changed = false;
    for (const name of names) {
      const ps = parents.get(name) ?? [];
      let want = 0;
      for (const p of ps) {
        const pl = level.get(p);
        if (pl !== undefined) want = Math.max(want, pl + 1);
      }
      // Cap at the entity count so a cycle cannot run away.
      want = Math.min(want, g.entities.length);
      if (want > (level.get(name) ?? 0)) {
        level.set(name, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return level;
}

/** Order nodes within each level to reduce edge crossings, deterministically. */
function orderWithinLevels(
  g: EntityGraph,
  level: Map<string, number>,
): Map<number, string[]> {
  const byLevel = new Map<number, string[]>();
  for (const [name, l] of [...level.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const list = byLevel.get(l) ?? [];
    list.push(name);
    byLevel.set(l, list);
  }

  const neighbours = new Map<string, string[]>();
  for (const e of g.entities) neighbours.set(e.name, []);
  for (const r of g.relations) {
    neighbours.get(r.dependent)?.push(r.principal);
    neighbours.get(r.principal)?.push(r.dependent);
  }

  const position = new Map<string, number>();
  const maxLevel = Math.max(0, ...byLevel.keys());

  for (let l = 0; l <= maxLevel; l++) {
    const names = byLevel.get(l);
    if (!names) continue;
    if (l === 0) {
      names.sort();
    } else {
      // Barycentre: sit each node near the average position of the nodes it
      // connects to on the level above. Ties break by name, never by chance.
      const score = new Map<string, number>();
      for (const n of names) {
        const above = (neighbours.get(n) ?? []).filter((m) => (level.get(m) ?? -1) < l);
        const positions = above
          .map((m) => position.get(m))
          .filter((p): p is number => p !== undefined);
        score.set(
          n,
          positions.length === 0
            ? Number.MAX_SAFE_INTEGER
            : positions.reduce((a, b) => a + b, 0) / positions.length,
        );
      }
      names.sort((a, b) => (score.get(a)! - score.get(b)!) || a.localeCompare(b));
    }
    names.forEach((n, i) => position.set(n, i));
    byLevel.set(l, names);
  }
  return byLevel;
}

/**
 * Compute the diagram. `rowCounts` is optional and only decorates the nodes.
 */
export function layout(g: EntityGraph, rowCounts?: Map<string, number>): Layout {
  const level = levels(g);
  const byLevel = orderWithinLevels(g, level);

  const degree = new Map<string, number>(g.entities.map((e) => [e.name, 0]));
  for (const r of g.relations) {
    degree.set(r.principal, (degree.get(r.principal) ?? 0) + 1);
    degree.set(r.dependent, (degree.get(r.dependent) ?? 0) + 1);
  }

  const heightOf = (name: string): number => {
    const e = g.entities.find((x) => x.name === name);
    const scalars = e ? e.properties.filter((p) => !p.isNavigation).length : 0;
    return MIN_HEIGHT + Math.min(scalars, MAX_ROWS_SHOWN) * ROW_HEIGHT;
  };

  const levelKeys = [...byLevel.keys()].sort((a, b) => a - b);
  const widest = Math.max(1, ...levelKeys.map((l) => byLevel.get(l)!.length));
  const totalWidth = widest * NODE_WIDTH + (widest - 1) * GAP_X;

  const nodes: LayoutNode[] = [];
  let y = PAD;
  for (const l of levelKeys) {
    const names = byLevel.get(l)!;
    const rowWidth = names.length * NODE_WIDTH + (names.length - 1) * GAP_X;
    // Centre each row, so the diagram reads as a shape rather than a ragged list.
    const startX = PAD + (totalWidth - rowWidth) / 2;
    let tallest = MIN_HEIGHT;
    names.forEach((name, i) => {
      const h = heightOf(name);
      tallest = Math.max(tallest, h);
      nodes.push({
        name,
        x: startX + i * (NODE_WIDTH + GAP_X),
        y,
        width: NODE_WIDTH,
        height: h,
        level: l,
        degree: degree.get(name) ?? 0,
        rowCount: rowCounts?.get(name) ?? 0,
      });
    });
    y += tallest + GAP_Y;
  }

  const edges: LayoutEdge[] = g.relations.map((r) => ({
    id: r.id,
    from: r.principal,
    to: r.dependent,
    label: r.foreignKeyProperty ?? r.dependentNavigation ?? "",
    required: r.required,
    inferred: r.source === "convention" || r.source === "inferred",
  }));

  return {
    nodes: nodes.sort((a, b) => a.name.localeCompare(b.name)),
    edges,
    width: totalWidth + PAD * 2,
    height: y - GAP_Y + PAD,
  };
}
