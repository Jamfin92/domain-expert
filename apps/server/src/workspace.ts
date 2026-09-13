import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { EXTRACTOR_VERSION, digestOf, extractWithDigest } from "@psq/extract";
import { invariants, layout, layout3d, mermaid, type Layout, type Layout3D } from "@psq/graph";
import {
  buildBank,
  materialize, selectQuiz, grade, referenceAnswer, selftest,
  DEFAULT_SEED,
  type SeededDb,
} from "@psq/quiz";
import type { EntityGraph, GradeResult, Question, Section } from "@psq/schema";
import {
  STORE_VERSION,
  deleteEnvelope,
  listEnvelopeIds,
  readEnvelope,
  writeEnvelope,
} from "./store.js";

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
  /**
   * Resolved once, here, rather than re-defaulted at every use. The seeded
   * database is a function of (graph, seed, rows), so a `rows` that is not
   * stored is a `rows` the two shells can silently disagree about — Phase F
   * spent itself on exactly that failure with `seed`.
   */
  rows: number;
  openedAt: string;
}

/**
 * `"off"` is a fourth state D-Gb-8 did not name, and it earns its place at the
 * health endpoint: it separates *persistence is off* from *persistence is on
 * and rehydrate finished with an empty store*. For a LaunchAgent observable
 * only over HTTP that is a real operational distinction, and `repos: 0` alone
 * cannot make it.
 *
 * It is NOT a control for anything. Under the mutant worth fearing — a
 * `loadStateDir()` that returns `undefined` unconditionally — `stateDir` is
 * undefined, so the state is `"off"` and any test asserting `"off"` passes
 * green. That mutant is killed by B25's stderr assertion, not from here.
 */
export type RehydrateState = "off" | "pending" | "running" | "done";

export interface RehydrateStatus {
  state: RehydrateState;
  loaded: number;
  failed: number;
  missing: number;
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

/**
 * The row count `materialize` seeds per table when this server names none.
 *
 * Hoisted out of the single inline literal only so `open()` has a name to
 * resolve `rows` from before storing it. It does NOT de-duplicate the default:
 * `40` still appears in `packages/quiz/src/sql/seed.ts:233`,
 * `apps/cli/src/index.ts:95` and that file's help text at `:212`. What
 * actually keeps the two shells from disagreeing is that `open()` resolves
 * `rows` once and STORES the resolved value, so a rehydrated repo is seeded
 * with the number it was opened with rather than whatever the default has
 * since become (D-Gb-3). B5a is the gate on that.
 */
const DEFAULT_ROWS = 40;

const shortId = (s: string): string =>
  createHash("sha256").update(s).digest("hex").slice(0, 12);

export class Workspace {
  private readonly repos = new Map<string, OpenRepo>();
  private readonly sessions = new Map<string, QuizSession>();
  private sessionCounter = 0;

  private readonly stateDir: string | undefined;
  private readonly log: (line: unknown) => void;

  private readonly status: RehydrateStatus;
  /** Set by `closeAll()` so a rehydrate still yielding stops at its next yield. */
  private stopping = false;

  /**
   * Timestamps are injected so a test can assert on stable output; `now` stays
   * positional and first so every existing caller keeps compiling.
   *
   * `stateDir === undefined` means persistence is OFF — not "fall back to the
   * default". Only `index.ts` supplies the real directory. If undefined fell
   * back, `pnpm test` would write live store entries for test fixtures and the
   * production LaunchAgent would rehydrate them (D-Gb-7).
   *
   * `log` takes `unknown` rather than `string` so the rehydrate call site can
   * be `void rehydrate().catch(log)` without laundering an `Error` through
   * `.catch`'s `any` into a string-typed collector.
   */
  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    opts: { stateDir?: string; log?: (line: unknown) => void } = {},
  ) {
    this.stateDir = opts.stateDir;
    this.log = opts.log ?? ((line) => console.error(line));
    // Initialised HERE and not inside `rehydrate()`. `rehydrate()` is called
    // from `index.ts` only, so a status initialised to "pending"
    // unconditionally would leave the desktop shell and `e2e/harness.ts`
    // reporting `rehydrate: pending` forever — a worse shape than the one the
    // fourth state exists to improve.
    this.status = {
      state: this.stateDir === undefined ? "off" : "pending",
      loaded: 0,
      failed: 0,
      missing: 0,
    };
  }

  /**
   * A COPY. A live reference would let the health route's caller mutate the
   * counters through a field nobody expects to be writable.
   */
  rehydrateStatus(): RehydrateStatus {
    return { ...this.status };
  }

  /**
   * Rebuild the in-memory Map from the store, one entry per envelope.
   *
   * Called from `index.ts` only — never from `createApp()` — so the desktop
   * shell and every test that does not ask for it never read the store
   * (D-Gb-7).
   *
   * The step ordering below is the contract, not a style. Two steps in
   * particular:
   *
   * - The directory check runs STRICTLY BEFORE any `digestOf`. `digestOf` on a
   *   vanished root returns the empty-input sha256 rather than throwing (its
   *   `walk` swallows the `readdirSync` failure and yields `[]`), so comparing
   *   first would read a deleted repo as "a repo that changed" and fire a
   *   doomed re-extract. B24 is the control, and it counts the `digestOf`
   *   calls rather than trusting the outcome.
   * - `invariants` is checked by LENGTH, never wrapped in a try/catch. It
   *   returns `string[]` and cannot throw on a graph that has already parsed,
   *   because `keys`/`properties`/`indexes` are required `z.array` in the
   *   schema, so no loop inside it can reach `undefined`. A try/catch there
   *   would be a gate that passes by finding nothing.
   */
  async rehydrate(): Promise<void> {
    const stateDir = this.stateDir;
    if (stateDir === undefined) return; // stays "off"; do not touch disk

    // Synchronously, before the first await: this is what makes B16 an
    // assertion on the next line rather than a poll against a race.
    this.status.state = "running";
    this.stopping = false;

    try {
      for (const id of listEnvelopeIds(stateDir)) {
        // Yield FIRST, then check: the flag can only have been set from
        // outside, which requires us to have given the loop back.
        await new Promise((r) => setImmediate(r));
        if (this.stopping) break;
        this.rehydrateOne(stateDir, id);
      }
    } finally {
      this.status.state = "done";
    }
  }

  /**
   * One entry. Never throws: a single bad envelope must not stop the rest.
   * Split out of the loop so the try/catch wraps every branch of it and
   * cannot be narrowed later by accident (F11).
   */
  private rehydrateOne(stateDir: string, id: string): void {
    let opened: SeededDb | undefined;
    try {
      const read = readEnvelope(stateDir, id);
      if (!read.ok) {
        // The file is KEPT. Three of these cases are unrepairable from here —
        // `readEnvelope` validates the whole envelope and discards the payload,
        // so `path` is gone and there is nothing to re-extract. They are
        // repaired by the user re-opening the repo, or removed with DELETE.
        this.status.failed += 1;
        this.log(`psq rehydrate: ${id} failed — ${read.reason}`);
        return;
      }
      const env = read.envelope;

      // The filename id, the envelope's own id, and the id the path hashes to
      // must all agree. Without this a hand-edited envelope yields a Map entry
      // whose `repo.id` differs from its key, so `DELETE /api/repos/<reported
      // id>` cannot remove it — and the re-extract branch below, which calls
      // `open()` and therefore keys by `shortId(resolve(path))`, would write
      // its result under a different key than the one it was asked for.
      if (env.id !== id || shortId(resolve(env.path)) !== id) {
        this.status.failed += 1;
        this.log(`psq rehydrate: ${id} failed — id does not match its path or its filename`);
        return;
      }

      let reExtract = env.extractor !== EXTRACTOR_VERSION || invariants(env.graph).length > 0;

      // Before any digest. See the ordering note on `rehydrate`.
      if (!existsSync(env.path) || !statSync(env.path).isDirectory()) {
        this.status.missing += 1;
        this.log(`psq rehydrate: ${id} missing — ${env.path} is no longer a directory`);
        return;
      }

      // A POST beat us to it. Not counted either way: nothing was rehydrated,
      // and nothing failed.
      if (this.repos.has(id)) return;

      if (!reExtract && digestOf(env.path) !== env.fingerprint) reExtract = true;

      if (reExtract) {
        // `open()` re-extracts, rebuilds, inserts and rewrites the envelope.
        this.open(env.path, { seed: env.seed, rows: env.rows });
        this.status.loaded += 1;
        return;
      }

      // The same refusal `open()` makes: a graph with no entities must not be
      // materialized into a repo that can ask nothing.
      if (env.graph.entities.length === 0) {
        this.status.failed += 1;
        this.log(`psq rehydrate: ${id} failed — the stored graph has no entities`);
        return;
      }

      const seeded = materialize(env.graph, { seed: env.seed, rows: env.rows });
      opened = seeded;
      const questions = buildBank(env.graph, seeded, env.seed);
      this.repos.set(id, {
        id,
        path: env.path,
        graph: env.graph,
        questions,
        seeded,
        seed: env.seed,
        rows: env.rows,
        // The STORED timestamp. A repo the user opened on Tuesday did not
        // become a repo they opened at this boot.
        openedAt: env.openedAt,
      });
      opened = undefined; // handed off; the Map owns it now
      this.status.loaded += 1;
      // Deliberately no re-persist: nothing changed.
    } catch (err) {
      // `materialize` succeeding and `buildBank` then throwing leaks a handle
      // that nothing else will ever close.
      if (opened) {
        try {
          opened.close();
        } catch {
          // Already closed, or never usable. Nothing to do.
        }
      }
      // The TOCTOU window between the directory check and the work: a repo
      // deleted in between is missing, not broken.
      const read = readEnvelope(stateDir, id);
      const gone =
        read.ok && (!existsSync(read.envelope.path) || !statSync(read.envelope.path).isDirectory());
      if (gone) this.status.missing += 1;
      else this.status.failed += 1;
      this.log(
        `psq rehydrate: ${id} ${gone ? "missing" : "failed"} — ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

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

    const { graph, digest } = extractWithDigest(path);
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
            : graph.provider === "fullstack"
              ? // psq read both halves of this repo. Saying it "did not recognize" the
                // project would be a plain lie, and would send the reader looking for a
                // detection bug instead of at the DbContext.
                "This repo has both a .NET and a TypeScript side, and psq read both, but " +
                "nothing on the .NET side is reachable from a DbSet and the TypeScript " +
                "side declares no CREATE TABLE."
              : "psq did not recognize this as a project it can read.";
      throw new Error(
        `No entities found. ${reason} psq reads .NET projects with an EF Core DbContext, ` +
          "Node backends with a SQLite schema, and React clients — a repo with both is read " +
          "as both.",
      );
    }

    const seed = opts.seed ?? DEFAULT_SEED;
    const rows = opts.rows ?? DEFAULT_ROWS;
    const seeded = materialize(graph, { seed, rows });
    const questions = buildBank(graph, seeded, seed);

    const repo: OpenRepo = {
      id, path, graph, questions, seeded, seed, rows, openedAt: this.now(),
    };
    this.repos.set(id, repo);
    this.persist(repo, digest);
    return repo;
  }

  /**
   * Save a repo's envelope. Never throws: a store failure must not turn a
   * successful open into a failed request (D-Gb-6).
   */
  private persist(repo: OpenRepo, fingerprint: string): void {
    if (this.stateDir === undefined) return;
    try {
      writeEnvelope(this.stateDir, {
        version: STORE_VERSION,
        extractor: EXTRACTOR_VERSION,
        id: repo.id,
        path: repo.path,
        seed: repo.seed,
        rows: repo.rows,
        openedAt: repo.openedAt,
        fingerprint,
        graph: repo.graph,
      });
    } catch (err) {
      this.log(
        `psq store: could not save ${repo.id} (${repo.path}): ` +
          (err instanceof Error ? err.message : String(err)),
      );
      // On a RE-open, the envelope already on disk is the SUPERSEDED one — old
      // seed, old rows, old fingerprint. Leaving it there means the next
      // rehydrate resurrects a configuration the user has already replaced.
      // Current or absent; never stale.
      //
      // Deleting here rather than before re-extraction is deliberate: a
      // delete-first would destroy a working cache entry on any re-open whose
      // extraction then fails, and `open()` has already dropped the in-memory
      // repo by that point, so the user would lose both copies.
      //
      // This does NOT cover a directory-permission failure. At 0500 the
      // staging write and this unlink both fail EACCES, and no permission
      // state separates them, so the superseded envelope survives. The
      // invariant holds for a write that fails for a reason not also blocking
      // unlink — ENOSPC, a read-only file. B29 gates that case.
      try {
        deleteEnvelope(this.stateDir, repo.id);
      } catch (delErr) {
        this.log(
          `psq store: could not drop the superseded envelope for ${repo.id}: ` +
            (delErr instanceof Error ? delErr.message : String(delErr)),
        );
      }
    }
  }

  /**
   * Drop a repo's envelope from the store. Deliberately NOT wired into
   * `close()`: `closeAll()` runs on SIGTERM, so a `close()` that forgot would
   * make a clean shutdown delete exactly the state this store preserves
   * (D-Gb-5).
   */
  forget(id: string): boolean {
    if (this.stateDir === undefined) return false;
    try {
      return deleteEnvelope(this.stateDir, id);
    } catch (err) {
      this.log(
        `psq store: could not forget ${id}: ` + (err instanceof Error ? err.message : String(err)),
      );
      return false;
    }
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
    // `index.ts` runs this on SIGTERM. A rehydrate still yielding would keep
    // materializing repos into a Map that has just been cleared, leaking
    // `SeededDb` handles past shutdown.
    this.stopping = true;
    for (const id of [...this.repos.keys()]) this.close(id);
  }
}
