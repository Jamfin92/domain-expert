import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MINI_EFCORE } from "../../../test/fixtures.js";

/**
 * The only tests in this repo that run the real entry point.
 *
 * `index.ts` is not imported by anything in the suite, so until this file
 * existed `loadStateDir()` was never executed by a test at all — a
 * `loadStateDir` returning `undefined` unconditionally would have been
 * invisible to every one of the 387 tests that preceded it. Everything else
 * under `apps/server/test/` drives `createApp()` in-process through supertest,
 * which by design never reaches this wiring.
 *
 * The idiom, since this file invents it:
 *
 * - `process.execPath` and not a shell. `node` and `pnpm` are not on the
 *   default PATH on the development machine, so shelling out is a coin flip.
 * - `cwd` is `apps/server/`, so `--import tsx` resolves.
 * - The TEST picks the port. `PSQ_PORT=0` is refused by `config.ts` and that
 *   refusal is deliberately pinned by `config.test.ts`, so "take any free
 *   port" is not available here. Binding a probe to 0 and reading its port
 *   back leaves a small inherent race between the probe closing and the child
 *   binding; there is no way to close it without a port the config accepts.
 * - Readiness is the listening line AND an answered `/api/health`. The line
 *   alone races the route table, and each rehydrate entry is fully synchronous
 *   — `extract`, `materialize` and `buildBank` never yield — so the server is
 *   unresponsive for the whole of each entry.
 */

const INDEX = resolve(import.meta.dirname, "../src/index.ts");
const SERVER_DIR = resolve(import.meta.dirname, "..");

interface Child {
  proc: ChildProcess;
  port: number;
  out: string[];
  err: string[];
}

const running: Child[] = [];
const made: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "psq-boot-"));
  made.push(dir);
  return dir;
}

/** A port nothing is listening on, right now. */
async function freePort(): Promise<number> {
  return await new Promise((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      probe.close(() => (port === 0 ? fail(new Error("no port")) : done(port)));
    });
  });
}

async function get(port: number, path: string): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return await res.json();
}

/**
 * Boot the real entry point and wait until it answers.
 *
 * `env` REPLACES the child's environment rather than extending it, so B25 can
 * take `HOME` and `XDG_DATA_HOME` away. `PATH` is carried over because tsx
 * needs it; nothing else from this process is.
 */
async function boot(env: Record<string, string>, opts: { port?: number } = {}): Promise<Child> {
  const port = opts.port ?? (await freePort());
  const proc = spawn(process.execPath, ["--import", "tsx", INDEX], {
    cwd: SERVER_DIR,
    env: { PATH: process.env["PATH"] ?? "", PSQ_HOST: "127.0.0.1", PSQ_PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const child: Child = { proc, port, out: [], err: [] };
  running.push(child);
  proc.stdout?.on("data", (b: Buffer) => child.out.push(b.toString()));
  proc.stderr?.on("data", (b: Buffer) => child.err.push(b.toString()));

  const deadline = Date.now() + 45_000;
  let exited: number | null = null;
  proc.on("exit", (code) => (exited = code));

  // 1. the listening line
  while (!child.out.join("").includes("psq server listening")) {
    if (exited !== null) {
      throw new Error(
        `child exited ${exited} before listening\nstdout: ${child.out.join("")}\nstderr: ${child.err.join("")}`,
      );
    }
    if (Date.now() > deadline) throw new Error(`no listening line\nstderr: ${child.err.join("")}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  // 2. an answered request. Rehydrate is synchronous per entry, so this can
  //    legitimately take as long as a full re-extract of every stored repo.
  for (;;) {
    try {
      await get(port, "/api/health");
      return child;
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`health never answered: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

/** SIGTERM and wait for the process to actually be gone. */
async function stop(child: Child): Promise<void> {
  if (child.proc.exitCode !== null || child.proc.signalCode !== null) return;
  await new Promise<void>((done) => {
    child.proc.once("exit", () => done());
    child.proc.kill("SIGTERM");
    setTimeout(() => {
      child.proc.kill("SIGKILL");
      done();
    }, 8_000).unref();
  });
}

async function post(port: number, path: string, body: unknown): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  // Always, including on failure: a leaked child holds a port and a temp
  // store, and the next test's `freePort` cannot see it.
  for (const c of running.splice(0)) {
    try {
      await stop(c);
    } catch {
      // Already dead, or unkillable. The next line still cleans the store.
    }
  }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("B4/B13: the boot round trip", () => {
  it("a repo opened before SIGTERM is open again after the restart", async () => {
    const state = tmp();
    const env = { XDG_DATA_HOME: state };

    const first = await boot(env);
    const opened = await post(first.port, "/api/repos", { path: MINI_EFCORE });
    expect(opened.status).toBe(201);
    const repo = ((await opened.json()) as { repo: { id: string; path: string } }).repo;

    // Before the restart, this is only a Map entry.
    expect(await get(first.port, "/api/health")).toMatchObject({ ok: true, repos: 1 });

    await stop(first);

    // The same store directory, a genuinely new process.
    const second = await boot(env, { port: first.port });
    const after = (await get(second.port, "/api/repos")) as {
      repos: Array<{ id: string; path: string }>;
    };
    expect(after.repos.map((r) => r.id)).toEqual([repo.id]);
    expect(after.repos[0]?.path).toBe(repo.path);

    // And the health endpoint says it came back BY REHYDRATING, which
    // `repos: 1` on its own does not: an `open()` from somewhere else would
    // report the same count.
    expect(await get(second.port, "/api/health")).toEqual({
      ok: true,
      repos: 1,
      rehydrate: { state: "done", loaded: 1, failed: 0, missing: 0 },
    });
  }, 120_000);
});

describe("B14: DELETE survives a restart", () => {
  it("a deleted repo does not come back", async () => {
    const state = tmp();
    const env = { XDG_DATA_HOME: state };

    const first = await boot(env);
    const opened = await post(first.port, "/api/repos", { path: MINI_EFCORE });
    expect(opened.status).toBe(201);
    const id = ((await opened.json()) as { repo: { id: string } }).repo.id;

    const deleted = await fetch(`http://127.0.0.1:${first.port}/api/repos/${id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    await stop(first);

    const second = await boot(env, { port: first.port });
    expect(await get(second.port, "/api/repos")).toEqual({ repos: [] });
    // `loaded: 0` and not merely an empty list: an empty list would also be
    // what a rehydrate that never ran produces, and that is the failure this
    // gate would otherwise be blind to.
    expect(await get(second.port, "/api/health")).toEqual({
      ok: true,
      repos: 0,
      rehydrate: { state: "done", loaded: 0, failed: 0, missing: 0 },
    });
  }, 120_000);
});

describe("B25: an unresolvable state directory", () => {
  // The positive control for F13's try/catch in `loadStateDir()`, which until
  // now was a negative guard with nothing proving it ever ran.
  //
  // The `"off"` state is NOT that control, and this is the whole reason the
  // assertion below is on stderr. Under the mutant worth fearing — a
  // `loadStateDir()` that returns `undefined` unconditionally — `stateDir` is
  // undefined, the state is `"off"`, and an assertion on `"off"` passes green
  // over the bug. Only the logged line proves the catch was entered.
  it("boots anyway, answers, and says persistence is off on stderr", async () => {
    const child = await boot({}); // no HOME, no XDG_DATA_HOME

    expect(child.out.join("")).toContain("psq server listening");
    expect(await get(child.port, "/api/health")).toEqual({
      ok: true,
      repos: 0,
      rehydrate: { state: "off", loaded: 0, failed: 0, missing: 0 },
    });

    const err = child.err.join("");
    expect(err).toContain("persistence off:");
    expect(err).toContain("Cannot resolve the psq state directory");
    // Named so the operator can fix it, rather than only told it is broken.
    // BOTH variables, which is why the second is a word-boundary regex and not
    // `toContain("HOME")` — that is satisfied by the line above, because
    // "XDG_DATA_HOME".includes("HOME"). It read like a second assertion and
    // was not one.
    expect(err).toContain("XDG_DATA_HOME");
    expect(err).toMatch(/\bHOME\b/);
  }, 120_000);

  // The control for the control: with the environment present, that line is
  // absent. Without this, "stderr contains the message" would pass just as
  // well on a server that printed it unconditionally.
  it("says nothing of the sort when the environment resolves", async () => {
    const child = await boot({ XDG_DATA_HOME: tmp() });
    expect(child.err.join("")).not.toContain("persistence off:");
  }, 120_000);
});
