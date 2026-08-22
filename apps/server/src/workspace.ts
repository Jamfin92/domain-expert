import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { extract } from "@psq/extract";
import { invariants, layout, layout3d, mermaid, type Layout, type Layout3D } from "@psq/graph";
import {
  buildBank,
  materialize, selectQuiz, grade, referenceAnswer, selftest,
  type SeededDb,
} from "@psq/quiz";
import type { EntityGraph, GradeResult, Question, Section } from "@psq/schema";

/**
 * Holds every repo psq has opened, and the quiz sessions running against them.
 *
 * State lives in memory. psq is single-user and local today, and everything
 * here is derived from the repo plus a seed, so a restart costs a re-extract
 * and nothing else. When this is hosted, this class is the seam where per-user
 * scoping goes.
 */

export interface OpenRepo {
  id: string;
  path: string;
  graph: EntityGraph;
  questions: Question[];
  seeded: SeededDb;
  seed: number;
  openedAt: string;
}

export interface QuizSession {
  id: string;
  repoId: string;
  questionIds: string[];
  index: number;
  results: GradeResult[];
  startedAt: string;
}

export interface RepoSummary {
  id: string;
  path: string;
  name: string;
  contextName: string | null;
  entities: number;
  relations: number;
  questions: number;
  warnings: string[];
  seededRows: number;
  openedAt: string;
}

const shortId = (s: string): string =>
  createHash("sha256").update(s).digest("hex").slice(0, 12);

export class Workspace {
  private readonly repos = new Map<string, OpenRepo>();
  private readonly sessions = new Map<string, QuizSession>();
  private sessionCounter = 0;

  /** Timestamps are injected so a test can assert on stable output. */
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  list(): RepoSummary[] {
    return [...this.repos.values()]
      .map((r) => this.summarize(r))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): OpenRepo | undefined {
    return this.repos.get(id);
  }

  summarize(r: OpenRepo): RepoSummary {
    return {
      id: r.id,
      path: r.path,
      name: r.path.split("/").filter(Boolean).slice(-1)[0] ?? r.path,
      contextName: r.graph.contextName,
      entities: r.graph.entities.length,
      relations: r.graph.relations.length,
      questions: r.questions.length,
      warnings: r.graph.warnings,
      seededRows: [...r.seeded.rowCounts.values()].reduce((a, b) => a + b, 0),
      openedAt: r.openedAt,
    };
  }

  /**
   * Extract a repo and build its question bank.
   * Throws with a human-readable reason rather than a stack trace, because
   * every one of these lands directly in the UI.
   */
  open(rawPath: string, opts: { seed?: number; rows?: number } = {}): OpenRepo {
    const path = resolve(rawPath);
    if (!existsSync(path)) throw new Error(`No such directory: ${path}`);
    if (!statSync(path).isDirectory()) throw new Error(`Not a directory: ${path}`);

    const id = shortId(path);
    const existing = this.repos.get(id);
    if (existing) {
      existing.seeded.close();
      this.repos.delete(id);
    }

    const graph = extract(path);
    const problems = invariants(graph);
    if (problems.length > 0) {
      throw new Error(
        `The extracted graph failed its invariants, so no questions can be trusted:\n` +
          problems.map((p) => `  - ${p}`).join("\n"),
      );
    }
    if (graph.entities.length === 0) {
      const reason =
        graph.provider === "efcore"
          ? "This looks like a .NET project, but nothing here is reachable from a DbSet."
          : graph.provider === "sqlite-ddl"
            ? "This looks like a Node project, but no CREATE TABLE statement was found. " +
              "psq reads a schema from raw DDL; an ORM-defined schema is not read yet."
            : "psq did not recognize this as a project it can read.";
      throw new Error(
        `No entities found. ${reason} psq reads .NET projects with an EF Core DbContext ` +
          "and Node backends with a SQLite schema; React clients arrive in a later milestone.",
      );
    }

    const seed = opts.seed ?? 1337;
    const seeded = materialize(graph, { seed, rows: opts.rows ?? 40 });
    const questions = buildBank(graph, seeded, seed);

    const repo: OpenRepo = {
      id, path, graph, questions, seeded, seed, openedAt: this.now(),
    };
    this.repos.set(id, repo);
    return repo;
  }

  close(id: string): boolean {
    const r = this.repos.get(id);
    if (!r) return false;
    r.seeded.close();
    this.repos.delete(id);
    for (const [sid, s] of this.sessions) if (s.repoId === id) this.sessions.delete(sid);
    return true;
  }

  layoutOf(id: string): Layout | undefined {
    const r = this.repos.get(id);
    return r ? layout(r.graph, r.seeded.rowCounts) : undefined;
  }

  layout3dOf(id: string): Layout3D | undefined {
    const r = this.repos.get(id);
    return r ? layout3d(r.graph, r.seeded.rowCounts) : undefined;
  }

  mermaidOf(id: string): string | undefined {
    const r = this.repos.get(id);
    return r ? mermaid(r.graph) : undefined;
  }

  /** Validate a repo's bank. Never trust questions this has not passed. */
  selftestOf(id: string): ReturnType<typeof selftest> | undefined {
    const r = this.repos.get(id);
    return r ? selftest(r.questions, { db: r.seeded.db }) : undefined;
  }

  startQuiz(repoId: string, n: number, seed?: number, sections?: readonly Section[]): QuizSession {
    const r = this.repos.get(repoId);
    if (!r) throw new Error("That repo is not open");

    // Filter before selecting, not inside it: selectQuiz round-robins by
    // generator, so a section asked for by name would otherwise have to win a
    // lottery against every other section in the bank.
    const wanted = sections && sections.length > 0 ? new Set(sections) : null;
    const pool = wanted ? r.questions.filter((q) => wanted.has(q.section)) : r.questions;
    if (pool.length === 0) {
      throw new Error(
        `This repo has no questions in ${[...(wanted ?? [])].join(", ")}. Pick another section.`,
      );
    }

    const picked = selectQuiz(pool, n, seed ?? r.seed);
    if (picked.length === 0) throw new Error("No questions could be generated for this repo");

    this.sessionCounter += 1;
    const session: QuizSession = {
      id: `${repoId}-${this.sessionCounter}`,
      repoId,
      questionIds: picked.map((q) => q.id),
      index: 0,
      results: [],
      startedAt: this.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  session(id: string): QuizSession | undefined {
    return this.sessions.get(id);
  }

  questionsOf(session: QuizSession): Question[] {
    const repo = this.repos.get(session.repoId);
    if (!repo) return [];
    const byId = new Map(repo.questions.map((q) => [q.id, q]));
    return session.questionIds.map((qid) => byId.get(qid)).filter((q): q is Question => !!q);
  }

  /**
   * Grade one answer and advance. Returns the result plus the model answer,
   * because the UI shows what the answer was as soon as you get it wrong.
   */
  answer(sessionId: string, questionId: string, given: string): {
    result: GradeResult;
    modelAnswer: string;
    rationale: string;
    done: boolean;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("That quiz session has ended");
    const repo = this.repos.get(session.repoId);
    if (!repo) throw new Error("That repo is no longer open");

    const q = repo.questions.find((x) => x.id === questionId);
    if (!q) throw new Error("That question is not part of this repo");
    if (!session.questionIds.includes(questionId)) {
      throw new Error("That question is not part of this quiz");
    }
    if (session.results.some((r) => r.questionId === questionId)) {
      throw new Error("That question has already been answered");
    }

    const result = grade(q, given, { db: repo.seeded.db });
    session.results.push(result);
    session.index = session.results.length;

    const modelAnswer =
      q.gradeMode === "exec" && !q.sqlTemplate ? (q.referenceSql ?? "") : referenceAnswer(q);

    return {
      result,
      modelAnswer,
      rationale: q.rationale,
      done: session.results.length >= session.questionIds.length,
    };
  }

  /** Per-subject miss counts, for the weak-areas tile. */
  weakAreas(sessionId: string): Array<{ subject: string; missed: number }> {
    const session = this.sessions.get(sessionId);
    const repo = session ? this.repos.get(session.repoId) : undefined;
    if (!session || !repo) return [];
    const byId = new Map(repo.questions.map((q) => [q.id, q]));
    const counts = new Map<string, number>();
    for (const r of session.results) {
      if (r.correct) continue;
      for (const s of byId.get(r.questionId)?.subjects ?? []) {
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([subject, missed]) => ({ subject, missed }))
      .sort((a, b) => b.missed - a.missed || a.subject.localeCompare(b.subject));
  }

  closeAll(): void {
    for (const id of [...this.repos.keys()]) this.close(id);
  }
}
