import { describe, it, expect } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDotnet, extract } from "@psq/extract";
import { EntityGraph } from "@psq/schema";
import { invariants } from "@psq/graph";
import { MINI_EFCORE_REFS } from "./fixtures.js";

/**
 * H-d. Every expectation below was written by reading the fixture and applying
 * ASP.NET Core's attribute-routing rules by hand; none was copied from psq's
 * output. Line numbers are lines of the fixture files: `attr` is the attribute
 * that declares the route, `at` the handler method's declaration.
 */
const ROUTES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/mini-aspnet-routes");

const C = "Controllers";
type Row = [method: string, path: string, file: string, attr: number, type: string, action: string, at: number];

const EXPECTED: Row[] = [
  ["GET", "/bad/ok", `${C}/BadController.cs`, 19, "BadController", "Fine", 20],
  ["GET", "/api/Gadgets/{id}", `${C}/GadgetsController.cs`, 19, "GadgetsController", "Get", 20],
  ["PUT", "/api/Gadgets/{id}/retire", `${C}/GadgetsController.cs`, 22, "GadgetsController", "Retire", 23],
  ["GET", "/api/Gadgets/deep", `${C}/GadgetsController.cs`, 29, "GadgetsController", "Deep", 30],
  ["GET", "/api/Gadgets/calc", `${C}/GadgetsController.cs`, 32, "GadgetsController", "Calc", 33],
  ["GET", "/api/Gadgets/{id}/opaque", `${C}/GadgetsController.cs`, 39, "GadgetsController", "Opaque", 40],
  ["GET", "/legacy/items", `${C}/LegacyController.cs`, 6, "LegacyController", "Items", 7],
  ["GET", "/m1/x", `${C}/MultiController.cs`, 9, "MultiController", "X", 10],
  ["GET", "/m2/x", `${C}/MultiController.cs`, 9, "MultiController", "X", 10],
  ["GET", "/partial/one", `${C}/PartialController.Actions.cs`, 7, "PartialController", "One", 8],
  ["GET", "/v1/Reports/Summary", `${C}/ReportsController.cs`, 8, "ReportsController", "Summary", 9],
  ["GET", "/v1/Reports/ByYear/{year}", `${C}/ReportsController.cs`, 11, "ReportsController", "ByYear", 12],
  ["GET", "/v1/Reports/Totals", `${C}/ReportsController.cs`, 15, "ReportsController", "Sums", 16],
  ["GET", "/verbs/kept", `${C}/VerbsController.cs`, 11, "VerbsController", "Kept", 12],
  ["GET", "/api/Widgets", `${C}/WidgetsController.cs`, 13, "WidgetsController", "List", 14],
  ["GET", "/api/Widgets/{id:int}", `${C}/WidgetsController.cs`, 16, "WidgetsController", "Get", 17],
  ["POST", "/api/Widgets", `${C}/WidgetsController.cs`, 23, "WidgetsController", "Create", 24],
  ["PUT", "/api/Widgets/{id}", `${C}/WidgetsController.cs`, 26, "WidgetsController", "Update", 27],
  ["DELETE", "/api/Widgets/{id}", `${C}/WidgetsController.cs`, 29, "WidgetsController", "Remove", 30],
  ["PATCH", "/api/Widgets/{id}/rename", `${C}/WidgetsController.cs`, 32, "WidgetsController", "Rename", 33],
  ["GET", "/health", `${C}/WidgetsController.cs`, 35, "WidgetsController", "Health", 36],
  ["GET", "/api/ping", `${C}/WidgetsController.cs`, 38, "WidgetsController", "Ping", 39],
  ["GET", "/api/Widgets/search", `${C}/WidgetsController.cs`, 41, "WidgetsController", "Search", 43],
  ["GET", "/api/Widgets/a", `${C}/WidgetsController.cs`, 45, "WidgetsController", "Multi", 47],
  ["POST", "/api/Widgets/b", `${C}/WidgetsController.cs`, 46, "WidgetsController", "Multi", 47],
  ["GET", "/api/Widgets/by-code/{code:regex(^[a-z]+$)}", `${C}/WidgetsController.cs`, 49, "WidgetsController", "ByCode", 50],
  ["GET", "/api/Widgets/lit[x]", `${C}/WidgetsController.cs`, 52, "WidgetsController", "Literal", 53],
  ["GET", "/api/Widgets/q", `${C}/WidgetsController.cs`, 55, "WidgetsController", "Qualified", 56],
  ["GET", "/api/Widgets/named", `${C}/WidgetsController.cs`, 58, "WidgetsController", "Named", 59],
  ["DELETE", "/api/Widgets", `${C}/WidgetsController.cs`, 61, "WidgetsController", "OnlyName", 62],
];

const EXPECTED_WARNINGS = [
  "Program.cs:5: minimal API MapGet(...) is not read; routes registered this way are not extracted",
  "Program.cs:6: conventional routing MapControllerRoute(...) is not read; routes registered this way are not extracted",
  `${C}/AuditController.cs:7: controller AuditController is in an area ([Area]); area routes are not read`,
  `${C}/BadController.cs:8: BadController.Tok: unsupported token [unknown] in template "bad/[unknown]/x"; route not read`,
  `${C}/BadController.cs:11: BadController.Lit has a template that is not a plain string literal; route not read`,
  `${C}/BadController.cs:14: BadController.Verbless has [Route] and no HTTP method attribute, so it accepts every verb; route not read`,
  `${C}/BadController.cs:17: public method BadController.Undecided has no HTTP method attribute; whether it is an action under the class [Route] was not decided`,
  `${C}/BadController.cs:26: AsyncController.FetchAsync: template uses [action] on a method ending in Async; MVC may trim that suffix depending on a framework option psq cannot see; route not read`,
  `${C}/ChildController.cs:6: abstract controller BaseApiController declares actions; actions inherited by derived controllers are not read`,
  `${C}/ChildController.cs:12: controller ChildController inherits [Route] from BaseApiController; inherited class routes are not read`,
  `${C}/VerbsController.cs:9: VerbsController.Both uses [AcceptVerbs]; the route was not read`,
];

describe("mini ASP.NET attribute-routing fixture", () => {
  const g = extractDotnet(ROUTES);

  it("reads exactly the hand-derived routes, in order", () => {
    const got: Row[] = g.routes.map((r) => [
      r.method, r.path, r.file, r.line, r.handler!.type, r.handler!.method, r.handler!.line,
    ]);
    expect(got).toEqual(EXPECTED);
    for (const r of g.routes) expect(r.handler!.file).toBe(r.file);
  });

  it("warns on every unsupported form, and only on those", () => {
    expect([...g.warnings].sort()).toEqual([...EXPECTED_WARNINGS].sort());
  });

  it("emits no route for an unsupported form", () => {
    const handlers = new Set(g.routes.map((r) => `${r.handler!.type}.${r.handler!.method}`));
    for (const not of [
      "AuditController.Index", "VerbsController.Both", "BadController.Tok", "BadController.Lit",
      "BadController.Verbless", "BadController.Undecided", "AsyncController.FetchAsync",
      "BaseApiController.Shared", "ChildController.Own", "WidgetsController.Helper",
      "WidgetsController.Hidden",
    ]) {
      expect(handlers.has(not), not).toBe(false);
    }
    // minimal APIs and conventional routing never become routes
    expect(g.routes.some((r) => r.path === "/ping" && r.file === "Program.cs")).toBe(false);
  });

  it("joins a route's handler to the entities that handler mentions", () => {
    const entitiesOf = (type: string, method: string): string[] =>
      [...new Set(g.entityRefs.filter((e) => e.type === type && e.method === method).map((e) => e.entity))];
    const get = g.routes.find((r) => r.method === "GET" && r.path === "/api/Widgets/{id:int}")!;
    expect(entitiesOf(get.handler!.type, get.handler!.method)).toEqual(["Widget"]);
    const create = g.routes.find((r) => r.method === "POST" && r.path === "/api/Widgets")!;
    expect(entitiesOf(create.handler!.type, create.handler!.method)).toEqual(["Widget"]);
    const list = g.routes.find((r) => r.method === "GET" && r.path === "/api/Widgets")!;
    expect(entitiesOf(list.handler!.type, list.handler!.method)).toEqual(["Widget"]); // _db.Widgets
    const remove = g.routes.find((r) => r.method === "DELETE" && r.path === "/api/Widgets/{id}")!;
    expect(entitiesOf(remove.handler!.type, remove.handler!.method)).toEqual([]);
  });

  it("produces a graph the schema and invariants accept", () => {
    expect(() => EntityGraph.parse(g)).not.toThrow();
    expect(invariants(g)).toEqual([]);
  });

  it("is deterministic", () => {
    expect(extractDotnet(ROUTES).routes).toEqual(g.routes);
  });

  it("goes through extract() as an efcore repo", () => {
    expect(extract(ROUTES).routes).toEqual(g.routes);
  });
});

describe("existing controller fixture", () => {
  it("has controllers by name but no routing attributes: no routes, no routing warning", () => {
    const g = extractDotnet(MINI_EFCORE_REFS);
    expect(g.routes).toEqual([]);
    expect(g.warnings.filter((w) => /route|routing|minimal API|HTTP method/i.test(w))).toEqual([]);
  });
});
