import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../server/src/workspace.js";
import { INSTRUCTION } from "../src/brief.js";
import { cap } from "../src/common.js";
import { CAP, resolveRepo, tools, type Ctx } from "../src/tools.js";
import { MINI_EFCORE_REFS, MINI_FULLSTACK_REACT } from "../../../test/fixtures.js";

const MINI_ASPNET_ROUTES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/mini-aspnet-routes");

let ctx: Ctx;
beforeEach(() => {
  ctx = { workspace: new Workspace() };
});
afterEach(() => ctx.workspace.closeAll());

// Handlers are typed per tool; the tests read results structurally.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const openRefs = (): string => (tools.open_repo.run(ctx, { path: MINI_EFCORE_REFS }) as Json).id;
const openReact = (): string => (tools.open_repo.run(ctx, { path: MINI_FULLSTACK_REACT }) as Json).id;

describe("open_repo", () => {
  it("returns the id and the summary counts", () => {
    const s = tools.open_repo.run(ctx, { path: MINI_EFCORE_REFS }) as Json;
    expect(s).toMatchObject({
      name: "mini-efcore-refs",
      provider: "efcore",
      entities: 2,
      relations: 1,
      routes: 0,
      clientCalls: 0,
      components: 0,
      entityRefs: 22,
      warnings: 0,
      districtBasis: "single",
    });
    expect(resolveRepo(ctx).id).toBe(s.id);
  });

  it("refuses a path that does not exist", () => {
    expect(() => tools.open_repo.run(ctx, { path: "/nonexistent-psq-path" })).toThrow(/No such directory/);
  });
});

describe("resolveRepo", () => {
  it("needs a repo when none is open, and accepts an id or a path", () => {
    expect(() => resolveRepo(ctx)).toThrow(/open_repo/);
    const id = openRefs();
    expect(resolveRepo(ctx, id).id).toBe(id);
    expect(resolveRepo(ctx).id).toBe(id);
    expect(resolveRepo({ workspace: ctx.workspace }, MINI_EFCORE_REFS).id).toBe(id);
    expect(() => resolveRepo(ctx, "nope")).toThrow(/Unknown repo/);
  });
});

describe("overview", () => {
  it("lists districts with their basis and members", () => {
    openRefs();
    const o = tools.overview.run(ctx, {}) as Json;
    expect(o.districtBasis).toBe("single");
    expect(o.districts).toEqual([{ name: "all", size: 2, members: ["Course", "Student"] }]);
    expect(o.truncated).toBe(false);
  });

  it("groups routes by first segment and attaches client calls to components", () => {
    openReact();
    const o = tools.overview.run(ctx, {}) as Json;
    expect(o.routeGroups).toHaveLength(1);
    expect(o.routeGroups[0]).toMatchObject({ segment: "api", count: 2 });
    const panel = o.components.find((c: Json) => c.key === "src/components/admin/Panel.tsx#Panel");
    expect(panel.cite).toBe("src/components/admin/Panel.tsx:11");
    expect(panel.clientCallCount).toBe(3);
    expect(panel.clientCalls[0].cite).toMatch(/^src\/components\/admin\/Panel\.tsx:\d+$/);
  });

  it("caps its output and says so", () => {
    const id = openReact();
    const repo = ctx.workspace.get(id)!;
    const base = repo.graph.routes[0]!;
    for (let i = 0; i < CAP.routeGroups + 5; i++) {
      repo.graph.routes.push({ ...base, path: `/seg${String(i).padStart(3, "0")}/x` });
    }
    const o = tools.overview.run(ctx, {}) as Json;
    expect(o.routeGroups).toHaveLength(CAP.routeGroups);
    expect(o.truncated).toBe(true);
    expect(o.omitted.routeGroups).toBe(6);
  });

  it("cap() reports what it dropped", () => {
    expect(cap([1, 2, 3, 4], 3)).toEqual({ items: [1, 2, 3], omitted: 1 });
    expect(cap([1], 3)).toEqual({ items: [1], omitted: 0 });
  });
});

describe("search_entities", () => {
  it("finds partial matches, and wholeWord rejects a fragment of a word", () => {
    openRefs();
    const partial = tools.search_entities.run(ctx, { query: "cour" }) as Json;
    expect(partial.hits.map((h: Json) => h.name)).toContain("Course");
    const whole = tools.search_entities.run(ctx, { query: "cour", wholeWord: true }) as Json;
    expect(whole.hits).toEqual([]);
    const exact = tools.search_entities.run(ctx, { query: "course", wholeWord: true }) as Json;
    expect(exact.hits.map((h: Json) => h.name)).toContain("Course");
    expect(exact.hits[0].cite).toBe("Models/Course.cs");
  });

  it("treats regex characters in the query literally", () => {
    openRefs();
    const r = tools.search_entities.run(ctx, { query: ".*", wholeWord: true }) as Json;
    expect(r.hits).toEqual([]);
  });
});

describe("entity", () => {
  it("shows both sides of a relation, the fields and a refs summary", () => {
    openRefs();
    const student = tools.entity.run(ctx, { name: "Student" }) as Json;
    expect(student.cite).toBe("Models/Student.cs");
    expect(student.relations.out.map((r: Json) => r.other)).toEqual(["Course"]);
    expect(student.relations.in).toEqual([]);
    expect(student.relations.out[0]).toMatchObject({ deleteBehaviorSource: expect.any(String) });
    expect(student.fields.length).toBeGreaterThan(0);
    expect(student.refs.total).toBe(10);

    const course = tools.entity.run(ctx, { name: "Course" }) as Json;
    expect(course.relations.in.map((r: Json) => r.other)).toEqual(["Student"]);
    expect(course.refs.total).toBe(12);
  });

  it("suggests names for an unknown entity instead of guessing", () => {
    openRefs();
    expect(() => tools.entity.run(ctx, { name: "Cours" })).toThrow(/No entity named "Cours"\. Did you mean: Course/);
  });
});

describe("refs", () => {
  it("returns file:line citations, and filters by via", () => {
    openRefs();
    const all = tools.refs.run(ctx, { entity: "Course" }) as Json;
    expect(all).toMatchObject({ entity: "Course", known: true, total: 12, truncated: false });
    expect(all.refs.every((r: Json) => /^.+\.cs:\d+$/.test(r.cite))).toBe(true);
    expect(all.refs).toContainEqual(expect.objectContaining({ cite: "Controllers/CoursesController.cs:55", type: "Dup", method: "Sync" }));
    const viaSet = tools.refs.run(ctx, { entity: "Course", via: "dbSetName" }) as Json;
    expect(viaSet.total).toBeLessThan(all.total);
    expect(viaSet.refs.every((r: Json) => r.via === "dbSetName")).toBe(true);
  });

  it("separates 'referenced nowhere' from 'no such entity'", () => {
    openRefs();
    expect(tools.refs.run(ctx, { entity: "Nope" })).toMatchObject({ known: false, total: 0 });
  });
});

describe("routes", () => {
  it("filters by prefix and flags routes no client calls", () => {
    openReact();
    const all = tools.routes.run(ctx, {}) as Json;
    expect(all.total).toBe(2);
    const admin = tools.routes.run(ctx, { prefix: "/api/admin" }) as Json;
    expect(admin.routes).toEqual([
      {
        method: "POST", path: "/api/admin/cards", cite: "server.ts:25", calledByClient: true,
        handler: { type: "server", method: "<inline>", file: "server.ts", line: 25 },
        handlerCite: "server.ts:25",
      },
    ]);
  });

  it("passes through a handler when the graph has one, and works without", () => {
    const id = openReact();
    const repo = ctx.workspace.get(id)!;
    // the fixture's inline handlers are real; drop them to test the no-handler path
    for (const r of repo.graph.routes) delete r.handler;
    expect((tools.routes.run(ctx, {}) as Json).routes[0]).not.toHaveProperty("handler");
    (repo.graph.routes[0] as Json).handler = { type: "CardsController", method: "Post", file: "Api/Cards.cs", line: 12 };
    const first = (tools.routes.run(ctx, {}) as Json).routes[0];
    expect(first.handler).toMatchObject({ type: "CardsController", method: "Post" });
    expect(first.handlerCite).toBe("Api/Cards.cs:12");
  });
});

describe("client_calls", () => {
  it("filters by component name or key and counts what did not match", () => {
    openReact();
    const all = tools.client_calls.run(ctx, {}) as Json;
    expect(all.total).toBe(8);
    expect(all.unmatched).toBe(2);
    expect(all.unattributed).toBe(1);
    expect((tools.client_calls.run(ctx, { component: "Panel" }) as Json).total).toBe(4);
    const one = tools.client_calls.run(ctx, { component: "src/components/admin/Panel.tsx#Panel" }) as Json;
    expect(one.total).toBe(3);
    expect(one.unmatched).toBe(1);
    expect(one.calls.every((c: Json) => /:\d+$/.test(c.cite))).toBe(true);
    expect((tools.client_calls.run(ctx, { component: "Missing" }) as Json).total).toBe(0);
  });
});

describe("warnings", () => {
  it("always states what psq cannot see, and surfaces extraction warnings", () => {
    const id = openRefs();
    const clean = tools.warnings.run(ctx, {}) as Json;
    expect(clean.count).toBe(0);
    expect(clean.cannotSee.join("\n")).toMatch(/mentions|MENTIONS/);
    ctx.workspace.get(id)!.graph.warnings.push("something psq did not understand");
    const w = tools.warnings.run(ctx, {}) as Json;
    expect(w.count).toBe(1);
    expect(w.warnings).toEqual(["something psq did not understand"]);
  });

  it("only lists client blind spots for a repo with client code", () => {
    const refsId = openRefs();
    expect((tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n")).not.toMatch(/wrapper functions/);
    openReact();
    expect((tools.warnings.run(ctx, { repo: refsId }) as Json).cannotSee.join("\n")).not.toMatch(/wrapper functions/);
    expect((tools.warnings.run(ctx, { repo: MINI_FULLSTACK_REACT }) as Json).cannotSee.join("\n")).toMatch(/wrapper functions/);
  });
});

describe("mermaid", () => {
  it("returns erDiagram source", () => {
    openRefs();
    expect(tools.mermaid.run(ctx, {})).toMatch(/^erDiagram\n/);
  });
});

describe("brief", () => {
  it("renders the instruction, hot spots with citations and blind spots", () => {
    openRefs();
    const b = tools.brief.run(ctx, {}) as string;
    expect(b).toContain(INSTRUCTION);
    expect(b).toContain("Every claim must cite a graph fact (file:line); say \"psq cannot see this\" rather than guess.");
    expect(b).toContain("- Course: 12 mentions");
    expect(b).toContain("EnrollmentService.Enroll (first mention Services/EnrollmentService.cs:15): 2 — Course, Student");
    expect(b).toContain("**Student** (Models/Student.cs)");
    expect(b).toContain("references Course");
    expect(b).toContain("cannot see:");
  });

  it("states the instruction before any content and again at the end", () => {
    openRefs();
    const b = tools.brief.run(ctx, {}) as string;
    expect(b.indexOf(INSTRUCTION)).toBeGreaterThan(-1);
    expect(b.indexOf(INSTRUCTION)).toBeLessThan(b.indexOf("## Areas"));
    expect(b.lastIndexOf(INSTRUCTION)).toBeGreaterThan(b.indexOf("## Warnings"));
  });

  it("ranks the most-mentioned entities by count, not by name", () => {
    const id = openRefs();
    const g = ctx.workspace.get(id)!.graph;
    g.entityRefs = g.entityRefs.filter((r, i) => r.entity !== "Course" || i % 2 === 0);
    const b = tools.brief.run(ctx, {}) as string;
    const hot = b.slice(b.indexOf("Most-mentioned"));
    expect(hot.indexOf("- Student:")).toBeGreaterThan(-1);
    expect(hot.indexOf("- Student:")).toBeLessThan(hot.indexOf("- Course:"));
  });

  it("shows client wiring and unmatched calls", () => {
    openReact();
    const b = tools.brief.run(ctx, {}) as string;
    expect(b).toContain("`GET /api/admin/stats` (src/components/admin/Panel.tsx:15) → no matching route");
    expect(b).toContain("2 client calls match no route");
  });

  it("is deterministic", () => {
    openRefs();
    expect(tools.brief.run(ctx, {})).toBe(tools.brief.run(ctx, {}));
  });
});

describe("same-named methods in different files", () => {
  const DUP = ["Controllers/CoursesController.cs", "Services/EnrollmentService.cs"];

  it("entity.refs.topMethods keeps Dup.Sync in two files as two methods", () => {
    const id = openRefs();
    const g = ctx.workspace.get(id)!.graph;
    g.entityRefs = g.entityRefs.filter((r) => r.type === "Dup");
    const top = (tools.entity.run(ctx, { name: "Course" }) as Json).refs.topMethods as Json[];
    const dups = top.filter((m) => m.method === "Dup.Sync");
    expect(dups.map((m) => m.file).sort()).toEqual(DUP);
    expect(dups.map((m) => m.count)).toEqual([1, 1]);
  });

  it("the brief lists each file's method on its own line", () => {
    const id = openRefs();
    const g = ctx.workspace.get(id)!.graph;
    for (const file of DUP) {
      const base = g.entityRefs.find((r) => r.file === file && r.type === "Dup" && r.method === "Sync")!;
      expect(base.line).toBe(55);
      g.entityRefs.push({ ...base, entity: "Student" });
    }
    const b = tools.brief.run(ctx, {}) as string;
    for (const file of DUP) {
      expect(b).toContain(`- Dup.Sync (first mention ${file}:55): 2 — Course, Student`);
    }
  });

  it("the brief lists only methods touching at least two entities", () => {
    openRefs();
    const b = tools.brief.run(ctx, {}) as string;
    const hot = b.slice(b.indexOf("Methods touching"), b.indexOf("Most-connected"));
    expect(hot).not.toContain("Dup.Sync");
    expect(hot).toContain("EnrollmentService.Enroll");
  });
});

describe("routes on a .NET repo", () => {
  it("states that only attribute routes are read, and that zero routes is not zero endpoints", () => {
    openRefs();
    const spots = (tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n");
    expect(spots).toMatch(/ATTRIBUTE routes only/);
    expect(spots).toMatch(/minimal APIs/);
    expect(spots).toContain("psq found no attribute routes; the API may still have endpoints psq cannot see");
    const b = tools.brief.run(ctx, {}) as string;
    expect(b).toContain("cannot see: psq found no attribute routes; the API may still have endpoints psq cannot see");
  });

  it("does not claim 'no attribute routes' when routes exist", () => {
    tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES });
    const spots = (tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n");
    expect(spots).toMatch(/ATTRIBUTE routes only/);
    expect(spots).not.toContain("found no attribute routes");
  });

  it("does not mention attribute routes for a repo that is not .NET", () => {
    openReact();
    const spots = (tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n");
    expect(spots).not.toMatch(/ATTRIBUTE/);
  });

  it("reports matched/total when most client calls are unmatched", () => {
    const id = openReact();
    const g = ctx.workspace.get(id)!.graph;
    const total = g.clientCalls.length;
    for (const c of g.clientCalls) c.matches = null;
    g.clientCalls[0]!.matches = "GET /api/x";
    const spots = (tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n");
    expect(spots).toContain(`Only 1 of ${total} client calls match a route`);
  });

  it("stays quiet when most client calls match", () => {
    openReact();
    const spots = (tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n");
    expect(spots).not.toMatch(/client calls match a route/);
  });
});

describe("flow", () => {
  it("routes carry the handler type.method and its file:line", () => {
    tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES });
    const r = (tools.routes.run(ctx, {}) as Json).routes.find((x: Json) => x.handler?.method === "Create");
    expect(r.handler).toMatchObject({ type: "WidgetsController", method: "Create" });
    expect(r.handlerCite).toBe(`${r.handler.file}:${r.handler.line}`);
  });

  it("the brief joins each route's handler to the entities it mentions", () => {
    tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES });
    const b = tools.brief.run(ctx, {}) as string;
    const flow = b.slice(b.indexOf("## Flow"), b.indexOf("## Client-call"));
    expect(flow).toMatch(/`POST \/api\/Widgets` → WidgetsController\.Create \(.+\.cs:\d+\): Widget\n/i);
    expect(flow).not.toContain("no entity mentioned");
  });

  it("lists entity-bearing routes first even when many entity-less routes precede them", () => {
    const id = tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES }) as Json;
    const g = ctx.workspace.get(id.id)!.graph;
    const bare = g.routes.find((r) => r.handler && !g.entityRefs.some((e) => e.type === r.handler!.type && e.method === r.handler!.method && e.file === r.handler!.file))!;
    expect(bare).toBeDefined();
    const before = g.routes.filter((r) => r.handler).length;
    g.routes.unshift(...Array.from({ length: 20 }, (_, i) => ({ ...bare, path: `/bare${i}` })));
    const b = tools.brief.run(ctx, {}) as string;
    const flow = b.slice(b.indexOf("## Flow"), b.indexOf("## Client-call"));
    expect(flow).toMatch(/`POST \/api\/Widgets` → WidgetsController\.Create/);
    expect(flow).not.toContain("/bare");
    expect(flow).toContain(`${20 + before - flow.split("\n").filter((l) => /^- `[A-Z]+ /.test(l)).length} more routes with handlers touching no entity directly — they likely delegate to services, which psq does not follow yet`);
  });

  it("orders entity-bearing routes by entity count desc, then method and path", () => {
    const id = tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES }) as Json;
    const g = ctx.workspace.get(id.id)!.graph;
    const base = g.routes.find((r) => r.handler && r.method === "POST")!;
    const h = base.handler!;
    g.entityRefs.push({ ...g.entityRefs.find((e) => e.file === h.file && e.type === h.type && e.method === h.method)!, entity: "Zed" });
    g.routes.push({ ...base, method: "GET", path: "/api/aaa" });
    const flow = (tools.brief.run(ctx, {}) as string).split("\n").filter((l) => /^- `[A-Z]+ .*` →/.test(l) && l.includes(h.method + " ("));
    expect(flow[0]).toContain("`GET /api/aaa`");
    expect(flow[1]).toContain("`POST /api/Widgets`");
    expect(flow[0]).toMatch(/, Zed$|Widget, Zed/);
  });

  it("puts a higher-count route first even when its method+path sort later", () => {
    const id = tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES }) as Json;
    const g = ctx.workspace.get(id.id)!.graph;
    const create = g.routes.find((r) => r.handler && r.method === "POST")!;
    const createRef = g.entityRefs.find((e) => e.type === create.handler!.type && e.method === create.handler!.method && e.file === create.handler!.file)!;
    g.entityRefs.push({ ...createRef, entity: "Zed" }, { ...createRef, entity: "Yank" });
    const list = g.routes.find((r) => r.handler && r.handler.method === "List")!;
    g.routes.push({ ...create, method: "POST", path: "/api/zzz" });
    g.routes.push({ ...list, method: "GET", path: "/api/aaa" });
    const b = tools.brief.run(ctx, {}) as string;
    const flow = b.slice(b.indexOf("## Flow"), b.indexOf("## Client-call")).split("\n");
    const idx = (m: string, p: string): number => flow.findIndex((l) => l.includes(`\`${m} ${p}\``) && l.includes("→"));
    const zzz = idx("POST", "/api/zzz");
    const aaa = idx("GET", "/api/aaa");
    expect(zzz).toBeGreaterThan(-1);
    expect(aaa).toBeGreaterThan(-1);
    expect(zzz).toBeLessThan(aaa);
  });

  it("says no handler mentions an entity directly when none do", () => {
    const id = tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES }) as Json;
    const g = ctx.workspace.get(id.id)!.graph;
    g.entityRefs = [];
    const b = tools.brief.run(ctx, {}) as string;
    const flow = b.slice(b.indexOf("## Flow"), b.indexOf("## Client-call"));
    expect(flow).toContain("no handler mentions an entity directly");
  });

  it("caps the flow list and says so", () => {
    const id = tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES }) as Json;
    const g = ctx.workspace.get(id.id)!.graph;
    const base = g.routes.find((r) => r.handler && g.entityRefs.some((e) => e.type === r.handler!.type && e.method === r.handler!.method && e.file === r.handler!.file))!;
    for (let i = 0; i < 30; i++) g.routes.push({ ...base, path: `/extra${i}` });
    const b = tools.brief.run(ctx, {}) as string;
    expect(b).toMatch(/… \d+ more routes with handlers not shown/);
  });

  it("caps the entities shown per route and says how many it dropped", () => {
    const id = tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES }) as Json;
    const g = ctx.workspace.get(id.id)!.graph;
    const h = g.routes.find((r) => r.method === "POST" && r.handler)!.handler!;
    const ref = g.entityRefs.find((e) => e.file === h.file && e.type === h.type && e.method === h.method)!;
    for (let i = 0; i < 12; i++) g.entityRefs.push({ ...ref, entity: `Extra${String(i).padStart(2, "0")}` });
    const b = tools.brief.run(ctx, {}) as string;
    const flow = b.slice(b.indexOf("## Flow"), b.indexOf("## Client-call"));
    const line = flow.split("\n").find((l) => l.startsWith("- `POST /api/Widgets`"))!;
    // Widget + Extra00..Extra11 = 13 distinct entities, 8 shown.
    expect(line).toMatch(/, … 5 more$/);
    expect(line).not.toContain("Extra11");
  });

  it("has no Flow section when no route has a handler", () => {
    const id = openReact();
    for (const r of ctx.workspace.get(id)!.graph.routes) delete r.handler;
    expect(tools.brief.run(ctx, {}) as string).not.toContain("## Flow");
  });
});

describe("several repos open", () => {
  it("requires repo, with a clear error, instead of picking the first", () => {
    const a = openRefs();
    const b = openReact();
    expect(() => resolveRepo(ctx)).toThrow(/2 repos are open.*pass `repo`/);
    expect(() => tools.routes.run(ctx, {})).toThrow(/pass `repo`/);
    expect(resolveRepo(ctx, b).id).toBe(b);
    expect(resolveRepo(ctx, a).id).toBe(a);
  });
});

describe("brief caps", () => {
  it("caps areas and the members listed per area, saying how many were dropped", () => {
    const id = openRefs();
    // The layout is recomputed on every call, so pin one that is big enough to cut.
    const l3 = ctx.workspace.layout3dOf(id)!;
    const d0 = l3.districts[0]!;
    for (let i = 0; i < 35; i++) l3.districts.push({ ...d0, name: `area${String(i).padStart(2, "0")}` });
    for (let i = 0; i < 20; i++) l3.nodes.push({ ...l3.nodes[0]!, name: `Member${i}`, district: d0.name });
    ctx.workspace.layout3dOf = () => l3;
    const b = tools.brief.run(ctx, {}) as string;
    const areas = b.slice(b.indexOf("## Areas"), b.indexOf("## Entities"));
    expect(areas).toContain("- … 6 more areas not shown");
    expect(areas).toMatch(/\*\*all\*\* \(22\): .*, … 7 more\n/);
  });

  it("caps calls per component, saying how many were dropped", () => {
    const id = openReact();
    const g = ctx.workspace.get(id)!.graph;
    const call = g.clientCalls.find((c) => c.components.length > 0)!;
    for (let i = 0; i < 15; i++) g.clientCalls.push({ ...call, path: `/api/more${i}` });
    const b = tools.brief.run(ctx, {}) as string;
    expect(b).toMatch(/ {2}- … \d+ more calls not shown/);
  });
});
