import type { Layout3D, Layout3DDistrict, Layout3DNode } from "@/lib/api";

/**
 * Pure geometry and camera math for the 3D entity city.
 *
 * Deliberately imports nothing at runtime — not even three. It turns a
 * `Layout3D` payload into plain numeric records; `EntityCity.tsx` maps those
 * onto three.js objects. That keeps these functions testable under plain node
 * vitest with no alias configuration and no WebGL anywhere in sight.
 */

/** Hardcoded scene colours; phase 2b swaps these for theme-derived values. */
export const PALETTE = {
  /** Building body. */
  building: 0x8b95a5,
  /** Wireframe overlay so building form reads under flat lighting. */
  buildingEdge: 0x3d4452,
  /** District ground slab. */
  plate: 0x6b7280,
  /** Declared FK edge. */
  edge: 0x64748b,
  /** Inferred (dashed) edge. */
  edgeInferred: 0x94a3b8,
  /** Ambient fill light. */
  ambient: 0xffffff,
  /** Directional key light. */
  directional: 0xffffff,
} as const;

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
