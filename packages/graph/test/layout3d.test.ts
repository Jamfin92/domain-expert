import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { EntityGraph, Entity, Property, Relation } from "@psq/schema";
import { extractDotnet, extractNode } from "@psq/extract";
import { layout3d, type Layout3D } from "../src/index.js";
import { MINI_EFCORE, MINI_NODE } from "../../../test/fixtures.js";

const gCs = extractDotnet(MINI_EFCORE);
const gDdl = extractNode(MINI_NODE);

// ---------------------------------------------------------------------------
// Synthetic graphs, for exercising the district tiers the fixtures cannot
// reach (mini-efcore has one namespace and one dir, so it falls to "single").
// ---------------------------------------------------------------------------

function prop(name: string): Property {
  return {
    name, type: "int", baseType: "int", nullable: false,
    isPrimaryKey: name === "Id", isForeignKey: false,
    isNavigation: false, isCollection: false, column: name,
  };
}

function ent(name: string, namespace: string | null, file: string, scalars = 2): Entity {
  return {
    name, namespace, file, tableName: name, dbSetName: null,
    keys: ["Id"],
    properties: [prop("Id"), ...Array.from({ length: scalars - 1 }, (_, i) => prop(`P${i}`))],
    indexes: [], isFramework: false,
  };
}

function rel(principal: string, dependent: string): Relation {
  return {
    id: `${dependent}.${principal}Id->${principal}`,
    principal, dependent, foreignKeyProperty: null,
    cardinality: "one-to-many", dependentNavigation: null,
    principalNavigation: null, required: true,
    deleteBehavior: "Cascade", deleteBehaviorSource: "convention",
    source: "convention",
  };
}

function graph(entities: Entity[], relations: Relation[] = []): EntityGraph {
  return {
    kind: "entity", repo: "synthetic", provider: "none", contextName: null,
    entities, relations, shapes: [], routes: [], warnings: [],
  };
}

// ---------------------------------------------------------------------------
// District basis — all four tiers
// ---------------------------------------------------------------------------

describe("district basis", () => {
  it("uses namespaces when a C#-style graph has more than one", () => {
    const l = layout3d(graph(
      [
        ent("A", "App.Billing", "Billing/A.cs"),
        ent("B", "App.Billing", "Billing/B.cs"),
        ent("C", "App.Auth", "Auth/C.cs"),
      ],
      [rel("A", "C")],
    ));
    expect(l.districtBasis).toBe("namespace");
    expect(l.districts.map((d) => d.name)).toEqual(["App.Auth", "App.Billing"]);
    expect(l.nodes.find((n) => n.name === "C")!.district).toBe("App.Auth");
  });

  it("falls back to directories when namespaces are absent", () => {
    const l = layout3d(graph([
      ent("A", null, "models/a.ts"),
      ent("B", null, "models/b.ts"),
      ent("C", null, "auth/c.ts"),
    ]));
    expect(l.districtBasis).toBe("dir");
    expect(l.districts.map((d) => d.name)).toEqual(["auth", "models"]);
  });

  it("falls back to connected components for a single-file DDL repo", () => {
    // mini-node is the case the original design degenerated on: namespace is
    // null for every entity and the dirnames collapse to one group.
    const l = layout3d(gDdl);
    expect(l.districtBasis).toBe("component");
    expect(l.districts.map((d) => d.name)).toEqual(["crews", "ports"]);
    const district = new Map(l.nodes.map((n) => [n.name, n.district]));
    expect(district.get("crews")).toBe("crews");
    expect(district.get("voyages")).toBe("crews");
    expect(district.get("log_entries")).toBe("crews");
    expect(district.get("ports")).toBe("ports");
  });

  it("admits a single district explicitly when nothing partitions", () => {
    // mini-efcore: one namespace, one dir, one connected component.
    const l = layout3d(gCs);
    expect(l.districtBasis).toBe("single");
    expect(l.districts).toHaveLength(1);
    expect(l.nodes.every((n) => n.district === "all")).toBe(true);
  });

  it("refuses a grouping that is one district per building", () => {
    // Two entities in two dirs, unrelated: dirs and components are both all
    // singletons, so the rule falls through to "single".
    const l = layout3d(graph([ent("A", null, "a/a.ts"), ent("B", null, "b/b.ts")]));
    expect(l.districtBasis).toBe("single");
  });
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function everyNumber(l: Layout3D): number[] {
  return [
    l.width, l.depth,
    ...l.districts.flatMap((d) => [d.x, d.z, d.width, d.depth]),
    ...l.nodes.flatMap((n) => [n.x, n.z, n.width, n.depth, n.height, n.tier, n.degree, n.rowCount]),
  ];
}

describe("3d geometry", () => {
  const rows = new Map(gCs.entities.map((e, i) => [e.name, [0, 7, 40, 1234, 99999][i] ?? 0]));

  it("emits integers only, including log-scaled heights", () => {
    for (const l of [layout3d(gCs), layout3d(gDdl), layout3d(gCs, rows)]) {
      for (const v of everyNumber(l)) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("keeps an empty table visible and grows height with rows, sublinearly", () => {
    const byRow = new Map(layout3d(gCs, rows).nodes.map((n) => [n.rowCount, n.height]));
    expect(byRow.get(0)).toBeGreaterThanOrEqual(2);
    const h40 = byRow.get(40)!;
    const h99999 = byRow.get(99999)!;
    expect(h40).toBeGreaterThan(byRow.get(0)!);
    expect(h99999).toBeGreaterThan(h40);
    expect(h99999).toBeLessThan(h40 * (99999 / 40)); // log, not linear
  });

  it("agrees with the 2D layout about footprints being scalar-driven", () => {
    // Student declares more scalar columns than Advisor in the fixture, so
    // its building must have the larger footprint.
    const byName = new Map(layout3d(gCs).nodes.map((n) => [n.name, n]));
    expect(byName.get("Student")!.width).toBeGreaterThan(byName.get("Advisor")!.width);
  });

  it("places every building inside its own district, and districts apart", () => {
    for (const l of [layout3d(gCs), layout3d(gDdl)]) {
      const districts = new Map(l.districts.map((d) => [d.name, d]));
      for (const n of l.nodes) {
        const d = districts.get(n.district)!;
        expect(n.x).toBeGreaterThanOrEqual(d.x);
        expect(n.z).toBeGreaterThanOrEqual(d.z);
        expect(n.x + n.width).toBeLessThanOrEqual(d.x + d.width);
        expect(n.z + n.depth).toBeLessThanOrEqual(d.z + d.depth);
      }
      for (const a of l.districts) for (const b of l.districts) {
        if (a === b) continue;
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width &&
          a.z < b.z + b.depth && b.z < a.z + a.depth;
        expect(overlap).toBe(false);
      }
    }
  });

  it("never overlaps two buildings", () => {
    for (const l of [layout3d(gCs), layout3d(gDdl)]) {
      const ns = l.nodes;
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i]!, b = ns[j]!;
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width &&
          a.z < b.z + b.depth && b.z < a.z + a.depth;
        expect(overlap).toBe(false);
      }
    }
  });

  it("carries every relation as an edge, with its cardinality", () => {
    const l = layout3d(gDdl);
    expect(l.edges).toHaveLength(gDdl.relations.length);
    for (const e of l.edges) expect(e.cardinality).toBe("one-to-many");
    // inferred FK naming in raw DDL must surface as inferred, not declared
    expect(l.edges.find((e) => e.id === "log_entries.callsign->crews")!.inferred).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("is deep-equal across repeated calls", () => {
    expect(layout3d(gCs)).toEqual(layout3d(gCs));
    expect(layout3d(gDdl)).toEqual(layout3d(gDdl));
  });

  it("never uses localeCompare, whose order is locale-dependent", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "../src/layout3d.ts"), "utf8");
    // The comments name localeCompare to warn against it; only the call form
    // matters here.
    expect(src.includes(".localeCompare(")).toBe(false);
  });

  it("matches the committed fixture snapshot exactly", () => {
    expect(layout3d(gCs)).toEqual(MINI_EFCORE_SNAPSHOT);
  });
});

/**
 * The full scene for mini-efcore, committed so a change to the algorithm is a
 * visible diff here rather than a silent reshuffle of every saved city. Safe
 * to commit because every number is an integer and no ordering is
 * locale-dependent. Regenerate deliberately when the algorithm changes.
 */
const MINI_EFCORE_SNAPSHOT: Layout3D = {
  districtBasis: "single",
  districts: [{ name: "all", x: 0, z: 0, width: 35, depth: 24 }],
  nodes: [
    { name: "Advisor", district: "all", x: 4, z: 4, width: 5, depth: 5, height: 2, tier: 0, degree: 1, rowCount: 0 },
    { name: "Course", district: "all", x: 24, z: 2, width: 8, depth: 8, height: 2, tier: 1, degree: 2, rowCount: 0 },
    { name: "Department", district: "all", x: 15, z: 4, width: 5, depth: 5, height: 2, tier: 0, degree: 1, rowCount: 0 },
    { name: "Enrollment", district: "all", x: 14, z: 14, width: 7, depth: 7, height: 2, tier: 2, degree: 2, rowCount: 0 },
    { name: "Student", district: "all", x: 2, z: 13, width: 9, depth: 9, height: 2, tier: 1, degree: 2, rowCount: 0 },
  ],
  edges: [
    { id: "Course.DepartmentId->Department", from: "Department", to: "Course", label: "DepartmentId", required: true, inferred: false, cardinality: "one-to-many" },
    { id: "Enrollment.CourseId->Course", from: "Course", to: "Enrollment", label: "CourseId", required: true, inferred: false, cardinality: "one-to-many" },
    { id: "Enrollment.StudentId->Student", from: "Student", to: "Enrollment", label: "StudentId", required: true, inferred: false, cardinality: "one-to-many" },
    { id: "Student.AdvisorId->Advisor", from: "Advisor", to: "Student", label: "AdvisorId", required: false, inferred: false, cardinality: "one-to-many" },
  ],
  width: 35,
  depth: 24,
};
