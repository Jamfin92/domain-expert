import { describe, expect, it } from "vitest";
import {
  buildReverseIndex,
  callsOfComponent,
  componentAreas,
  entitiesOfHandler,
  entitiesOfHandlers,
  handlersOfRoutes,
  routesForKey,
  firstSegment,
  reachOfRoute,
  resolveRoutes,
  routeAreas,
} from "../src/lib/flow.js";
import type { ClientCall, EntityRef, Route, UiComponent } from "../src/lib/api.js";

const comp = (file: string, name: string): UiComponent => ({ key: `${file}#${name}`, name, file, line: 3 });
const route = (method: string, path: string, over: Partial<Route> = {}): Route => ({
  method, path, file: "srv/routes.ts", line: 10, ...over,
});
const call = (over: Partial<ClientCall> & { file: string; line: number }): ClientCall => ({
  method: "GET", path: "/api/x", enclosing: null, matches: null, components: [], ...over,
});
const ref = (over: Partial<EntityRef>): EntityRef => ({
  entity: "Student", file: "C/S.cs", line: 5, type: "SController", method: "Index", via: "entityName", ...over,
});

describe("componentAreas", () => {
  it("groups by directory, with root files under (root), in code-unit order", () => {
    const a = comp("src/b/Z.tsx", "Z");
    const b = comp("src/b/A.tsx", "A");
    const c = comp("Root.tsx", "Root");
    const d = comp("src/a/M.tsx", "M");
    const areas = componentAreas([a, b, c, d]);
    expect(areas.map((x) => x.dir)).toEqual(["(root)", "src/a", "src/b"]);
    expect(areas[2]?.components.map((x) => x.name)).toEqual(["A", "Z"]);
  });
});

describe("routeAreas", () => {
  it("groups by first path segment; the root path is its own area", () => {
    expect(firstSegment("/api/users/:id")).toBe("api");
    expect(firstSegment("/")).toBe("/");
    const areas = routeAreas([
      route("POST", "/users"), route("GET", "/health"), route("GET", "/users/:id"), route("GET", "/users"),
      route("GET", "/"),
    ]);
    expect(areas.map((a) => a.segment)).toEqual(["/", "health", "users"]);
    expect(areas[2]?.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /users", "POST /users", "GET /users/:id",
    ]);
  });
});

describe("resolveRoutes / callsOfComponent", () => {
  const routes = [route("GET", "/api/x"), route("POST", "/api/x")];
  const owner = comp("src/A.tsx", "A");

  it("resolves a call by its exact METHOD path key", () => {
    const c = call({ file: "f", line: 1, matches: "POST /api/x" });
    expect(resolveRoutes(c, routes).map((r) => r.method)).toEqual(["POST"]);
  });

  it("an unmatched call, and a key no route carries, resolve to nothing", () => {
    expect(resolveRoutes(call({ file: "f", line: 1 }), routes)).toEqual([]);
    expect(resolveRoutes(call({ file: "f", line: 1, matches: "GET /gone" }), routes)).toEqual([]);
  });

  it("two routes sharing a key are both returned, not chosen between", () => {
    const dup = [route("GET", "/api/x", { file: "a.ts" }), route("GET", "/api/x", { file: "b.ts" })];
    expect(resolveRoutes(call({ file: "f", line: 1, matches: "GET /api/x" }), dup)).toHaveLength(2);
  });

  it("keeps only the component's own calls, ordered by file then line", () => {
    const calls = [
      call({ file: "b.ts", line: 1, components: [owner.key], matches: "GET /api/x" }),
      call({ file: "a.ts", line: 9, components: [owner.key] }),
      call({ file: "a.ts", line: 2, components: [owner.key] }),
      call({ file: "z.ts", line: 1, components: ["other#O"] }),
    ];
    const hops = callsOfComponent(owner, calls, routes);
    expect(hops.map((h) => `${h.call.file}:${h.call.line}`)).toEqual(["a.ts:2", "a.ts:9", "b.ts:1"]);
    expect(hops[2]?.routes).toHaveLength(1);
  });
});

describe("buildReverseIndex", () => {
  const a = comp("src/A.tsx", "A");
  const b = comp("src/B.tsx", "B");

  it("maps a route key to its calls and their deduped owners", () => {
    const r = route("GET", "/api/x");
    const index = buildReverseIndex(
      [
        call({ file: "2.ts", line: 1, matches: "GET /api/x", components: [b.key, a.key] }),
        call({ file: "1.ts", line: 1, matches: "GET /api/x", components: [a.key] }),
        call({ file: "3.ts", line: 1, matches: null, components: [a.key] }),
      ],
      [a, b],
    );
    const reach = reachOfRoute(r, index);
    expect(reach.calls.map((c) => c.file)).toEqual(["1.ts", "2.ts"]);
    expect(reach.components.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("a route nobody calls reaches nothing, and an owner key with no component is dropped", () => {
    const index = buildReverseIndex(
      [call({ file: "1.ts", line: 1, matches: "GET /api/x", components: ["ghost#G"] })],
      [a],
    );
    expect(reachOfRoute(route("GET", "/api/x"), index).components).toEqual([]);
    expect(reachOfRoute(route("GET", "/nobody"), index)).toEqual({ calls: [], components: [] });
  });
});

describe("entitiesOfHandler", () => {
  const refs = [
    ref({ entity: "Student", line: 9 }),
    ref({ entity: "Student", line: 5 }),
    ref({ entity: "Course", line: 7 }),
    ref({ entity: "Enrollment", method: "Other" }),
    ref({ entity: "Enrollment", type: "OtherController" }),
  ];

  it("joins on exactly (type, method), grouped by entity with lines ascending", () => {
    const t = entitiesOfHandler({ type: "SController", method: "Index", file: "C/S.cs", line: 4 }, refs);
    expect(t).toEqual([
      { entity: "Course", refs: [refs[2]] },
      { entity: "Student", refs: [refs[1], refs[0]] },
    ]);
  });

  it("an absent handler is null (unknown), distinct from [] (known, mentions nothing)", () => {
    expect(entitiesOfHandler(undefined, refs)).toBeNull();
    expect(entitiesOfHandler({ type: "SController", method: "Nope", file: "f", line: 1 }, refs)).toEqual([]);
  });
});

describe("routes sharing METHOD+path", () => {
  const h1 = { type: "AController", method: "Sync", file: "C/A.cs", line: 55 };
  const h2 = { type: "BService", method: "Sync", file: "S/B.cs", line: 55 };
  const rs = [
    route("POST", "/dup", { file: "C/A.cs", line: 54, handler: h1 }),
    route("GET", "/dup", { file: "C/A.cs", line: 60 }),
    route("POST", "/dup", { file: "S/B.cs", line: 54, handler: h2 }),
  ];

  it("routesForKey returns every route with the key, not the first", () => {
    expect(routesForKey(rs, "POST /dup").map((r) => r.file)).toEqual(["C/A.cs", "S/B.cs"]);
    expect(routesForKey(rs, "PUT /dup")).toEqual([]);
  });

  it("handlersOfRoutes lists all distinct handlers, skipping handler-less routes", () => {
    expect(handlersOfRoutes(routesForKey(rs, "POST /dup"))).toEqual([h1, h2]);
    expect(handlersOfRoutes([rs[0] as Route, rs[0] as Route])).toEqual([h1]);
    expect(handlersOfRoutes(routesForKey(rs, "GET /dup"))).toEqual([]);
  });

  it("entitiesOfHandlers merges across handlers, null only when none is known", () => {
    const refs = [
      ref({ entity: "Student", type: "AController", method: "Sync", file: "C/A.cs", line: 56 }),
      ref({ entity: "Course", type: "BService", method: "Sync", file: "S/B.cs", line: 57 }),
      ref({ entity: "Student", type: "BService", method: "Sync", file: "S/B.cs", line: 58 }),
    ];
    const t = entitiesOfHandlers([h1, h2], refs);
    expect(t?.map((x) => x.entity)).toEqual(["Course", "Student"]);
    expect(t?.[1]?.refs.map((r) => r.line)).toEqual([56, 58]);
    expect(entitiesOfHandlers([h1, h1], refs)?.[0]?.refs).toHaveLength(1);
    expect(entitiesOfHandlers([], refs)).toBeNull();
  });
});
