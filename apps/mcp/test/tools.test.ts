import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../server/src/workspace.js";
import { INSTRUCTION } from "../src/brief.js";
import { cap } from "../src/common.js";
import { CAP, resolveRepo, tools, type Ctx } from "../src/tools.js";
import { MINI_EFCORE_REFS, MINI_FULLSTACK_REACT } from "../../../test/fixtures.js";

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
    expect(ctx.defaultRepo).toBe(s.id);
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
      { method: "POST", path: "/api/admin/cards", cite: "server.ts:25", calledByClient: true },
    ]);
  });

  it("passes through a handler when the graph has one, and works without", () => {
    const id = openReact();
    const repo = ctx.workspace.get(id)!;
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
    openRefs();
    expect((tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n")).not.toMatch(/wrapper functions/);
    openReact();
    expect((tools.warnings.run(ctx, { repo: ctx.defaultRepo }) as Json).cannotSee.join("\n")).not.toMatch(/wrapper functions/);
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
    expect(b).toContain("EnrollmentService.Enroll (Services/EnrollmentService.cs:15): 2 — Course, Student");
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
