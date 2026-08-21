import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { Workspace } from "../src/workspace.js";
import { MINI_EFCORE } from "../../../test/fixtures.js";

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

  it("says so plainly when a repo has no EF Core model", async () => {
    const res = await request(app).post("/api/repos").send({ path: "~/Developer/psq-app/packages" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No entities found");
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

  it("404s for a repo that is not open", async () => {
    for (const path of ["graph", "layout", "mermaid", "questions", "selftest"]) {
      expect((await request(app).get(`/api/repos/deadbeef/${path}`)).status).toBe(404);
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
  it("reports how many repos are open", async () => {
    expect((await request(app).get("/api/health")).body).toEqual({ ok: true, repos: 0 });
    await openMini();
    expect((await request(app).get("/api/health")).body).toEqual({ ok: true, repos: 1 });
  });
});
