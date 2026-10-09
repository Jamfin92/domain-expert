import { describe, expect, it } from "vitest";
import { areaGroups, flowCaveat, flowRows, leadsTo } from "../src/lib/areas.js";
import type { AreaEdge, AreasResult, Flow, FlowNode, Route, UiComponent } from "../src/lib/api.js";

const route = (method: string, path: string): Route => ({ method, path, file: "S.cs", line: 1 });
const comp = (key: string): UiComponent => ({ key, name: key, file: "a.tsx", line: 1 });
const edge = (kind: AreaEdge["kind"], from: string, to: string, ...evidence: string[]): AreaEdge => ({
  kind, from, to, evidence,
});

const result: AreasResult = {
  areas: [
    {
      key: "orders", label: "orders", basis: "route",
      routes: ["POST /api/orders", "GET /api/orders"], handlers: [],
      components: ["web/Orders.tsx#Orders", "gone#Missing"],
      entities: ["Order", "Customer"], sharedEntities: ["Customer"],
    },
    {
      key: "users", label: "users", basis: "route", routes: ["GET /api/users"], handlers: [],
      components: [], entities: ["Customer"], sharedEntities: ["Customer"],
    },
  ],
  unassigned: { routes: ["GET /"], components: [], entities: [] },
  edges: [
    edge("touches-entity", "orders", "users", "B.y -> Customer"),
    edge("calls-route", "orders", "users", "web/Orders.tsx#Orders -> GET /api/users"),
    edge("touches-entity", "users", "orders", "U.x -> Order"),
  ],
  entityOwner: { Customer: "users", Order: "orders" },
};

describe("leadsTo", () => {
  it("collapses outgoing edges to one entry per destination, kinds and evidence sorted", () => {
    expect(leadsTo("orders", result.edges)).toEqual([
      {
        area: "users",
        kinds: ["calls-route", "touches-entity"],
        evidence: ["B.y -> Customer", "web/Orders.tsx#Orders -> GET /api/users"],
      },
    ]);
  });
  it("ignores edges that lead INTO the area, and says nothing for an area with none", () => {
    expect(leadsTo("users", result.edges).map((l) => l.area)).toEqual(["orders"]);
    expect(leadsTo("nowhere", result.edges)).toEqual([]);
  });
});

describe("areaGroups", () => {
  // Deliberately NOT in path/method order, so a missing sort shows.
  const routes = [route("POST", "/api/orders"), route("GET", "/api/users"), route("GET", "/"), route("GET", "/api/orders")];
  const groups = areaGroups(result, routes, [comp("web/Orders.tsx#Orders")]);

  it("keeps the server's area order and appends unassigned last", () => {
    expect(groups.map((g) => g.key)).toEqual(["orders", "users", "(unassigned)"]);
    expect(groups[2]?.basis).toBe("unassigned");
    expect(groups[2]?.routes.map((r) => r.path)).toEqual(["/"]);
  });
  it("resolves raw route keys to routes ordered by path then method", () => {
    expect(groups[0]?.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/orders", "POST /api/orders"]);
  });
  it("drops a component key the graph does not hold rather than inventing it", () => {
    expect(groups[0]?.components.map((c) => c.key)).toEqual(["web/Orders.tsx#Orders"]);
  });
  it("lists shared entities with their owner, and leads-to from the edges", () => {
    expect(groups[0]?.shared).toEqual([{ entity: "Customer", owner: "users" }]);
    expect(groups[0]?.leadsTo.map((l) => l.area)).toEqual(["users"]);
  });
  it("omits the unassigned group when nothing is unassigned", () => {
    const none = areaGroups({ ...result, unassigned: { routes: [], components: [], entities: [] } }, routes, []);
    expect(none.map((g) => g.key)).toEqual(["orders", "users"]);
  });
});

const node = (type: string, method: string, depth: number, over: Partial<FlowNode> = {}): FlowNode => ({
  type, method, file: `${type}.cs`, line: 10 + depth, depth, path: [], ambiguous: false,
  entities: [], unresolvedCalls: 0, ...over,
});
const flow = (nodes: FlowNode[], over: Partial<Flow> = {}): Flow => ({
  start: { type: nodes[0]!.type, method: nodes[0]!.method }, maxDepth: 4, nodes, entities: [],
  truncated: false, ...over,
});

describe("flowRows", () => {
  it("keeps the flow's order and carries depth, file:line, ambiguity and entities per hop", () => {
    const rows = flowRows(flow([
      node("C", "Get", 0),
      node("S", "Find", 1, { entities: ["Order"] }),
      node("INotifier", "Send", 2, { ambiguous: true, unresolvedCalls: 2 }),
    ]));
    expect(rows.map((r) => [r.label, r.depth, r.file, r.line, r.ambiguous])).toEqual([
      ["C.Get", 0, "C.cs", 10, false],
      ["S.Find", 1, "S.cs", 11, false],
      ["INotifier.Send", 2, "INotifier.cs", 12, true],
    ]);
    expect(rows[1]?.entities).toEqual(["Order"]);
    expect(rows[2]?.unresolvedCalls).toBe(2);
  });
  it("marks a node with no file as unlocated and gives every row a unique key", () => {
    const rows = flowRows(flow([node("C", "Get", 0, { file: "" }), node("C", "Get", 1)]));
    expect(rows[0]?.located).toBe(false);
    expect(rows[1]?.located).toBe(true);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe("flowCaveat", () => {
  it("says nothing for a complete, unambiguous flow", () => {
    expect(flowCaveat(flow([node("C", "Get", 0)]))).toBeNull();
  });
  it("names truncation with its depth", () => {
    expect(flowCaveat(flow([node("C", "Get", 0)], { truncated: true, maxDepth: 2 }))).toContain("truncated at depth 2");
  });
  it("names ambiguity when any hop is ambiguous", () => {
    const c = flowCaveat(flow([node("C", "Get", 0), node("I", "Do", 1, { ambiguous: true })]));
    expect(c).toContain("ambiguous");
    expect(c).not.toContain("truncated");
  });
});
