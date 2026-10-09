import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import request from "supertest";
import type { Express } from "express";
import { EntitySearchResult } from "@psq/schema";
import { createApp } from "../src/app.js";
import { Workspace } from "../src/workspace.js";
import { MINI_EFCORE, MINI_EFCORE_REFS, MINI_FULLSTACK, MINI_FULLSTACK_REACT, MINI_NODE } from "../../../test/fixtures.js";

let app: Express;
let workspace: Workspace;

beforeEach(() => {
  const made = createApp(new Workspace(() => "2026-01-01T00:00:00.000Z"));
  app = made.app;
  workspace = made.workspace;
});
afterEach(() => workspace.closeAll());

async function openMini(): Promise<string> {
  const res = await request(app).post("/api/repos").send({ path: MINI_EFCORE });
  expect(res.status).toBe(201);
  return res.body.repo.id as string;
}

describe("opening a repo", () => {
  it("extracts, seeds and builds a bank in one call", async () => {
    const res = await request(app).post("/api/repos").send({ path: MINI_EFCORE });
    expect(res.status).toBe(201);
    expect(res.body.repo).toMatchObject({
      name: "mini-efcore",
      contextName: "MiniDbContext",
      entities: 5,
      warnings: [],
    });
    expect(res.body.repo.questions).toBeGreaterThan(30);
    expect(res.body.repo.seededRows).toBeGreaterThan(100);
  });

  it("explains itself when the path is wrong, rather than throwing a stack", async () => {
    const missing = await request(app).post("/api/repos").send({ path: "/nope/not/here" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain("No such directory");

    const blank = await request(app).post("/api/repos").send({});
    expect(blank.status).toBe(400);
    expect(blank.body.error).toContain("path to a repo");
  });

  it("says so plainly, and says why, when a repo has no model psq can read", async () => {
    // This repo's own packages/ directory: real code, but nothing psq can read.
    const packagesDir = resolve(fileURLToPath(import.meta.url), "../../../../packages");
    const res = await request(app).post("/api/repos").send({ path: packagesDir });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No entities found");
    // The reason names what psq actually looked for in THIS repo, not a generic apology.
    expect(res.body.error).toContain("CREATE TABLE");
  });

  it("reopening replaces the old copy instead of leaking a database", async () => {
    const first = await openMini();
    const second = await openMini();
    expect(second).toBe(first);
    expect((await request(app).get("/api/repos")).body.repos).toHaveLength(1);
  });

  it("closes a repo and forgets its sessions", async () => {
    const id = await openMini();
    const quiz = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 3 });
    const sessionId = quiz.body.session.id as string;
    expect((await request(app).delete(`/api/repos/${id}`)).status).toBe(200);
    expect((await request(app).get(`/api/quiz/${sessionId}`)).status).toBe(404);
    expect((await request(app).delete(`/api/repos/${id}`)).status).toBe(404);
  });
});

describe("graph endpoints", () => {
  it("returns the graph, a layout and mermaid", async () => {
    const id = await openMini();

    const graph = await request(app).get(`/api/repos/${id}/graph`);
    expect(graph.body.graph.entities).toHaveLength(5);

    const layout = await request(app).get(`/api/repos/${id}/layout`);
    expect(layout.body.layout.nodes).toHaveLength(5);
    expect(layout.body.layout.width).toBeGreaterThan(0);
    // Row counts decorate the nodes so the diagram can show table sizes.
    expect(layout.body.layout.nodes.every((n: { rowCount: number }) => n.rowCount > 0)).toBe(true);

    const mmd = await request(app).get(`/api/repos/${id}/mermaid`);
    expect(mmd.text.startsWith("erDiagram")).toBe(true);
  });

  it("returns a 3d layout with integer geometry and a district basis", async () => {
    const id = await openMini();
    const res = await request(app).get(`/api/repos/${id}/layout3d`);
    expect(res.status).toBe(200);
    const l = res.body.layout3d;
    // mini-efcore has one namespace, one dir and one connected component, so
    // the district rule must land on its explicit degenerate tier.
    expect(l.districtBasis).toBe("single");
    expect(l.nodes).toHaveLength(5);
    expect(l.edges).toHaveLength(4);
    for (const n of l.nodes) {
      for (const v of [n.x, n.z, n.width, n.depth, n.height, n.tier]) {
        expect(Number.isInteger(v)).toBe(true);
      }
      // Seeded rows reach the buildings, exactly as they reach the 2D boxes.
      expect(n.rowCount).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThanOrEqual(2);
    }
    // At least one table is seeded well past the floor height.
    expect(l.nodes.some((n: { height: number }) => n.height > 2)).toBe(true);
    for (const e of l.edges) expect(e.cardinality).toBe("one-to-many");
  });

  it("404s for a repo that is not open", async () => {
    // `search` belongs in this loop, with no query string, because the repo
    // lookup runs BEFORE `q` validation: an unknown repo is unknown whatever
    // the query says, so 404 beats 400.
    for (const path of ["graph", "layout", "layout3d", "mermaid", "questions", "selftest", "search"]) {
      expect((await request(app).get(`/api/repos/deadbeef/${path}`)).status, path).toBe(404);
    }
  });

  it("reports the bank breakdown and its own selftest", async () => {
    const id = await openMini();
    const q = await request(app).get(`/api/repos/${id}/questions`);
    expect(q.body.total).toBeGreaterThan(30);
    expect(Object.keys(q.body.byKind).sort()).toEqual(["cloze", "mcq", "sql"]);

    const st = await request(app).get(`/api/repos/${id}/selftest`);
    expect(st.body).toEqual({ ok: true, findings: [] });
  });
});

describe("entity search", () => {
  it("returns a parseable result that names the fields it searched", async () => {
    const id = await openMini();
    const res = await request(app).get(`/api/repos/${id}/search`).query({ q: "email" });
    expect(res.status).toBe(200);

    // The body is the wire type, not a bare array, and `searched` is derived
    // from MATCH_FIELDS rather than written out here — a fourth match field
    // reaches the API surface without anyone remembering to add it.
    const parsed = EntitySearchResult.safeParse(res.body);
    expect(parsed.success).toBe(true);
    const result = parsed.data!;
    expect(result.query).toBe("email");
    expect(result.searched).toEqual(["entityName", "tableName", "propertyName"]);
    expect(result.hits.map((h) => h.name)).toEqual(["Student"]);
    expect(result.hits[0]!.reasons).toEqual([
      { field: "propertyName", matched: "Email", property: "Email" },
    ]);
  });

  it("400s when q is missing", async () => {
    const id = await openMini();
    const missing = await request(app).get(`/api/repos/${id}/search`);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain("?q=");
  });

  it("400s when q is repeated", async () => {
    // Its own test, not a second assertion in the one above: sharing an `it`
    // means the first failing expectation hides the second, so a mutant could
    // never be shown to redden this case specifically.
    //
    // express's "simple" query parser turns `?q=a&q=b` into ["a", "b"].
    // `String(...)` would quietly search "a,b" and `.trim()` would throw.
    const id = await openMini();
    const repeated = await request(app).get(`/api/repos/${id}/search?q=a&q=b`);
    expect(repeated.status).toBe(400);
  });

  it("200s with no hits when q is present but empty", async () => {
    const id = await openMini();
    const res = await request(app).get(`/api/repos/${id}/search?q=`);
    // Deliberate asymmetry with the case above: asking nothing is a valid
    // request that matches nothing; not asking at all is a malformed one.
    expect(res.status).toBe(200);
    expect(res.body.query).toBe("");
    expect(res.body.hits).toEqual([]);
    expect(res.body.searched).toEqual(["entityName", "tableName", "propertyName"]);
  });
});

describe("entity refs", () => {
  // `openMini()` opens MINI_EFCORE, which has NO refs at all. The refs fixture
  // is opened inline, the pattern MINI_NODE (:317) and MINI_FULLSTACK_REACT
  // (:410) already use.
  async function openRefs(): Promise<string> {
    const res = await request(app).post("/api/repos").send({ path: MINI_EFCORE_REFS });
    expect(res.status).toBe(201);
    return res.body.repo.id as string;
  }

  // G30
  it("answers with entity, via, known and the refs themselves", async () => {
    const id = await openRefs();
    const res = await request(app).get(`/api/repos/${id}/refs`).query({ entity: "Course" });
    expect(res.status).toBe(200);
    // The WHOLE body, keys included: asserting only `refs` would still pass
    // with `entity`, `via` and `known` missing, which is exactly M30.
    expect(Object.keys(res.body).sort()).toEqual(["entity", "known", "refs", "via"]);
    expect(res.body.entity).toBe("Course");
    expect(res.body.via).toBe(null);
    expect(res.body.known).toBe(true);
    expect(res.body.refs.length).toBe(12);
    expect(res.body.refs[0]).toEqual({
      entity: "Course",
      file: "Controllers/CoursesController.cs",
      line: 20,
      type: "CoursesController",
      method: "Slug",
      via: "entityName",
    });
    // `via` filters through the route, and narrows to a strict subset.
    const one = await request(app).get(`/api/repos/${id}/refs`).query({ entity: "Course", via: "dbSetName" });
    expect(one.status).toBe(200);
    expect(one.body.via).toBe("dbSetName");
    expect(one.body.refs.map((r: { file: string; line: number }) => `${r.file}:${r.line}`))
      .toEqual(["Services/EnrollmentService.cs:15"]);
  });

  // G31
  it("404s for a repo that is not open, with the same body every :id route uses", async () => {
    const res = await request(app).get("/api/repos/deadbeef/refs").query({ entity: "Course" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "That repo is not open." });
  });

  // G32
  it("400s when entity is missing or blank", async () => {
    const id = await openRefs();
    const missing = await request(app).get(`/api/repos/${id}/refs`);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain("?entity=");
    for (const blank of ["", " ", "%20%20"]) {
      const res = await request(app).get(`/api/repos/${id}/refs?entity=${blank}`);
      expect(res.status, JSON.stringify(blank)).toBe(400);
    }
  });

  // G33
  it("separates a known entity with no refs from a name the repo never heard of", async () => {
    // MINI_EFCORE is the reachable case, measured: 5 real entities and an
    // EMPTY entityRefs. On MINI_EFCORE_REFS both entities carry refs, so
    // `known` and `refs.length > 0` could never disagree there.
    const mini = await openMini();
    const zero = await request(app).get(`/api/repos/${mini}/refs`).query({ entity: "Student" });
    expect(zero.status).toBe(200);
    expect(zero.body.known).toBe(true);
    expect(zero.body.refs).toEqual([]);

    const unknown = await request(app).get(`/api/repos/${mini}/refs`).query({ entity: "Nonesuch" });
    expect(unknown.status).toBe(200);
    expect(unknown.body.known).toBe(false);
    expect(unknown.body.refs).toEqual([]);
  });

  // G34
  it("400s on a via outside the schema's set, rather than answering nothing", async () => {
    const id = await openRefs();
    const res = await request(app).get(`/api/repos/${id}/refs`).query({ entity: "Course", via: "bogus" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("?via=");
    // Control, same run: a valid via on the same request is a 200.
    const ok = await request(app).get(`/api/repos/${id}/refs`).query({ entity: "Course", via: "entityName" });
    expect(ok.status).toBe(200);
    expect(ok.body.refs.length).toBe(11);
  });

  // G35
  it("puts the repo lookup FIRST: wrong in both ways is a 404, not a 400", async () => {
    // Nothing in G31 or G32 observes the guard order — G31 sends a valid
    // entity and G32 a valid repo. This request is wrong both ways.
    const res = await request(app).get("/api/repos/deadbeef/refs");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "That repo is not open." });
  });

  // G36
  it("400s on repeated params rather than looking up the joined string", async () => {
    // express's "simple" query parser turns `?entity=a&entity=b` into
    // ["a","b"]. `String(...)` would look up "a,b" and answer 200 with an
    // empty, confident, wrong result.
    const id = await openRefs();
    const twoEntities = await request(app).get(`/api/repos/${id}/refs?entity=Course&entity=Student`);
    expect(twoEntities.status).toBe(400);
    const twoVias = await request(app).get(`/api/repos/${id}/refs?entity=Course&via=entityName&via=dbSetName`);
    expect(twoVias.status).toBe(400);
  });
});

describe("areas and route flow", () => {
  const ROUTES_FIXTURE = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../test/fixtures/mini-aspnet-routes",
  );
  async function openRoutes(): Promise<string> {
    const res = await request(app).post("/api/repos").send({ path: ROUTES_FIXTURE });
    expect(res.status).toBe(201);
    return res.body.repo.id as string;
  }
  const flowQ = (id: string, q: Record<string, string>) =>
    request(app).get(`/api/repos/${id}/flow`).query(q);

  it("serves areasFor verbatim", async () => {
    const id = await openRoutes();
    const res = await request(app).get(`/api/repos/${id}/areas`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["areas", "edges", "entityOwner", "unassigned"]);
    const gadgets = res.body.areas.find((a: { key: string }) => a.key === "gadgets");
    expect(gadgets.routes).toContain("GET /api/Gadgets/{id}");
    const widgets = res.body.areas.find((a: { key: string }) => a.key === "widgets");
    expect(widgets.entities).toEqual(["Widget"]);
    expect(res.body.entityOwner["Widget"]).toBe("widgets");
  });

  it("serves the call chain of a route, with the flow's own fields", async () => {
    const id = await openRoutes();
    const res = await flowQ(id, { method: "GET", path: "/api/Gadgets/{id}" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["flows", "known", "method", "path"]);
    expect(res.body.known).toBe(true);
    expect(res.body.flows).toHaveLength(1);
    const { route, flow } = res.body.flows[0];
    expect(route.file).toMatch(/\.cs$/);
    expect(flow.nodes.map((n: { depth: number }) => n.depth)).toEqual([0, 1, 1, 2, 2, 2, 3]);
    expect(flow.nodes[0]).toMatchObject({ type: "GadgetsController", method: "Get" });
    expect(flow.entities).toEqual(["Gadget"]);
    expect(flow.truncated).toBe(false);
  });

  it("honours ?depth= and reports truncation", async () => {
    const id = await openRoutes();
    const shallow = await flowQ(id, { method: "GET", path: "/api/Gadgets/{id}", depth: "1" });
    expect(shallow.status).toBe(200);
    expect(shallow.body.flows[0].flow.nodes.every((n: { depth: number }) => n.depth <= 1)).toBe(true);
    expect(shallow.body.flows[0].flow.truncated).toBe(true);
  });

  it("answers an unknown route with 200 and known:false, never 404", async () => {
    const id = await openRoutes();
    const res = await flowQ(id, { method: "GET", path: "/nope" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ method: "GET", path: "/nope", known: false, flows: [] });
    // method is matched exactly, not case-folded
    const lower = await flowQ(id, { method: "get", path: "/api/Gadgets/{id}" });
    expect(lower.body.known).toBe(false);
  });

  it("returns flow:null for a known route with no handler", async () => {
    const res = await request(app).post("/api/repos").send({ path: MINI_FULLSTACK });
    expect(res.status).toBe(201);
    const id = res.body.repo.id as string;
    const routes = (await request(app).get(`/api/repos/${id}/graph`)).body.graph.routes;
    const route = routes.find((r: { handler?: unknown }) => r.handler === undefined);
    expect(route).toBeDefined();
    const flow = await flowQ(id, { method: route.method, path: route.path });
    expect(flow.status).toBe(200);
    expect(flow.body.known).toBe(true);
    expect(flow.body.flows[0].flow).toBeNull();
  });

  it("404s for an unopened repo, before validating anything", async () => {
    const a = await request(app).get("/api/repos/deadbeef/areas");
    expect(a.status).toBe(404);
    expect(a.body).toEqual({ error: "That repo is not open." });
    const f = await request(app).get("/api/repos/deadbeef/flow"); // also missing every param
    expect(f.status).toBe(404);
    expect(f.body).toEqual({ error: "That repo is not open." });
  });

  it("400s on missing, blank, repeated or malformed params without coercing", async () => {
    const id = await openRoutes();
    const base = `/api/repos/${id}/flow`;
    for (const url of [
      base,
      `${base}?method=GET`,
      `${base}?path=/x`,
      `${base}?method=&path=/x`,
      `${base}?method=GET&path=%20`,
      `${base}?method=GET&method=POST&path=/x`,
      `${base}?method=GET&path=/x&path=/y`,
      `${base}?method=GET&path=/api/Gadgets/{id}&depth=-1`,
      `${base}?method=GET&path=/api/Gadgets/{id}&depth=1.5`,
      `${base}?method=GET&path=/api/Gadgets/{id}&depth=abc`,
      `${base}?method=GET&path=/api/Gadgets/{id}&depth=21`,
      `${base}?method=GET&path=/api/Gadgets/{id}&depth=1&depth=2`,
    ]) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(400);
    }
  });

  it("inherits the token gate", async () => {
    const gated = createApp(new Workspace(() => "2026-01-01T00:00:00.000Z"), { token: "s3cret" });
    try {
      for (const p of ["areas", "flow"]) {
        const res = await request(gated.app).get(`/api/repos/x/${p}`);
        expect(res.status, p).toBe(401);
      }
    } finally {
      gated.workspace.closeAll();
    }
  });
});

describe("taking a quiz", () => {
  it("never sends the answer to the client", async () => {
    const id = await openMini();
    const quiz = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 5 });
    expect(quiz.status).toBe(201);
    expect(quiz.body.questions).toHaveLength(5);
    for (const q of quiz.body.questions) {
      // The server grades. Shipping the answer would make the whole thing a toy.
      expect(q).not.toHaveProperty("answerIndex");
      expect(q).not.toHaveProperty("answers");
      expect(q).not.toHaveProperty("referenceSql");
      expect(q).not.toHaveProperty("rationale");
      expect(q.prompt.length).toBeGreaterThan(0);
    }
  });

  it("grades an answer and reveals the model answer only afterwards", async () => {
    const id = await openMini();
    const quiz = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 4, seed: 5 });
    const sessionId = quiz.body.session.id as string;
    const first = quiz.body.questions[0];

    const wrong = await request(app)
      .post(`/api/quiz/${sessionId}/answer`)
      .send({ questionId: first.id, answer: "definitely not right" });
    expect(wrong.status).toBe(200);
    expect(wrong.body.result.correct).toBe(false);
    expect(wrong.body.modelAnswer.length).toBeGreaterThan(0);
    expect(wrong.body.rationale.length).toBeGreaterThan(0);
    expect(wrong.body.done).toBe(false);
  });

  it("refuses to grade the same question twice", async () => {
    const id = await openMini();
    const quiz = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 3 });
    const sessionId = quiz.body.session.id as string;
    const q = quiz.body.questions[0];
    await request(app).post(`/api/quiz/${sessionId}/answer`).send({ questionId: q.id, answer: "a" });
    const again = await request(app)
      .post(`/api/quiz/${sessionId}/answer`)
      .send({ questionId: q.id, answer: "b" });
    expect(again.status).toBe(400);
    expect(again.body.error).toContain("already been answered");
  });

  it("refuses a question that is not in this quiz", async () => {
    const id = await openMini();
    const quiz = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 2 });
    const all = workspace.get(id)!.questions;
    const outside = all.find((q) => !quiz.body.questions.some((x: { id: string }) => x.id === q.id))!;
    const res = await request(app)
      .post(`/api/quiz/${quiz.body.session.id}/answer`)
      .send({ questionId: outside.id, answer: "a" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not part of this quiz");
  });

  it("tracks score, progress and weak areas", async () => {
    const id = await openMini();
    const quiz = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 3, seed: 5 });
    const sessionId = quiz.body.session.id as string;
    for (const q of quiz.body.questions) {
      await request(app).post(`/api/quiz/${sessionId}/answer`).send({ questionId: q.id, answer: "zzz" });
    }
    const state = await request(app).get(`/api/quiz/${sessionId}`);
    expect(state.body.session.index).toBe(3);
    expect(state.body.session.correct).toBe(0);
    expect(state.body.weakAreas.length).toBeGreaterThan(0);
    expect(state.body.weakAreas[0].missed).toBeGreaterThan(0);
  });

  it("grades a SQL question by running it", async () => {
    const id = await openMini();
    const repo = workspace.get(id)!;
    const sqlQ = repo.questions.find((q) => q.generator === "sql-range")!;
    const session = workspace.startQuiz(id, repo.questions.length);
    const res = await request(app)
      .post(`/api/quiz/${session.id}/answer`)
      .send({ questionId: sqlQ.id, answer: sqlQ.answers!.join(", ") });
    expect(res.body.result.correct).toBe(true);
    expect(res.body.result.detail).toContain("row(s) match");
  });

  it("refuses a dangerous SQL answer rather than running it", async () => {
    const id = await openMini();
    const repo = workspace.get(id)!;
    const sqlQ = repo.questions.find((q) => q.generator === "sql-group")!;
    const session = workspace.startQuiz(id, repo.questions.length);
    const res = await request(app)
      .post(`/api/quiz/${session.id}/answer`)
      .send({ questionId: sqlQ.id, answer: "ATTACH DATABASE '/tmp/x.db' AS e" });
    expect(res.body.result.correct).toBe(false);
    expect(res.body.result.detail).toContain("refused");
  });

  it("404s an expired session", async () => {
    expect((await request(app).get("/api/quiz/nope")).status).toBe(404);
    const res = await request(app).post("/api/quiz/nope/answer").send({ questionId: "x", answer: "y" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("session has ended");
  });
});

describe("health", () => {
  // Kept as `toEqual`, deliberately. The exact match is the only thing
  // standing between this endpoint and silent shape drift, and this phase
  // just added a field to it. Relaxing to `toMatchObject` here would make the
  // next added field invisible.
  //
  // The Workspace at the top of this file is constructed with no `stateDir`,
  // so persistence is off and the state is "off" rather than "pending" — a
  // "pending" that nothing will ever advance would be the wrong thing to
  // report forever.
  const OFF = { state: "off", loaded: 0, failed: 0, missing: 0 };

  it("reports how many repos are open", async () => {
    expect((await request(app).get("/api/health")).body)
      .toEqual({ ok: true, repos: 0, rehydrate: OFF });
    await openMini();
    expect((await request(app).get("/api/health")).body)
      .toEqual({ ok: true, repos: 1, rehydrate: OFF });
  });
});

describe("a Node repo over the API", () => {
  async function openNode(): Promise<string> {
    const res = await request(app).post("/api/repos").send({ path: MINI_NODE });
    expect(res.status).toBe(201);
    return res.body.repo.id as string;
  }

  it("opens through the same endpoint as a .NET repo", async () => {
    const res = await request(app).post("/api/repos").send({ path: MINI_NODE });
    expect(res.body.repo).toMatchObject({ name: "mini-node", entities: 4, warnings: [] });
  });

  it("serves the shapes and their drift, and the HTTP surface", async () => {
    const id = await openNode();
    const res = await request(app).get(`/api/repos/${id}/shapes`);
    expect(res.status).toBe(200);

    const voyage = res.body.shapes.find((s: { name: string }) => s.name === "Voyage");
    expect(voyage.mirrors).toBe("voyages");
    expect(voyage.drift).toEqual({
      entityOnly: ["departed_at"],
      shapeOnly: ["weather"],
      shared: [
        { column: "id", field: "id" },
        { column: "crew_id", field: "crew_id" },
        { column: "destination", field: "destination" },
        { column: "cargo_tons", field: "cargo_tons" },
      ],
    });

    // An unpaired shape carries no drift rather than an empty one, so the UI
    // cannot render "all fields line up" for a comparison never made.
    const manifest = res.body.shapes.find((s: { name: string }) => s.name === "Manifest");
    expect(manifest.drift).toBeNull();

    expect(res.body.routes).toHaveLength(3);
  });

  it("serves the client-call fields on the graph, present and empty", async () => {
    const id = await openNode();
    const res = await request(app).get(`/api/repos/${id}/graph`);
    expect(res.status).toBe(200);

    // The negative control for the two fields the panel reads. MINI_NODE is a
    // server with no client half, so both come back present and empty — which
    // is only meaningful because the fixture case below proves the same two
    // keys carry real content when the graph has any. Drop the fields from the
    // response and this pair fails on `undefined`, not on a length.
    expect(res.body.graph.clientCalls).toEqual([]);
    expect(res.body.graph.components).toEqual([]);
  });

  it("counts the bank by section", async () => {
    const id = await openNode();
    const res = await request(app).get(`/api/repos/${id}/questions`);
    expect(res.body.bySection.entity).toBeGreaterThan(0);
    expect(res.body.bySection.ds).toBeGreaterThan(0);
  });

  it("gives a quiz only the section it asked for", async () => {
    const id = await openNode();
    const res = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 5, sections: ["ds"] });
    expect(res.status).toBe(201);
    expect(res.body.questions.length).toBeGreaterThan(0);
    expect(res.body.questions.every((q: { section: string }) => q.section === "ds")).toBe(true);
  });

  it("says which section is empty rather than serving the wrong one", async () => {
    const id = await openNode();
    const res = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 5, sections: ["client"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("client");
  });

  it("ignores a section name it does not know", async () => {
    const id = await openNode();
    const res = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 5, sections: ["nope"] });
    // Filtered out at the door, so the request behaves as if none were given.
    expect(res.status).toBe(201);
    expect(res.body.questions.length).toBeGreaterThan(0);
  });

  it("still withholds every answer", async () => {
    const id = await openNode();
    const res = await request(app).post(`/api/repos/${id}/quiz`).send({ n: 5, sections: ["ds"] });
    for (const q of res.body.questions) {
      expect(q).not.toHaveProperty("answers");
      expect(q).not.toHaveProperty("answerIndex");
      expect(q).not.toHaveProperty("rationale");
    }
  });
});

describe("the client-call chain over the API", () => {
  async function openFullstackReact(): Promise<string> {
    const res = await request(app).post("/api/repos").send({ path: MINI_FULLSTACK_REACT });
    expect(res.status).toBe(201);
    return res.body.repo.id as string;
  }

  it("serves calls and components on the graph, unjoined", async () => {
    const id = await openFullstackReact();
    const res = await request(app).get(`/api/repos/${id}/graph`);
    expect(res.status).toBe(200);

    // The conjunction the panel exists to render: a call attributed to a
    // component AND matched to a route. No other fixture yields one, which is
    // why this one was cut.
    const both = res.body.graph.clientCalls.filter(
      (c: { matches: string | null; components: string[] }) =>
        c.matches !== null && c.components.length > 0,
    );
    expect(both.length).toBeGreaterThanOrEqual(1);
    expect(both[0]).toMatchObject({
      method: "POST",
      path: "/api/admin/cards",
      file: "src/components/admin/Card.tsx",
      matches: "POST /api/admin/cards",
      components: ["src/components/admin/Card.tsx#Card"],
    });

    // Every attributed key resolves against the components served in the same
    // body: the response is self-contained, so the client never has to guess
    // what a key refers to.
    const keys = new Set(res.body.graph.components.map((c: { key: string }) => c.key));
    for (const call of res.body.graph.clientCalls) {
      for (const key of call.components) expect(keys).toContain(key);
    }

    // Four components in two same-named PAIRS (Card, Panel); only the key
    // separates the members of a pair, which is what the display-label rules
    // downstream — the panel's and the quiz's — are for.
    //
    // Pinned as the sorted name list, not as length-4-and-2-distinct: that
    // weaker pair is also satisfied by three Cards and one Panel, which would
    // leave a uniquely-named component and quietly falsify the comment above.
    expect(res.body.graph.components).toHaveLength(4);
    expect(res.body.graph.components.map((c: { name: string }) => c.name).sort())
      .toEqual(["Card", "Card", "Panel", "Panel"]);

    // Nothing is joined server-side: the calls arrive as a flat list on the
    // graph, not nested under their components.
    expect(Array.isArray(res.body.graph.clientCalls)).toBe(true);
    expect(res.body.graph.clientCalls.some((c: { components: string[] }) => c.components.length === 0))
      .toBe(true);
  });

  it("keeps the client fields off /shapes, so the panel has one source", async () => {
    const id = await openFullstackReact();
    const res = await request(app).get(`/api/repos/${id}/shapes`);
    expect(res.status).toBe(200);

    // Positive control first: the endpoint answers with real content, so the
    // two negatives below cannot pass by finding an empty body. `routes`
    // rather than `shapes` because this fixture declares no shapes.
    expect(Array.isArray(res.body.routes)).toBe(true);
    expect(res.body.routes.length).toBeGreaterThan(0);

    // D-D-12: D1 projected these onto /shapes and D2 reverted it, but until
    // now nothing said so. A future re-projection would pass every other gate
    // in the suite, then leave the Dashboard reading one field from two
    // endpoints that can disagree.
    expect(res.body).not.toHaveProperty("clientCalls");
    expect(res.body).not.toHaveProperty("components");
  });
});

describe("B17: persistence is off unless a state directory is handed in", () => {
  // `pnpm test` constructs Workspaces exactly like this one, and the corpus
  // paths those tests open are private. If `stateDir === undefined` fell back
  // to the default, every test run would deposit live store entries that the
  // production LaunchAgent would then rehydrate (D-Gb-7).
  //
  // XDG_DATA_HOME is redirected into a temp directory rather than asserting on
  // the real `~/.local/share/psq`: that directory does not exist on this
  // machine today, so an assertion about it is failable now and stops being
  // failable the first time the real server runs.
  it("writes nothing anywhere, and the assertion is not vacuous", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "psq-xdg-"));
    const before = process.env["XDG_DATA_HOME"];
    process.env["XDG_DATA_HOME"] = tmp;
    const plain = new Workspace(() => "2026-01-01T00:00:00.000Z");
    const wired = new Workspace(() => "2026-01-01T00:00:00.000Z", {
      stateDir: join(tmp, "psq"),
    });
    try {
      const { app: plainApp } = createApp(plain);
      expect((await request(plainApp).post("/api/repos").send({ path: MINI_EFCORE })).status)
        .toBe(201);
      expect(existsSync(join(tmp, "psq"))).toBe(false);

      // The positive control: the same open, through a Workspace that WAS
      // given the directory, does create it. Without this the assertion above
      // would pass on a store that never writes under any configuration.
      const { app: wiredApp } = createApp(wired);
      expect((await request(wiredApp).post("/api/repos").send({ path: MINI_EFCORE })).status)
        .toBe(201);
      expect(existsSync(join(tmp, "psq", "repos"))).toBe(true);
    } finally {
      plain.closeAll();
      wired.closeAll();
      if (before === undefined) delete process.env["XDG_DATA_HOME"];
      else process.env["XDG_DATA_HOME"] = before;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
