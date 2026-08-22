import type { Cardinality, EntityGraph } from "@psq/schema";
import { layout } from "./layout.js";

/**
 * A deterministic 3D "city" layout for the entity diagram.
 *
 * Like `layout()`, this is computed on the server so the scene is identical
 * everywhere; the browser only renders it. There is no randomness anywhere,
 * and two further rules keep the committed fixture snapshot stable:
 *
 *  - no `localeCompare` — string order comes from `<`/`>` on code units,
 *    which is the same on every machine, in every locale, forever;
 *  - every emitted number is an integer, so no float noise can creep into
 *    a snapshot between environments.
 *
 * Buildings are grouped into districts ("city blocks"). `namespace` is only
 * populated by the C# extractor and a single-file DDL repo has one dirname,
 * so the district key falls through four tiers, taking the first that yields
 * a real grouping. The tier used is reported as `districtBasis` so the UI can
 * label it and tests can assert it per fixture.
 */

export type DistrictBasis = "namespace" | "dir" | "component" | "single";

export interface Layout3DNode {
  name: string;
  /** Name of the district this building stands in. */
  district: string;
  /** Min-corner ground coordinates, in integer grid units. */
  x: number;
  z: number;
  /** Footprint, driven by the same scalar-property count the 2D box uses. */
  width: number;
  depth: number;
  /** Log-scaled row count, floored so an empty table is still a building. */
  height: number;
  /** The 2D layout's level: principals sit on lower tiers than dependents. */
  tier: number;
  degree: number;
  rowCount: number;
}

export interface Layout3DDistrict {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface Layout3DEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  required: boolean;
  inferred: boolean;
  /** Sets the endpoint marker in the 3D view. */
  cardinality: Cardinality;
}

export interface Layout3D {
  districtBasis: DistrictBasis;
  districts: Layout3DDistrict[];
  nodes: Layout3DNode[];
  edges: Layout3DEdge[];
  /** Ground-plane extent of the whole scene, in integer grid units. */
  width: number;
  depth: number;
}

/** Code-unit string order. Never localeCompare — see the module comment. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const MIN_SIDE = 3;
const MAX_EXTRA_SIDE = 12;
const MIN_HEIGHT = 2;
const GAP = 2; // between buildings in a district
const PAD = 2; // district edge to nearest building
const STREET = 6; // between districts

/** Directory part of a repo-relative path, "." for a bare filename. */
function dirOf(file: string): string {
  const norm = file.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i === -1 ? "." : norm.slice(0, i);
}

/**
 * A grouping only earns the name "district" when it actually partitions the
 * city: at least two groups, and not one group per building.
 */
function partitions(byEntity: Map<string, string>, total: number): boolean {
  const groups = new Set(byEntity.values());
  return groups.size >= 2 && groups.size < total;
}

/**
 * Weakly-connected components of the relation graph, each named after its
 * alphabetically first member so the name is stable.
 */
function componentsOf(g: EntityGraph): Map<string, string> {
  const parent = new Map<string, string>(g.entities.map((e) => [e.name, e.name]));
  const find = (n: string): string => {
    let root = n;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // The lesser name wins the root, so the label needs no second pass.
    if (cmp(ra, rb) < 0) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  for (const r of g.relations) {
    if (parent.has(r.principal) && parent.has(r.dependent)) union(r.principal, r.dependent);
  }
  return new Map(g.entities.map((e) => [e.name, find(e.name)]));
}

function districtKeys(g: EntityGraph): { basis: DistrictBasis; byEntity: Map<string, string> } {
  const total = g.entities.length;

  if (total > 0 && g.entities.every((e) => e.namespace !== null)) {
    const byNamespace = new Map(g.entities.map((e) => [e.name, e.namespace!]));
    if (partitions(byNamespace, total)) return { basis: "namespace", byEntity: byNamespace };
  }

  const byDir = new Map(g.entities.map((e) => [e.name, dirOf(e.file)]));
  if (partitions(byDir, total)) return { basis: "dir", byEntity: byDir };

  const byComponent = componentsOf(g);
  if (partitions(byComponent, total)) return { basis: "component", byEntity: byComponent };

  return { basis: "single", byEntity: new Map(g.entities.map((e) => [e.name, "all"])) };
}

/**
 * Compute the 3D scene. `rowCounts` decorates heights exactly as it decorates
 * the 2D nodes; omitted, every building stands at the floor height.
 */
export function layout3d(g: EntityGraph, rowCounts?: Map<string, number>): Layout3D {
  // Levels, degrees and row counts are the 2D layout's — reusing them keeps
  // the two views telling the same story about the same graph.
  if (g.entities.length === 0) {
    return { districtBasis: "single", districts: [], nodes: [], edges: [], width: 0, depth: 0 };
  }

  const base = layout(g, rowCounts);
  const baseByName = new Map(base.nodes.map((n) => [n.name, n]));

  const { basis, byEntity } = districtKeys(g);

  const sideOf = (name: string): number => {
    const e = g.entities.find((x) => x.name === name);
    // The same scalar count the 2D box height uses (layout.ts heightOf).
    const scalars = e ? e.properties.filter((p) => !p.isNavigation).length : 0;
    return MIN_SIDE + Math.min(scalars, MAX_EXTRA_SIDE);
  };
  const heightOf = (rowCount: number): number =>
    Math.max(MIN_HEIGHT, Math.round(Math.log2(rowCount + 1) * 2));

  // Group buildings into districts, ordered by district name.
  const members = new Map<string, string[]>();
  for (const e of g.entities) {
    const key = byEntity.get(e.name) ?? "all";
    const list = members.get(key) ?? [];
    list.push(e.name);
    members.set(key, list);
  }
  const districtNames = [...members.keys()].sort(cmp);

  // Lay each district out on its own local grid first.
  interface Placed {
    name: string; x: number; z: number; side: number; tier: number;
    degree: number; rowCount: number;
  }
  const local = new Map<string, { placed: Placed[]; width: number; depth: number }>();
  for (const d of districtNames) {
    const names = [...(members.get(d) ?? [])].sort((a, b) => {
      const na = baseByName.get(a)!;
      const nb = baseByName.get(b)!;
      return na.level - nb.level || nb.degree - na.degree || cmp(a, b);
    });
    const cols = Math.max(1, Math.ceil(Math.sqrt(names.length)));
    const rows = Math.ceil(names.length / cols);
    const cell = Math.max(...names.map(sideOf)) + GAP;
    const placed: Placed[] = names.map((name, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const side = sideOf(name);
      const centre = Math.floor((cell - GAP - side) / 2);
      const n = baseByName.get(name)!;
      return {
        name,
        x: PAD + col * cell + centre,
        z: PAD + row * cell + centre,
        side,
        tier: n.level,
        degree: n.degree,
        rowCount: n.rowCount,
      };
    });
    local.set(d, {
      placed,
      width: cols * cell - GAP + PAD * 2,
      depth: rows * cell - GAP + PAD * 2,
    });
  }

  // Place the districts themselves on a uniform grid, in name order.
  const dCols = Math.max(1, Math.ceil(Math.sqrt(districtNames.length)));
  const dRows = Math.ceil(districtNames.length / dCols);
  const cellW = Math.max(...districtNames.map((d) => local.get(d)!.width)) + STREET;
  const cellD = Math.max(...districtNames.map((d) => local.get(d)!.depth)) + STREET;

  const districts: Layout3DDistrict[] = [];
  const nodes: Layout3DNode[] = [];
  districtNames.forEach((d, i) => {
    const col = i % dCols;
    const row = Math.floor(i / dCols);
    const x = col * cellW;
    const z = row * cellD;
    const l = local.get(d)!;
    districts.push({ name: d, x, z, width: l.width, depth: l.depth });
    for (const p of l.placed) {
      nodes.push({
        name: p.name,
        district: d,
        x: x + p.x,
        z: z + p.z,
        width: p.side,
        depth: p.side,
        height: heightOf(p.rowCount),
        tier: p.tier,
        degree: p.degree,
        rowCount: p.rowCount,
      });
    }
  });

  const edges: Layout3DEdge[] = g.relations.map((r) => ({
    id: r.id,
    from: r.principal,
    to: r.dependent,
    label: r.foreignKeyProperty ?? r.dependentNavigation ?? "",
    required: r.required,
    inferred: r.source === "convention" || r.source === "inferred",
    cardinality: r.cardinality,
  }));

  return {
    districtBasis: basis,
    districts,
    nodes: nodes.sort((a, b) => cmp(a.name, b.name)),
    edges,
    width: dCols * cellW - STREET,
    depth: dRows * cellD - STREET,
  };
}
