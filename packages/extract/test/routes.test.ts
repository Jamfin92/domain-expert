import { describe, it, expect } from "vitest";
import { parseCSharp } from "../src/csharp/structure.js";
import { combineTemplates, readAspNetRoutes, scanUnattributedRouting } from "../src/csharp/routes.js";
import { linkCalls, normaliseRoutePath } from "../src/node/clients.js";
import type { ClientCall, Route } from "@psq/schema";

function routesOf(src: string) {
  return readAspNetRoutes([parseCSharp(src, "C.cs")]);
}

describe("combineTemplates (ASP.NET AttributeRouteModel rules)", () => {
  it.each<[string | null, string | null, string]>([
    ["api/x", "y", "api/x/y"],
    ["api/x", null, "api/x"],
    ["api/x", "", "api/x"],
    [null, "y", "y"],
    ["api/x", "/y", "y"],
    ["api/x", "~/y", "y"],
    ["api/x/", "y", "api/x/y"],
    [null, null, ""],
  ])("%s + %s -> %s", (cls, action, want) => {
    expect(combineTemplates(cls, action)).toBe(want);
  });
});

describe("readAspNetRoutes", () => {
  it("substitutes [controller] by stripping the Controller suffix only", () => {
    const r = routesOf(`
      [Route("[controller]")] public class CourseController { [HttpGet] public int A() => 1; }
      [Route("[controller]")] public class Controller2 : ControllerBase { [HttpGet] public int B() => 1; }
    `);
    expect(r.routes.map((x) => x.path)).toEqual(["/Course", "/Controller2"]);
  });

  it("does not read [..] inside a constraint as a token", () => {
    const r = routesOf(`
      public class XController { [HttpGet("{c:regex(^[a-z]+$)}")] public int A() => 1; }
    `);
    expect(r.warnings).toEqual([]);
    expect(r.routes.map((x) => x.path)).toEqual(["/{c:regex(^[a-z]+$)}"]);
  });

  it("honours [ActionName] for [action], even on an Async method", () => {
    const r = routesOf(`
      [Route("[action]")] public class XController {
        [ActionName("Load")] [HttpGet] public int LoadAsync() => 1;
      }
    `);
    expect(r.warnings).toEqual([]);
    expect(r.routes.map((x) => x.path)).toEqual(["/Load"]);
  });

  it("warns, and emits no route, for a bare verb on a class with no [Route]", () => {
    // conventionally routed in ASP.NET: there is no attribute route to read
    const r = routesOf(`
      public class HomeController : Controller {
        [HttpGet] public int Index() => 1;
        [HttpPost] public int Save() => 1;
      }`);
    expect(r.routes).toEqual([]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toMatch(/^C\.cs:\d+: .*HomeController\.Index.*conventional/);
    expect(r.warnings[1]).toMatch(/^C\.cs:\d+: .*HomeController\.Save.*conventional/);
  });

  it("still routes a templated verb, and a bare verb under a class [Route], on the same class", () => {
    const r = routesOf(`
      public class XController { [HttpGet("a")] public int A() => 1; }
      [Route("r")] public class YController { [HttpGet] public int B() => 1; }`);
    expect(r.warnings).toEqual([]);
    expect(r.routes.map((x) => `${x.method} ${x.path}`)).toEqual(["GET /a", "GET /r"]);
  });

  it("emits both selectors for a bare verb plus a templated verb", () => {
    const r = routesOf(`
      [Route("r")] public class XController {
        [HttpGet] [HttpPost("b")] public int A() => 1;
      }`);
    expect(r.warnings).toEqual([]);
    expect(r.routes.map((x) => `${x.method} ${x.path}`).sort()).toEqual(["GET /r", "POST /r/b"]);
  });

  it("reads a templated verb together with [Route] as two routes", () => {
    const r = routesOf(`
      [Route("r")] public class XController {
        [HttpGet("a")] [Route("b")] public int A() => 1;
      }`);
    expect(r.warnings).toEqual([]);
    expect(r.routes.map((x) => `${x.method} ${x.path}`).sort()).toEqual(["GET /r/a", "GET /r/b"]);
  });

  it("silently skips a [NonController] class", () => {
    const r = routesOf(`
      [NonController] public class XController { [HttpGet("a")] public int A() => 1; }`);
    expect(r).toEqual({ routes: [], warnings: [] });
  });

  it("warns when a controller inherits actions from a non-abstract base controller", () => {
    const r = routesOf(`
      [Route("base")] public class BaseController : ControllerBase { [HttpGet("x")] public int A() => 1; }
      [Route("kid")] public class KidController : BaseController { [HttpGet("y")] public int B() => 1; }`);
    expect(r.routes.map((x) => x.path).sort()).toEqual(["/base/x", "/kid/y"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^C\.cs:\d+: .*KidController.*BaseController.*inherited actions are not read/);
  });

  it("reads HttpHead and HttpOptions", () => {
    const r = routesOf(`
      [Route("r")] public class XController {
        [HttpHead] public int A() => 1;
        [HttpOptions("o")] public int B() => 1;
      }`);
    expect(r.routes.map((x) => `${x.method} ${x.path}`)).toEqual(["HEAD /r", "OPTIONS /r/o"]);
  });

  it("ignores a class that is not a controller", () => {
    const r = routesOf(`public class Helper { [HttpGet("x")] public int A() => 1; }`);
    expect(r).toEqual({ routes: [], warnings: [] });
  });

  it("warns on a template that is concatenated or escaped", () => {
    const r = routesOf(`
      public class XController {
        [HttpGet("a" + "b")] public int A() => 1;
        [HttpGet("a\\\\b")] public int B() => 1;
      }`);
    expect(r.routes).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });
});

describe("scanUnattributedRouting", () => {
  it("fires on a call, not on a comment, a string, or a declaration", () => {
    const src = [
      "// app.MapGet(\"/c\", f);",
      "var s = \"app.MapPost(x)\";",
      "static class E { public static void MapPut(this object o) {} }",
      "app.MapDelete(\"/d\", f);",
    ].join("\n");
    expect(scanUnattributedRouting(src, "P.cs")).toEqual([
      "P.cs:4: minimal API MapDelete(...) is not read; routes registered this way are not extracted",
    ]);
  });

  it("is silent about MapControllers, which only enables attribute routing", () => {
    expect(scanUnattributedRouting("app.MapControllers();", "P.cs")).toEqual([]);
  });
});

describe("route/call path matching", () => {
  const route = (method: string, path: string): Route => ({ method, path, file: "A.cs", line: 1 });
  const call = (method: string, path: string): ClientCall => ({
    method, path, file: "a.ts", line: 1, enclosing: null, matches: null, components: [],
  });

  it.each([
    ["/api/x/{id}", "/api/x/*"],
    ["/api/x/{id:int}", "/api/x/*"],
    ["/api/x/{id?}", "/api/x/*"],
    ["/api/x/{*rest}", "/api/x/*"],
    ["/api/x/{code:regex(^\\d{3}$)}/y", "/api/x/*/y"],
    ["/api/{a}/{b:int}", "/api/*/*"],
  ])("aspnet %s -> %s", (from, to) => {
    expect(normaliseRoutePath(from, true)).toBe(to);
  });

  it("leaves braces alone in the default (Express) mode", () => {
    // the pre-existing `:param` rule, byte for byte: it eats to the next slash
    expect(normaliseRoutePath("/a{/:id}", false)).toBe("/a{/*");
    expect(normaliseRoutePath("/a/{id}", false)).toBe("/a/{id}");
    expect(normaliseRoutePath("/a/:id/b", false)).toBe("/a/*/b");
  });

  it("matches {id:int} to a template hole, case-insensitively, only in aspnet mode", () => {
    const routes = [route("GET", "/api/Widgets/{id:int}")];
    const hit = linkCalls(routes, [call("GET", "/api/widgets/*")], [], { aspnet: true });
    expect(hit[0]!.matches).toBe("GET /api/Widgets/{id:int}");
    const miss = linkCalls(routes, [call("GET", "/api/widgets/*")], []);
    expect(miss[0]!.matches).toBeNull();
  });

  it("does not match across methods or segment counts", () => {
    const routes = [route("GET", "/api/Widgets/{id}")];
    const calls = [call("POST", "/api/Widgets/*"), call("GET", "/api/Widgets/*/x"), call("GET", "/api/Widgets")];
    expect(linkCalls(routes, calls, [], { aspnet: true }).map((c) => c.matches)).toEqual([null, null, null]);
  });
});
