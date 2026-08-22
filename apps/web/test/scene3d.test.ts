import { describe, expect, it } from "vitest";
import {
  EDGE_LIFT,
  MIN_EXTENT,
  PALETTE,
  buildingBox,
  districtPlate,
  edgeSegments,
  frameCamera,
  sceneBounds,
} from "../src/lib/scene3d.js";
import type { Layout3D, Layout3DEdge, Layout3DNode } from "../src/lib/api.js";

function node(over: Partial<Layout3DNode> & { name: string }): Layout3DNode {
  return {
    district: "app",
    x: 0,
    z: 0,
    width: 7,
    depth: 5,
    height: 2,
    tier: 0,
    degree: 0,
    rowCount: 0,
    ...over,
  };
}

function edge(over: Partial<Layout3DEdge> & { id: string; from: string; to: string }): Layout3DEdge {
  return {
    label: "",
    required: true,
    inferred: false,
    cardinality: "one-to-many",
    ...over,
  };
}

function layout(over: Partial<Layout3D>): Layout3D {
  return {
    districtBasis: "dir",
    districts: [],
    nodes: [],
    edges: [],
    width: 0,
    depth: 0,
    ...over,
  };
}

describe("buildingBox", () => {
  it("treats x/z as the min corner and centres the box", () => {
    // The trap: getting this wrong offsets the city by half a building and
    // still looks plausible.
    const b = buildingBox(node({ name: "User", x: 10, z: 4, width: 8, depth: 6, height: 2 }));
    expect(b).toEqual({ x: 14, y: 1, z: 7, width: 8, height: 2, depth: 6 });
  });
});

describe("districtPlate", () => {
  it("is a thin slab sitting strictly below y = 0", () => {
    const p = districtPlate({ name: "app", x: 3, z: 1, width: 20, depth: 22 });
    expect(p.x).toBe(13);
    expect(p.z).toBe(12);
    expect(p.width).toBe(20);
    expect(p.depth).toBe(22);
    // Anti-z-fight invariant: the top face must be under the buildings' feet.
    expect(p.y + p.height / 2).toBeLessThan(0);
  });
});

describe("sceneBounds", () => {
  it("is the union of district rects, not the grid extent", () => {
    // Mini-node shape: the grid reports width 50 but content stops at 37.
    const l = layout({
      width: 50,
      depth: 22,
      districts: [
        { name: "models", x: 0, z: 0, width: 20, depth: 22 },
        { name: "auth", x: 23, z: 0, width: 14, depth: 22 },
      ],
    });
    const b = sceneBounds(l);
    expect(b.width).toBe(37);
    expect(b.depth).toBe(22);
    expect(b.minX).toBe(0);
    expect(b.maxX).toBe(37);
    expect(b.centerX).toBe(18.5);
    expect(b.centerZ).toBe(11);
  });

  it("differs from the grid extent on both axes when the districts do", () => {
    // In the mini-node numbers the union depth happens to equal layout.depth,
    // so that case alone would not catch a wrong depth union. Each extreme
    // comes from a different district, and the last district supplies none of
    // them, so a last-wins bug fails on every axis.
    const l = layout({
      width: 50,
      depth: 40,
      districts: [
        { name: "west", x: 1, z: 5, width: 2, depth: 2 }, // sole minX = 1
        { name: "east", x: 11, z: 5, width: 3, depth: 2 }, // sole maxX = 14
        { name: "north", x: 5, z: 2, width: 2, depth: 3 }, // sole minZ = 2
        { name: "south", x: 6, z: 6, width: 2, depth: 3 }, // sole maxZ = 9
        { name: "mid", x: 5, z: 5, width: 2, depth: 2 }, // last, no extremes
      ],
    });
    const b = sceneBounds(l);
    expect(b.minX).toBe(1);
    expect(b.maxX).toBe(14);
    expect(b.minZ).toBe(2);
    expect(b.maxZ).toBe(9);
    expect(b.width).toBe(13);
    expect(b.depth).toBe(7);
    expect(b.centerX).toBe(7.5);
    expect(b.centerZ).toBe(5.5);
  });

  it("falls back to the grid extent when there are no districts", () => {
    const b = sceneBounds(layout({ width: 50, depth: 22 }));
    expect(b).toEqual({
      minX: 0,
      maxX: 50,
      minZ: 0,
      maxZ: 22,
      centerX: 25,
      centerZ: 11,
      width: 50,
      depth: 22,
    });
  });

  it("handles a single district (mini-efcore shape)", () => {
    const l = layout({
      width: 30,
      depth: 20,
      districts: [{ name: "app", x: 0, z: 0, width: 24, depth: 18 }],
    });
    const b = sceneBounds(l);
    expect(b.width).toBe(24);
    expect(b.depth).toBe(18);
  });
});

describe("edgeSegments", () => {
  const twoNodes = [
    node({ name: "User", x: 0, z: 0, width: 8, depth: 6, height: 2 }),
    node({ name: "Post", x: 20, z: 10, width: 8, depth: 6, height: 2 }),
  ];

  it("lifts endpoints strictly above the rooftops", () => {
    // Every fixture height floors at exactly 2, so y = height would be
    // coplanar with every roof the line crosses.
    const l = layout({
      nodes: twoNodes,
      edges: [edge({ id: "e1", from: "User", to: "Post", inferred: true })],
    });
    const [s] = edgeSegments(l);
    expect(s).toBeDefined();
    expect(s!.from).toEqual({ x: 4, y: 2 + EDGE_LIFT, z: 3 });
    expect(s!.to).toEqual({ x: 24, y: 2 + EDGE_LIFT, z: 13 });
    expect(s!.from.y).toBeGreaterThan(2);
    expect(s!.id).toBe("e1");
    expect(s!.inferred).toBe(true);
  });

  it("skips dangling endpoints without throwing", () => {
    const l = layout({
      nodes: twoNodes,
      edges: [
        edge({ id: "e1", from: "User", to: "Ghost" }),
        edge({ id: "e2", from: "Ghost", to: "Post" }),
        edge({ id: "e3", from: "User", to: "Post" }),
      ],
    });
    const segs = edgeSegments(l);
    expect(segs.map((s) => s.id)).toEqual(["e3"]);
  });

  it("skips self-edges without throwing", () => {
    // layout3d happily emits from === to for hierarchical FKs.
    const l = layout({
      nodes: twoNodes,
      edges: [edge({ id: "self", from: "User", to: "User" })],
    });
    expect(edgeSegments(l)).toEqual([]);
  });

  it("skips zero-length segments without throwing", () => {
    // Two distinct nodes stacked at the same spot: normalising the zero
    // vector would give NaN and poison the whole merged buffer.
    const l = layout({
      nodes: [
        node({ name: "A", x: 0, z: 0, width: 8, depth: 6, height: 2 }),
        node({ name: "B", x: 0, z: 0, width: 8, depth: 6, height: 2 }),
      ],
      edges: [edge({ id: "zero", from: "A", to: "B" })],
    });
    expect(edgeSegments(l)).toEqual([]);
  });

  it("returns nothing for a layout with no edges", () => {
    expect(edgeSegments(layout({ nodes: twoNodes }))).toEqual([]);
  });
});

describe("PALETTE", () => {
  it("holds only valid 24-bit integers", () => {
    for (const [name, value] of Object.entries(PALETTE)) {
      expect(Number.isInteger(value), name).toBe(true);
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(value, name).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe("frameCamera", () => {
  const bounds = sceneBounds(
    layout({
      width: 50,
      depth: 22,
      districts: [
        { name: "models", x: 0, z: 0, width: 20, depth: 22 },
        { name: "auth", x: 23, z: 0, width: 14, depth: 22 },
      ],
    }),
  );

  it("targets the bounds centre at mid-height", () => {
    const f = frameCamera(bounds, 2);
    expect(f.target).toEqual({ x: 18.5, y: 1, z: 11 });
  });

  it("is deterministic", () => {
    expect(frameCamera(bounds, 2)).toEqual(frameCamera(bounds, 2));
  });

  it("moves the camera further out as the extent grows", () => {
    const small = frameCamera(bounds, 2);
    const big = frameCamera(
      sceneBounds(layout({ width: 500, depth: 220 })),
      2,
    );
    const dist = (f: typeof small): number =>
      Math.hypot(
        f.position.x - f.target.x,
        f.position.y - f.target.y,
        f.position.z - f.target.z,
      );
    expect(dist(big)).toBeGreaterThan(dist(small));
  });

  it("clamps a zero-node layout to MIN_EXTENT with non-zero near/far", () => {
    // layout3d returns {width: 0, depth: 0, districts: []} for an empty
    // graph; without the clamp the camera sits on its own target.
    const f = frameCamera(sceneBounds(layout({})), 0);
    expect(f.target).toEqual({ x: 0, y: 0, z: 0 });
    const d = Math.hypot(f.position.x, f.position.y, f.position.z);
    const fovRad = (45 * Math.PI) / 180;
    const expected = (MIN_EXTENT / (2 * Math.tan(fovRad / 2))) * 1.4;
    expect(d).toBeCloseTo(expected, 8);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near);
  });
});
