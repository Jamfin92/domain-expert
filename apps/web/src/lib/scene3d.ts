import type { Layout3D, Layout3DDistrict, Layout3DNode } from "@/lib/api";

/**
 * Pure geometry and camera math for the 3D entity city.
 *
 * Deliberately imports nothing at runtime — not even three. It turns a
 * `Layout3D` payload into plain numeric records; `EntityCity.tsx` maps those
 * onto three.js objects. That keeps these functions testable under plain node
 * vitest with no alias configuration and no WebGL anywhere in sight.
 */

/**
 * Per-theme scene colours for the entity city, keyed by the resolved theme.
 *
 * The city deliberately does **not** read the `--graph-*` CSS tokens: those
 * describe a 2D SVG where a node is a stroked shape on a distinct background
 * (`--graph-node` is pure white in light mode, the same as the card the city
 * composites against), and three cannot parse `oklch()` anyway. These values
 * are the city's own.
 *
 * A lit surface (`building`, `plate`, the cones) does not render at its token
 * colour: three's Lambert BRDF divides by π (`BRDF_Lambert`), so a lit face
 * renders at roughly half its token — `(LIGHT_AMBIENT + LIGHT_DIRECTIONAL ·
 * dotNL) / π`, at most 0.499 on the top face. The contrast tests in
 * `test/scene3d.test.ts` apply that exact model; change these values only
 * against those bands, not by eye against the raw hex.
 */
export type CityPalette = Record<
  | "building"
  | "buildingEdge"
  | "plate"
  | "edge"
  | "edgeInferred"
  | "cone"
  | "coneInferred"
  | "ambient"
  | "directional",
  number
>;

export const CITY_PALETTE: Record<"light" | "dark", CityPalette> = {
  light: {
    /** Building body. */
    building: 0x8b95a5,
    /** Wireframe overlay so building form reads under flat lighting. */
    buildingEdge: 0x282d38,
    /** District ground slab. */
    plate: 0x6b7280,
    /** Declared FK edge. */
    edge: 0x64748b,
    /** Inferred (dashed) edge. */
    edgeInferred: 0x7d8899,
    /** Declared-edge cone: `edge` ÷ the top-face factor, so a lit cone matches its unlit line. */
    cone: 0x8aa0be,
    /** Inferred-edge cone: `edgeInferred` ÷ the top-face factor. */
    coneInferred: 0xacbad1,
    /** Ambient fill light. */
    ambient: 0xffffff,
    /** Directional key light. */
    directional: 0xffffff,
  },
  dark: {
    building: 0xb6c0d2,
    buildingEdge: 0xc3ccdb,
    plate: 0x8791a3,
    edge: 0x8f9aad,
    edgeInferred: 0x6b7488,
    cone: 0xc4d2ec,
    coneInferred: 0x94a0ba,
    ambient: 0xffffff,
    directional: 0xffffff,
  },
};

/** Ambient light intensity. Shared with the tests; do not repeat the literal. */
export const LIGHT_AMBIENT = 0.75;
/** Directional light intensity. */
export const LIGHT_DIRECTIONAL = 1.1;
/** Directional light position (three normalises it into a direction). */
export const LIGHT_DIRECTION: Vec3 = { x: 1, y: 2, z: 1.5 };

/** WCAG relative luminance of a 24-bit sRGB colour. */
export function relativeLuminance(hex: number): number {
  const chan = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = chan((hex >> 16) & 0xff);
  const g = chan((hex >> 8) & 0xff);
  const b = chan(hex & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two 24-bit sRGB colours, always ≥ 1. */
export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Thickness of a district ground slab. */
export const PLATE_H = 0.5;
/**
 * How far above a rooftop an edge endpoint sits. Every fixture entity has
 * `rowCount: 0`, so every height floors at exactly 2 — a line at `y = height`
 * would be coplanar with every roof it crosses and z-fight. Load-bearing.
 */
export const EDGE_LIFT = 1.5;
/** Floor on the framed extent, so an empty layout still gets a real camera. */
export const MIN_EXTENT = 20;
/** Vertical field of view, degrees. */
export const CAMERA_FOV = 45;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** An axis-aligned box given by its centre and dimensions. */
export interface Box {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
}

export interface EdgeSegment {
  id: string;
  inferred: boolean;
  from: Vec3;
  to: Vec3;
}

export interface CameraFraming {
  position: Vec3;
  target: Vec3;
  near: number;
  far: number;
}

/**
 * Centre-plus-size box for a building. Layout `x`/`z` are the min corner and
 * `y` is never emitted, so the mesh centre is offset by half each dimension.
 */
export function buildingBox(n: Layout3DNode): Box {
  return {
    x: n.x + n.width / 2,
    y: n.height / 2,
    z: n.z + n.depth / 2,
    width: n.width,
    height: n.height,
    depth: n.depth,
  };
}

/**
 * A thin ground slab for a district, sitting strictly below y = 0 so it never
 * z-fights the ground faces of the buildings standing on it.
 */
export function districtPlate(d: Layout3DDistrict): Box {
  return {
    x: d.x + d.width / 2,
    y: -PLATE_H / 2 - 0.01,
    z: d.z + d.depth / 2,
    width: d.width,
    height: PLATE_H,
    depth: d.depth,
  };
}

/**
 * The rectangle the camera should frame: the union of district rects, which is
 * tighter than `layout.width`/`depth` (those are the *grid* extent and can
 * trail dead space). Falls back to the grid extent when there are no districts.
 */
export function sceneBounds(layout: Layout3D): Bounds {
  let minX: number;
  let maxX: number;
  let minZ: number;
  let maxZ: number;
  if (layout.districts.length === 0) {
    minX = 0;
    maxX = layout.width;
    minZ = 0;
    maxZ = layout.depth;
  } else {
    minX = Infinity;
    maxX = -Infinity;
    minZ = Infinity;
    maxZ = -Infinity;
    for (const d of layout.districts) {
      minX = Math.min(minX, d.x);
      maxX = Math.max(maxX, d.x + d.width);
      minZ = Math.min(minZ, d.z);
      maxZ = Math.max(maxZ, d.z + d.depth);
    }
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

/**
 * Edge endpoints in world space, lifted above the rooftops. Skips — never
 * throws on — dangling endpoint names, self-edges, and zero-length segments:
 * a zero-length segment cannot be oriented, and a NaN from normalising it
 * would poison the whole merged buffer's bounding sphere.
 */
export function edgeSegments(layout: Layout3D): EdgeSegment[] {
  const byName = new Map<string, Layout3DNode>();
  for (const n of layout.nodes) byName.set(n.name, n);
  const out: EdgeSegment[] = [];
  for (const e of layout.edges) {
    if (e.from === e.to) continue;
    const from = byName.get(e.from);
    const to = byName.get(e.to);
    if (!from || !to) continue;
    const a: Vec3 = {
      x: from.x + from.width / 2,
      y: from.height + EDGE_LIFT,
      z: from.z + from.depth / 2,
    };
    const b: Vec3 = {
      x: to.x + to.width / 2,
      y: to.height + EDGE_LIFT,
      z: to.z + to.depth / 2,
    };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    if (dx * dx + dy * dy + dz * dz === 0) continue;
    out.push({ id: e.id, inferred: e.inferred, from: a, to: b });
  }
  return out;
}

/** Fixed viewing direction: 45-degree azimuth in the ground plane. */
const AZIMUTH = Math.PI / 4;
/** Fixed elevation above the ground plane, radians. */
const ELEVATION = Math.PI / 5.5;

/**
 * A deterministic camera framing for the scene: fixed azimuth and elevation,
 * distance derived from the framed extent and the field of view. `MIN_EXTENT`
 * clamps the empty-layout case (`{width: 0, depth: 0, districts: []}`), which
 * would otherwise put the camera on its own target with near/far both 0.
 */
export function frameCamera(bounds: Bounds, maxHeight: number): CameraFraming {
  const extent = Math.max(bounds.width, bounds.depth, MIN_EXTENT);
  const fovRad = (CAMERA_FOV * Math.PI) / 180;
  // Distance at which `extent` fills the vertical field of view, padded so
  // the city sits inside the frame rather than touching its edges.
  const distance = (extent / (2 * Math.tan(fovRad / 2))) * 1.4;
  const target: Vec3 = {
    x: bounds.centerX,
    y: maxHeight / 2,
    z: bounds.centerZ,
  };
  const cosE = Math.cos(ELEVATION);
  const position: Vec3 = {
    x: target.x + distance * cosE * Math.cos(AZIMUTH),
    y: target.y + distance * Math.sin(ELEVATION),
    z: target.z + distance * cosE * Math.sin(AZIMUTH),
  };
  return {
    position,
    target,
    near: distance / 100,
    far: distance * 10,
  };
}
