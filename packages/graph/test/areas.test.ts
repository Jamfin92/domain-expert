import { describe, it, expect } from "vitest";
import { extractDotnet } from "@psq/extract";
import type { EntityGraph } from "@psq/schema";
import { areasFor, areaSegment } from "../src/index.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTES_FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/mini-aspnet-routes");

type R = EntityGraph["routes"][number];
const route = (method: string, path: string, handler?: [string, string, string]): R => ({
  method,
  path,
  file: "Program.cs",
  line: 1,
  ...(handler ? { handler: { type: handler[0], method: handler[1], file: handler[2], line: 1 } } : {}),
});
const ref = (entity: string, type: string, method: string, file: string) => ({
  entity,
  file,
  line: 1,
  type,
  method,
  via: "entityName" as const,
});
const call = (matches: string | null, components: string[]) => ({
  method: "GET",
  path: "/x",
  file: "web/x.ts",
  line: 1,
  enclosing: null,
  matches,
  components,
});

function graph(over: Partial<EntityGraph>): EntityGraph {
  return {
    kind: "entity",
    repo: "t",
    provider: "none",
    contextName: null,
    entities: [],
    relations: [],
    shapes: [],
    routes: [],
    clientCalls: [],
    components: [],
    entityRefs: [],
    warnings: [],
    ...over,
  };
}
const ent = (name: string) => ({ name }) as unknown as EntityGraph["entities"][number];

describe("areaSegment: api and version prefixes are skipped", () => {
  it("takes the first meaningful segment", () => {
    expect(areaSegment("/api/v1/courses/:id")).toBe("courses");
    expect(areaSegment("/api/v2.0/Courses")).toBe("courses");
    expect(areaSegment("/v1/Reports/Summary")).toBe("reports");
    expect(areaSegment("/api/{id}/orders")).toBe("orders");
    // not a version: must survive as a segment
    expect(areaSegment("/api/versions")).toBe("versions");
    expect(areaSegment("/api/v")).toBe("v");
    expect(areaSegment("/")).toBeNull();
    expect(areaSegment("/api")).toBeNull();
  });
});

const HC = "Controllers/CoursesController.cs";
const HE = "Controllers/EnrollController.cs";
const base = graph({
  entities: [ent("Course"), ent("Enrollment"), ent("Lonely")],
  routes: [
    route("GET", "/api/v1/courses/:id", ["CoursesController", "Get", HC]),
    route("GET", "/api/enroll", ["EnrollController", "List", HE]),
    route("GET", "/api/v1/:id"),
    route("GET", "/", ["RootController", "Index", "Controllers/Root/RootController.cs"]),
    route("GET", "/api"),
  ],
  entityRefs: [
    ref("Course", "CoursesController", "Get", HC),
    ref("Course", "CoursesController", "Get", HC),
    ref("Course", "EnrollController", "List", HE), // enroll touches Course too
    ref("Enrollment", "EnrollController", "List", HE),
    ref("Enrollment", "EnrollController", "List", HE),
    ref("Course", "Other", "Get", HC), // same file, wrong type: no join
  ],
  components: [
    { key: "web/pages/EnrollPage.tsx#EnrollPage", name: "EnrollPage", file: "web/pages/EnrollPage.tsx", line: 1 },
    { key: "web/courses/List.tsx#List", name: "List", file: "web/courses/List.tsx", line: 1 },
    { key: "web/Idle.tsx#Idle", name: "Idle", file: "web/Idle.tsx", line: 1 },
  ],
  clientCalls: [
    call("GET /api/v1/courses/:id", ["web/pages/EnrollPage.tsx#EnrollPage"]),
    call("GET /api/enroll", ["web/pages/EnrollPage.tsx#EnrollPage"]),
    call("GET /api/enroll", ["web/pages/EnrollPage.tsx#EnrollPage"]),
    call("GET /api/v1/courses/:id", ["web/courses/List.tsx#List"]),
    call(null, ["web/Idle.tsx#Idle"]),
  ],
});

describe("areasFor: partition", () => {
  const r = areasFor(base);

  it("groups routes by segment, falls back to handler dir, else unassigned", () => {
    expect(r.areas.map((a) => a.key)).toEqual(["courses", "dir:Controllers/Root", "enroll"]);
    expect(r.areas[0]).toMatchObject({ basis: "route", routes: ["GET /api/v1/courses/:id"] });
    expect(r.areas[1]).toMatchObject({ basis: "handler-dir", label: "Root", routes: ["GET /"] });
    expect(r.unassigned.routes).toEqual(["GET /api", "GET /api/v1/:id"]);
  });

  it("homes components by directory name, else by most calls, else unassigned", () => {
    const by = Object.fromEntries(r.areas.map((a) => [a.key, a.components]));
    expect(by.courses).toEqual(["web/courses/List.tsx#List"]);
    // EnrollPage: 2 calls to enroll beat 1 to courses
    expect(by.enroll).toEqual(["web/pages/EnrollPage.tsx#EnrollPage"]);
    expect(r.unassigned.components).toEqual(["web/Idle.tsx#Idle"]);
  });

  it("joins entities on type+method+file only", () => {
    const courses = r.areas.find((a) => a.key === "courses")!;
    expect(courses.entities).toEqual(["Course"]);
    expect(r.unassigned.entities).toEqual(["Lonely"]);
  });

  it("is deterministic and does not depend on input order", () => {
    expect(areasFor(base)).toEqual(r);
    const flipped = graph({
      ...base,
      routes: [...base.routes].reverse(),
      entityRefs: [...base.entityRefs].reverse(),
      clientCalls: [...base.clientCalls].reverse(),
      components: [...base.components].reverse(),
    });
    expect(areasFor(flipped)).toEqual(r);
  });
});

describe("areasFor: shared entities", () => {
  const r = areasFor(base);
  it("an entity touched by two areas is shared in both, owned by the heavier", () => {
    const by = Object.fromEntries(r.areas.map((a) => [a.key, a]));
    expect(by.courses!.sharedEntities).toEqual(["Course"]);
    expect(by.enroll!.entities).toEqual(["Course", "Enrollment"]);
    expect(by.enroll!.sharedEntities).toEqual(["Course"]);
    expect(r.entityOwner).toEqual({ Course: "courses", Enrollment: "enroll" });
  });
});

describe("areasFor: cross-area edges", () => {
  const r = areasFor(base);
  it("component in A calling a route in B is an edge", () => {
    expect(r.edges.filter((e) => e.kind === "calls-route")).toEqual([
      {
        kind: "calls-route",
        from: "enroll",
        to: "courses",
        evidence: ["web/pages/EnrollPage.tsx#EnrollPage -> GET /api/v1/courses/:id"],
      },
    ]);
  });
  it("handler in A touching an entity owned by B is an edge", () => {
    expect(r.edges.filter((e) => e.kind === "touches-entity")).toEqual([
      { kind: "touches-entity", from: "enroll", to: "courses", evidence: ["EnrollController.List -> Course"] },
    ]);
  });
  it("no edge when everything stays inside one area", () => {
    const one = graph({
      routes: [route("GET", "/api/a", ["A", "m", "A.cs"])],
      entityRefs: [ref("X", "A", "m", "A.cs")],
      components: [{ key: "w/a/C.tsx#C", name: "C", file: "w/a/C.tsx", line: 1 }],
      clientCalls: [call("GET /api/a", ["w/a/C.tsx#C"])],
    });
    expect(areasFor(one).edges).toEqual([]);
  });
});

describe("areasFor: over an extracted fixture", () => {
  it("assigns every route exactly once and reads entities off real refs", () => {
    const g = extractDotnet(ROUTES_FIXTURE);
    const r = areasFor(g);
    const placed = [...r.areas.flatMap((a) => a.routes), ...r.unassigned.routes];
    expect(placed.length).toBe(g.routes.length);
    const keys = r.areas.map((a) => a.key);
    expect(keys).toContain("widgets");
    expect(keys).toContain("reports"); // /v1/Reports skips the version
    expect(keys).not.toContain("api");
    expect(keys).not.toContain("v1");
    expect(r.areas.find((a) => a.key === "widgets")!.entities).toEqual(["Widget"]);
  });
});
