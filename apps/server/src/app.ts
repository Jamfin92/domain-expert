import express, { type Express, type Request, type Response } from "express";
import { Workspace } from "./workspace.js";

/**
 * The JSON API. Both shells talk to this and nothing else:
 * the browser over HTTP, and Electron over the same HTTP on a local port.
 *
 * Keeping one seam means the desktop app and a hosted deployment cannot drift
 * apart, and it is the reason Electron costs ~100 lines rather than a second
 * application.
 */

/** Questions are sent without their answers. The server grades, never the client. */
function publicQuestion(q: {
  id: string; section: string; kind: string; gradeMode: string;
  generator: string; prompt: string; choices?: string[]; subjects: string[];
  sqlTemplate?: string;
}): Record<string, unknown> {
  return {
    id: q.id,
    section: q.section,
    kind: q.kind,
    gradeMode: q.gradeMode,
    generator: q.generator,
    prompt: q.prompt,
    choices: q.choices,
    subjects: q.subjects,
    // Free-form SQL questions need a bigger input box; the UI keys off this.
    templated: q.gradeMode === "exec" ? Boolean(q.sqlTemplate) : undefined,
  };
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

/** Wrap a handler so a thrown Error becomes a clean 400 rather than a stack. */
function handler(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try {
      fn(req, res);
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : String(err));
    }
  };
}

export function createApp(workspace: Workspace = new Workspace()): {
  app: Express;
  workspace: Workspace;
} {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, repos: workspace.list().length });
  });

  app.get("/api/repos", (_req, res) => {
    res.json({ repos: workspace.list() });
  });

  app.post("/api/repos", handler((req, res) => {
    const body = req.body as { path?: unknown; seed?: unknown; rows?: unknown };
    if (typeof body.path !== "string" || body.path.trim() === "") {
      fail(res, 400, "Give the path to a repo to open.");
      return;
    }
    const repo = workspace.open(body.path.trim(), {
      seed: typeof body.seed === "number" ? body.seed : undefined,
      rows: typeof body.rows === "number" ? body.rows : undefined,
    });
    res.status(201).json({ repo: workspace.summarize(repo) });
  }));

  app.delete("/api/repos/:id", handler((req, res) => {
    const ok = workspace.close(String(req.params["id"]));
    if (!ok) {
      fail(res, 404, "That repo is not open.");
      return;
    }
    res.json({ closed: true });
  }));

  app.get("/api/repos/:id/graph", handler((req, res) => {
    const repo = workspace.get(String(req.params["id"]));
    if (!repo) {
      fail(res, 404, "That repo is not open.");
      return;
    }
    res.json({ graph: repo.graph });
  }));

  app.get("/api/repos/:id/layout", handler((req, res) => {
    const l = workspace.layoutOf(String(req.params["id"]));
    if (!l) {
      fail(res, 404, "That repo is not open.");
      return;
    }
    res.json({ layout: l });
  }));

  app.get("/api/repos/:id/mermaid", handler((req, res) => {
    const m = workspace.mermaidOf(String(req.params["id"]));
    if (m === undefined) {
      fail(res, 404, "That repo is not open.");
      return;
    }
    res.type("text/plain").send(m);
  }));

  app.get("/api/repos/:id/questions", handler((req, res) => {
    const repo = workspace.get(String(req.params["id"]));
    if (!repo) {
      fail(res, 404, "That repo is not open.");
      return;
    }
    const byGenerator = new Map<string, number>();
    const byKind = new Map<string, number>();
    for (const q of repo.questions) {
      byGenerator.set(q.generator, (byGenerator.get(q.generator) ?? 0) + 1);
      byKind.set(q.kind, (byKind.get(q.kind) ?? 0) + 1);
    }
    res.json({
      total: repo.questions.length,
      byGenerator: Object.fromEntries([...byGenerator].sort((a, b) => b[1] - a[1])),
      byKind: Object.fromEntries(byKind),
      subjects: [...new Set(repo.questions.flatMap((q) => q.subjects))].sort(),
    });
  }));

  app.get("/api/repos/:id/selftest", handler((req, res) => {
    const findings = workspace.selftestOf(String(req.params["id"]));
    if (!findings) {
      fail(res, 404, "That repo is not open.");
      return;
    }
    res.json({ ok: findings.length === 0, findings });
  }));

  app.post("/api/repos/:id/quiz", handler((req, res) => {
    const body = req.body as { n?: unknown; seed?: unknown };
    const n = typeof body.n === "number" && body.n > 0 ? Math.min(body.n, 100) : 10;
    const session = workspace.startQuiz(
      String(req.params["id"]),
      n,
      typeof body.seed === "number" ? body.seed : undefined,
    );
    res.status(201).json({
      session: {
        id: session.id,
        repoId: session.repoId,
        total: session.questionIds.length,
        index: 0,
      },
      questions: workspace.questionsOf(session).map(publicQuestion),
    });
  }));

  app.get("/api/quiz/:id", handler((req, res) => {
    const session = workspace.session(String(req.params["id"]));
    if (!session) {
      fail(res, 404, "That quiz session has ended.");
      return;
    }
    const correct = session.results.filter((r) => r.correct).length;
    res.json({
      session: {
        id: session.id,
        repoId: session.repoId,
        total: session.questionIds.length,
        index: session.index,
        correct,
        results: session.results,
      },
      questions: workspace.questionsOf(session).map(publicQuestion),
      weakAreas: workspace.weakAreas(session.id),
    });
  }));

  app.post("/api/quiz/:id/answer", handler((req, res) => {
    const body = req.body as { questionId?: unknown; answer?: unknown };
    if (typeof body.questionId !== "string") {
      fail(res, 400, "Say which question this answers.");
      return;
    }
    const outcome = workspace.answer(
      String(req.params["id"]),
      body.questionId,
      typeof body.answer === "string" ? body.answer : "",
    );
    res.json(outcome);
  }));

  return { app, workspace };
}
