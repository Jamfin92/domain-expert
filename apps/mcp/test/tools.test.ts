import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { WarningCode } from "@psq/schema";
import { Workspace } from "../../server/src/workspace.js";
import { INSTRUCTION, provenanceLine } from "../src/brief.js";
import { blindSpots, cap, LIMITS } from "../src/common.js";
import { CAP, resolveRepo, tools, type Ctx, type Next, type ToolName } from "../src/tools.js";
import { MINI_EFCORE_REFS, MINI_FULLSTACK_REACT, MINI_REACT, MINI_TYPES_ONLY, NOT_A_PROJECT } from "../../../test/fixtures.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures");
const MINI_ASPNET_ROUTES = resolve(FIXTURES, "mini-aspnet-routes");

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
        method: "POST", path: "/api/admin/cards", cite: "server.ts:25", source: "declared", calledByClient: true,
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
    // The FALLBACK test, deliberately out of step: a string pushed after
    // extraction leaves `warningRecords` one short, so no consumer may render
    // the (now stale) records. The tool omits both keys; the brief prints the
    // plain string with no code.
    ctx.workspace.get(id)!.graph.warnings.push("something psq did not understand");
    const w = tools.warnings.run(ctx, {}) as Json;
    expect(w.count).toBe(1);
    expect(w.warnings).toEqual(["something psq did not understand"]);
    expect("records" in w).toBe(false);
    expect("byCode" in w).toBe(false);
    const b = tools.brief.run(ctx, {}) as string;
    const lines = b.split("\n").filter((l) => l.startsWith("- warning"));
    expect(lines).toEqual(["- warning: something psq did not understand"]);
    expect(b).not.toContain("- by code:");
  });

  it("carries one typed record per warning, grouped by code", () => {
    tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES });
    const w = tools.warnings.run(ctx, {}) as Json;
    expect(w.count).toBe(11);
    expect(w.records).toHaveLength(w.count);
    expect(w.records.map((r: Json) => r.text)).toEqual(w.warnings);
    for (const r of w.records) expect(WarningCode.options).toContain(r.code);
    // Independent of `byCode`: count per code, distinct non-null files, then
    // count desc and code asc.
    const acc = new Map<string, { count: number; files: Set<string> }>();
    for (const r of w.records as Json[]) {
      const e = acc.get(r.code) ?? { count: 0, files: new Set<string>() };
      e.count++;
      if (r.file !== null) e.files.add(r.file);
      acc.set(r.code, e);
    }
    const expected = [...acc.entries()]
      .map(([code, e]) => ({ code, count: e.count, files: e.files.size }))
      .sort((a, b) => (a.count !== b.count ? b.count - a.count : a.code < b.code ? -1 : 1));
    expect(expected).toHaveLength(10);
    expect(expected[0]).toEqual({ code: "route-inherited-not-read", count: 2, files: 1 });
    expect(w.byCode).toEqual(expected);
  });

  it("counts distinct files per code and ignores a null file", () => {
    // No fixture has one code across two files; this one has a code whose file is null.
    tools.open_repo.run(ctx, { path: resolve(FIXTURES, "mini-client-base") });
    const w = tools.warnings.run(ctx, {}) as Json;
    expect(w.byCode).toEqual([
      { code: "client-base-unreadable", count: 2, files: 1 },
      { code: "no-schema", count: 1, files: 0 },
    ]);
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

  it("carries the graphDigest as a comment on its second line", () => {
    const { graphDigest } = tools.open_repo.run(ctx, { path: MINI_EFCORE_REFS }) as Json;
    const lines = (tools.mermaid.run(ctx, {}) as string).split("\n");
    expect(lines[0]).toBe("erDiagram");
    expect(lines[1]).toBe(`%% graphDigest ${graphDigest}`);
    // The rest is @psq/graph's mermaid() unchanged.
    expect(lines.filter((l) => l.startsWith("%%"))).toHaveLength(1);
  });
});

describe("stop conditions", () => {
  it("every tool description ends with exactly one sentence from the LIMITS table", () => {
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description.split(" Limit: "), name).toHaveLength(2);
      expect(t.description.endsWith(` Limit: ${LIMITS[t.limit].text}`), name).toBe(true);
    }
  });

  it("every cannotSee line comes from the same table", () => {
    // Catches a cannotSee line that is not a LIMITS row (measured: a rogue line in blindSpots reddens it);
    // does NOT check the content of a row's see() string, since `allowed` is built from see() itself.
    for (const path of [MINI_EFCORE_REFS, MINI_FULLSTACK_REACT, MINI_TYPES_ONLY, MINI_ASPNET_ROUTES,
      resolve(FIXTURES, "mini-fullstack-csharp"), resolve(FIXTURES, "mini-node")]) {
      const g = ctx.workspace.open(path, { allowEmpty: true }).graph;
      const allowed = new Set<string>();
      for (const row of Object.values(LIMITS)) {
        allowed.add(row.text);
        const v = "see" in row ? row.see(g) : false;
        if (typeof v === "string") allowed.add(v);
      }
      for (const line of blindSpots(g)) expect(allowed.has(line), line).toBe(true);
    }
  });

  it("does not claim raw DDL never declares a foreign key", () => {
    // ddl.ts marks an explicit FOREIGN KEY `declared`.
    openReact();
    const spots = (tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n");
    expect(spots).toContain("unless the DDL declares a FOREIGN KEY");
    expect(spots).not.toMatch(/no foreign key is declared/);
  });

  it("words mirrors:null by provider: not computed cross-stack only in a .NET + TS merge", () => {
    const cross = blindSpots(ctx.workspace.open(resolve(FIXTURES, "mini-fullstack-csharp")).graph).join("\n");
    expect(cross).toContain('`mirrors: null` on a TypeScript shape means "not computed" cross-stack');
    expect(cross).not.toContain("found none whose name and fields both match");
    const single = blindSpots(ctx.workspace.open(resolve(FIXTURES, "mini-node")).graph).join("\n");
    expect(single).toContain("found none whose name and fields both match");
    expect(single).not.toContain("not computed");
  });
});

describe("next hints", () => {
  /** Every `next` must be a call the named tool accepts, and must not fail when made. */
  function walk(results: Json[]): Next[] {
    const all: Next[] = results.flatMap((r) => (r.next ?? []) as Next[]);
    for (const n of all) {
      expect(Object.keys(tools), JSON.stringify(n)).toContain(n.tool);
      const parsed = z.object(tools[n.tool].shape).strict().safeParse(n.args);
      expect(parsed.success, `${n.tool} ${JSON.stringify(n.args)}`).toBe(true);
      expect(n.why.length).toBeGreaterThan(0);
      expect(() => (tools[n.tool].run as (c: Ctx, a: unknown) => unknown)(ctx, n.args)).not.toThrow();
    }
    return all;
  }
  const kinds = new Set<string>();
  const seen = (from: ToolName, ns: Next[]): void => ns.forEach((n) => kinds.add(`${from}->${n.tool}`));

  it("entity, routes, flow and search_entities emit only valid calls", () => {
    // efcore with a resolved call: entity -> refs, flow, entity
    const refsId = openRefs();
    for (const name of ["Course", "Student"]) seen("entity", walk([tools.entity.run(ctx, { repo: refsId, name })]));

    // attribute routes with handlers: routes -> flow; flow -> flow (depth), entity
    const aspnet = (tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES }) as Json).id;
    const routes = tools.routes.run(ctx, { repo: aspnet }) as Json;
    seen("routes", walk([routes]));
    for (const n of routes.next.filter((x: Next) => x.tool === "flow")) {
      seen("flow", walk([tools.flow.run(ctx, { ...n.args, maxDepth: 0 })]));
      seen("flow", walk([tools.flow.run(ctx, n.args)]));
    }

    // A cut route list narrows by prefix.
    const repo = ctx.workspace.get(aspnet)!;
    const base = repo.graph.routes[0]!;
    for (let i = 0; i < CAP.routes + 10; i++) repo.graph.routes.push({ ...base, path: `/many/r${i}` });
    seen("routes", walk([tools.routes.run(ctx, { repo: aspnet })]));

    // A cut search narrows by wholeWord, and each hit points at entity.
    const r = ctx.workspace.get(refsId)!;
    const e0 = r.graph.entities[0]!;
    for (let i = 0; i < CAP.hits + 5; i++) r.graph.entities.push({ ...e0, name: `Widget${i}`, properties: [] });
    const search = tools.search_entities.run(ctx, { repo: refsId, query: "widget" }) as Json;
    expect(search.truncated).toBe(true);
    seen("search_entities", walk([search]));

    // Positive controls: every branch that emits a `next` fired at least once,
    // so the shape check above is not vacuous.
    expect([...kinds].sort()).toEqual([
      "entity->entity", "entity->flow", "entity->refs",
      "flow->entity", "flow->flow",
      "routes->flow", "routes->routes",
      "search_entities->entity", "search_entities->search_entities",
    ]);
  });

  it("routes on a repo with no entities does not point at flow", () => {
    tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY });
    const repo = resolveRepo(ctx);
    repo.graph.routes.push({ method: "GET", path: "/x", file: "a.ts", line: 1, source: "declared", handler: { type: "a", method: "b", file: "a.ts", line: 1 } });
    expect((tools.routes.run(ctx, {}) as Json).next).toEqual([]);
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

describe("provenance on projected facts (P2c-ii)", () => {
  it("overview client calls carry matchSource beside matches, and the nested attribution source", () => {
    openReact();
    const o = tools.overview.run(ctx, {}) as Json;
    const calls = o.components.flatMap((c: Json) => c.clientCalls);
    expect(calls.find((c: Json) => c.cite === "src/components/admin/Card.tsx:13")).toMatchObject({
      matches: "POST /api/admin/cards", matchSource: "inferred", componentsSource: "declared",
    });
    expect(calls.find((c: Json) => c.cite === "src/components/admin/Panel.tsx:15")).toMatchObject({
      matches: null, matchSource: null, componentsSource: "declared",
    });
    // Reached through a reference walk: attributed to both Card components, inferred.
    const walked = calls.filter((c: Json) => c.cite === "src/lib/save-card.ts:7");
    expect(walked).toHaveLength(2);
    for (const c of walked) expect(c).toMatchObject({ matchSource: "inferred", componentsSource: "inferred" });
    expect(o.components.every((c: Json) => c.source === "inferred")).toBe(true);
  });

  it("client_calls carry matchSource and componentsSource", () => {
    tools.open_repo.run(ctx, { path: MINI_REACT });
    const calls = (tools.client_calls.run(ctx, {}) as Json).calls;
    const at = (cite: string): Json => calls.find((c: Json) => c.cite === cite);
    expect(at("src/components/HomePage.tsx:6")).toMatchObject({
      matches: null, matchSource: null, components: ["src/components/HomePage.tsx#HomePage"], componentsSource: "declared",
    });
    expect(at("src/services/api.ts:9")).toMatchObject({
      components: ["src/components/UserList.tsx#UserList"], componentsSource: "inferred",
    });
    expect(at("src/lib/boot.ts:2")).toMatchObject({ components: [], componentsSource: null });
    ctx.workspace.closeAll();
    openReact();
    const fs = (tools.client_calls.run(ctx, {}) as Json).calls;
    expect(fs.find((c: Json) => c.cite === "src/lib/boot.ts:5")).toMatchObject({
      matches: "GET /api/cards", matchSource: "inferred", components: [], componentsSource: null,
    });
  });

  it("refs items carry source", () => {
    openRefs();
    const r = tools.refs.run(ctx, { entity: "Course" }) as Json;
    expect(r.refs.length).toBeGreaterThan(0);
    expect(r.refs[0]).toMatchObject({ via: expect.any(String), source: "inferred" });
  });

  it("overview routes and the routes tool share the route projection", () => {
    tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES });
    const o = tools.overview.run(ctx, {}) as Json;
    const routes = o.routeGroups.flatMap((x: Json) => x.routes);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((r: Json) => r.source === "attribute")).toBe(true);
  });
});

describe("brief provenance line", () => {
  const CITE = " Cite `inferred` facts as psq's inference, never as what the repo states.";
  const provLines = (b: string): string[] => b.split("\n").filter((l) => l.startsWith("Provenance:"));
  const briefOf = (path: string): string => {
    ctx.workspace.closeAll();
    tools.open_repo.run(ctx, { path });
    return tools.brief.run(ctx, {}) as string;
  };

  it("pins the exact line on fixtures with each family", () => {
    expect(provLines(briefOf(MINI_ASPNET_ROUTES))).toEqual([
      "Provenance: routes 30 attribute; calls 16 declared, 6 inferred (2 of them ambiguous); entity refs 10 inferred." + CITE,
    ]);
    expect(provLines(briefOf(MINI_FULLSTACK_REACT))).toEqual([
      "Provenance: routes 2 declared; client calls 6 of 8 matched (6 inferred); " +
        "component attribution 6 declared, 1 inferred; components 4 inferred." + CITE,
    ]);
    expect(provLines(briefOf(MINI_REACT))).toEqual([
      "Provenance: client calls 0 of 24 matched; component attribution 4 declared, 7 inferred; components 15 inferred." + CITE,
    ]);
    expect(provLines(briefOf(MINI_TYPES_ONLY))).toEqual([
      "Provenance: no routes, calls, client calls, components or entity refs.",
    ]);
    expect(provLines(briefOf(NOT_A_PROJECT))).toEqual([
      "Provenance: no routes, calls, client calls, components or entity refs.",
    ]);
  });

  it("sits directly after the counts line, above the Areas header", () => {
    for (const path of [MINI_ASPNET_ROUTES, MINI_TYPES_ONLY]) {
      const lines = briefOf(path).split("\n");
      const at = lines.findIndex((l) => l.startsWith("Provenance:"));
      expect(lines[at - 1]).toMatch(/^Provider `/);
      expect(lines[at + 1]).toBe("");
      expect(at).toBeLessThan(lines.findIndex((l) => l.startsWith("## Areas")));
    }
  });

  // A hand-built graph: every family, mixed sources, so the grammar is pinned
  // in full rather than as each fixture happens to fill it.
  const r = (source: string): Json => ({ method: "GET", path: "/x", file: "a.cs", line: 1, source });
  const call = (source: string, ambiguous?: boolean): Json => ({
    from: { type: "A", method: "a", file: "a.cs" }, to: { type: "B", method: "b" }, line: 1, source,
    ...(ambiguous ? { ambiguous: true } : {}),
  });
  const cc = (matchSource: string | null, componentsSource: string | null): Json => ({
    method: "GET", path: "/x", file: "c.ts", line: 1, enclosing: null,
    matches: matchSource === null ? null : "GET /x", matchSource,
    components: componentsSource === null ? [] : ["c.tsx#C"], componentsSource,
  });
  const comp = (source: string): Json => ({ key: "c.tsx#C", name: "C", file: "c.tsx", line: 1, source });
  const ref = (source: string): Json => ({ entity: "E", file: "a.cs", line: 1, type: "A", method: "a", via: "entityName", source });

  it("renders every family in a fixed order, sources in FactSource order, zero buckets omitted", () => {
    // Asymmetric on purpose: every bucket in a family has its own count, and the
    // matched calls' matchSource split (1 declared, 2 inferred) differs from the
    // attributed calls' componentsSource split (3 declared, 1 inferred), so a
    // swapped label or a cross-read field changes the line.
    const g: Json = {
      routes: [r("declared"), r("attribute"), r("declared")],
      calls: [call("inferred", true), call("declared"), call("inferred", true), call("inferred")],
      clientCalls: [
        cc("inferred", "declared"), cc("inferred", "declared"), cc("declared", "declared"),
        cc(null, "inferred"), cc(null, null),
      ],
      components: [comp("inferred"), comp("inferred")],
      entityRefs: [ref("declared"), ref("inferred"), ref("declared")],
    };
    expect(provenanceLine(g)).toBe(
      "Provenance: routes 1 attribute, 2 declared; calls 1 declared, 3 inferred (2 of them ambiguous); " +
        "client calls 3 of 5 matched (1 declared, 2 inferred); component attribution 3 declared, 1 inferred; " +
        "components 2 inferred; entity refs 2 declared, 1 inferred." + CITE,
    );
  });

  it("renders only present families, and the Cite clause only when something is inferred", () => {
    const g: Json = {
      routes: [r("declared"), r("declared")],
      calls: [],
      clientCalls: [cc(null, null)],
      components: [],
      entityRefs: [ref("declared")],
    };
    expect(provenanceLine(g)).toBe("Provenance: routes 2 declared; client calls 0 of 1 matched; entity refs 1 declared.");
    // No call edges at all (`calls` absent) is an absent family too.
    expect(provenanceLine({ ...g, calls: undefined })).toBe(provenanceLine(g));
    expect(provenanceLine({ ...g, calls: [call("declared")] })).toBe(
      "Provenance: routes 2 declared; calls 1 declared; client calls 0 of 1 matched; entity refs 1 declared.",
    );
    expect(provenanceLine({ routes: [], calls: [], clientCalls: [], components: [], entityRefs: [] } as Json)).toBe(
      "Provenance: no routes, calls, client calls, components or entity refs.",
    );
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
    expect(flow).toContain(`${20 + before - flow.split("\n").filter((l) => /^- `[A-Z]+ /.test(l)).length} more routes with named handlers reach no entity psq can see`);
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

  it("says no handler reaches an entity when none do", () => {
    const id = tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES }) as Json;
    const g = ctx.workspace.get(id.id)!.graph;
    g.entityRefs = [];
    const b = tools.brief.run(ctx, {}) as string;
    const flow = b.slice(b.indexOf("## Flow"), b.indexOf("## Client-call"));
    expect(flow).toContain("no handler reaches an entity psq can see");
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

describe("brief coverage", () => {
  const FACETS = [
    "entities", "relations", "shapes", "routes", "clientCalls", "components", "entityRefs", "calls", "pairing",
  ];
  const coverageOf = (b: string): string => {
    expect(b.indexOf("## Hot spots")).toBeGreaterThan(-1);
    expect(b.indexOf("## Coverage")).toBeGreaterThan(b.indexOf("## Hot spots"));
    expect(b.indexOf("## Warnings")).toBeGreaterThan(b.indexOf("## Coverage"));
    return b.slice(b.indexOf("## Coverage"), b.indexOf("## Warnings"));
  };

  it("brief has a Coverage section between Hot spots and Warnings", () => {
    tools.open_repo.run(ctx, { path: resolve(FIXTURES, "mini-fullstack-csharp") });
    const c = coverageOf(tools.brief.run(ctx, {}) as string);
    const lines = c.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.slice(0, 9).map((l) => l.slice(2, l.indexOf(":")))).toEqual(FACETS);
    expect(lines).toHaveLength(10);
    expect(lines[9]).toMatch(
      /^- basis: \d+ \.cs \(\d+ under test paths\), \d+ \.csproj \(\d+ under test paths\), \d+ \.ts\/\.tsx \(\d+ under test paths\); package\.json (yes|no); tsconfig\.json (yes|no)$/,
    );
    // The merged fullstack facet: only the TS half read client calls, so only its root shows.
    expect(c).toContain("\n- clientCalls: complete (readers client-calls; roots client; 3 files)\n");
    // Both halves ran for entities: every list joins with ", ".
    expect(c).toContain("\n- entities: complete (readers efcore, sqlite-ddl; roots ., client; 7 files)\n");
  });

  it("ends the entities line with the reason on a repo with no entities", () => {
    tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY });
    const c = coverageOf(tools.brief.run(ctx, {}) as string);
    const entities = c.split("\n").find((l) => l.startsWith("- entities:"))!;
    expect(entities).toMatch(/ — no CREATE TABLE literal among 2 TypeScript files$/);
    expect(c).toContain("\n- calls: not-read — no TypeScript reader for method calls\n");
  });
});

describe("brief warnings", () => {
  const warningLines = (b: string): string[] => b.split("\n").filter((l) => l.startsWith("- warning"));

  it("tags each warning with its code, after one by-code line", () => {
    tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES });
    const b = tools.brief.run(ctx, {}) as string;
    const byCodeLines = b.split("\n").filter((l) => l.startsWith("- by code: "));
    expect(byCodeLines).toEqual([
      "- by code: route-inherited-not-read 2, route-accept-verbs 1, route-action-name-undecided 1, " +
        "route-any-verb 1, route-area-not-read 1, route-conventional 1, route-minimal-api 1, " +
        "route-template-invalid 1, route-template-not-literal 1, route-verb-undecided 1",
    ]);
    const at = b.indexOf("- by code: ");
    expect(at).toBeGreaterThan(b.indexOf("## Warnings"));
    expect(at).toBeLessThan(b.indexOf("- warning ["));
    const lines = warningLines(b);
    expect(lines).toHaveLength(11);
    for (const l of lines) expect(l).toMatch(/^- warning \[[a-z-]+\] /);
    expect(b).not.toMatch(/more warnings not shown/);
  });

  it("pins the by-code line on a fullstack repo", () => {
    tools.open_repo.run(ctx, { path: resolve(FIXTURES, "mini-fullstack-csharp") });
    const b = tools.brief.run(ctx, {}) as string;
    expect(b.split("\n").filter((l) => l.startsWith("- by code: "))).toEqual([
      "- by code: no-schema 1, shapes-unpaired 1",
    ]);
  });

  it("has no by-code line for one warning or none", () => {
    tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY });
    const one = tools.brief.run(ctx, {}) as string;
    expect(warningLines(one)).toHaveLength(1);
    expect(warningLines(one)[0]).toMatch(/^- warning \[[a-z-]+\] /);
    expect(one).not.toContain("- by code:");
    ctx.workspace.closeAll();
    openRefs();
    const none = tools.brief.run(ctx, {}) as string;
    expect(none).toContain("- extraction produced no warnings");
    expect(none).not.toContain("- by code:");
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
