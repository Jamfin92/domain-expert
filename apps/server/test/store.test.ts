import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Workspace } from "../src/workspace.js";
import {
  STORE_VERSION,
  defaultStateDir,
  deleteEnvelope,
  envelopePath,
  listEnvelopeIds,
  readEnvelope,
  reposDir,
  tempPathFor,
  writeEnvelope,
  type StoredRepo,
} from "../src/store.js";
import { MINI_EFCORE } from "../../../test/fixtures.js";

// B23 needs to see WHICH extractor binding `open()` calls, and in what
// quantity. Both are imported bindings in `workspace.ts`, so both can be
// wrapped. The wrappers delegate to the real implementations, so every other
// test in this file exercises genuine extraction — the same technique as
// `packages/extract/test/digest.test.ts:16-25`.
const calls = vi.hoisted(() => ({ extractWithDigest: 0, digestOf: 0 }));

vi.mock("@psq/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@psq/extract")>();
  return {
    ...actual,
    extractWithDigest: (...args: Parameters<typeof actual.extractWithDigest>) => {
      calls.extractWithDigest += 1;
      return actual.extractWithDigest(...args);
    },
    digestOf: (...args: Parameters<typeof actual.digestOf>) => {
      calls.digestOf += 1;
      return actual.digestOf(...args);
    },
  };
});

// Imported AFTER the mock declaration for readability only — `vi.mock` is
// hoisted above every import, so this binding is the counting wrapper. B23's
// positive control depends on that being true.
import { digestOf } from "@psq/extract";

const made: string[] = [];

/** A temp state directory, removed after the test even if it failed. */
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "psq-store-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    // A test may have left the directory unwritable on purpose (B12, B26).
    try {
      chmodSync(dir, 0o700);
      if (existsSync(reposDir(dir))) chmodSync(reposDir(dir), 0o700);
    } catch {
      // Already gone, or never created. Nothing to restore.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function envelope(over: Partial<StoredRepo> = {}): StoredRepo {
  return {
    version: STORE_VERSION,
    extractor: 1,
    id: "abcdef012345",
    path: "/nowhere/repo",
    seed: 1337,
    rows: 40,
    openedAt: "2026-01-01T00:00:00.000Z",
    fingerprint: "f".repeat(64),
    graph: {
      kind: "entity",
      repo: "/nowhere/repo",
      provider: "sqlite-ddl",
      contextName: null,
      entities: [],
      relations: [],
      shapes: [],
      routes: [],
      clientCalls: [],
      components: [],
      entityRefs: [],
      warnings: [],
    },
    ...over,
  };
}

describe("B18: the default state directory resolver", () => {
  it("prefers XDG_DATA_HOME", () => {
    expect(defaultStateDir({ XDG_DATA_HOME: "/data", HOME: "/home/j" })).toBe("/data/psq");
  });

  it("falls back to HOME/.local/share when XDG_DATA_HOME is unset or empty", () => {
    expect(defaultStateDir({ HOME: "/home/j" })).toBe("/home/j/.local/share/psq");
    expect(defaultStateDir({ XDG_DATA_HOME: "", HOME: "/home/j" })).toBe("/home/j/.local/share/psq");
  });

  // OUT-OF-CHARTER FIX (G-b2, review round 2). This is a G-b1 gate and not in
  // G-b2's charter, but it was measured inert and left in place would be a
  // gate that cannot fail: `/HOME/` is already satisfied by the line above it,
  // because "XDG_DATA_HOME" contains "HOME" — the exact sibling of the
  // vacuous `toContain("HOME")` this phase fixed in `boot.test.ts`. Measured
  // before the fix: dropping "nor HOME" from `defaultStateDir`'s message
  // reddened B25 and left this test GREEN. `\bHOME\b` does not match inside
  // XDG_DATA_HOME, so the title's "naming both variables" is now true.
  // James: revert this hunk if you would rather it rode with a G-b1 fix.
  it("throws actionably when neither is set, naming both variables", () => {
    expect(() => defaultStateDir({})).toThrow(/XDG_DATA_HOME/);
    expect(() => defaultStateDir({})).toThrow(/\bHOME\b/);
  });

  // The control for F2: the boot gate overrides XDG_DATA_HOME in a CHILD
  // process, which only works if the value is read when the function runs.
  // A value captured at module load would make that override silently
  // do nothing and the child would write into the live store.
  it("reads the environment at call time, not at module load", () => {
    const before = process.env["XDG_DATA_HOME"];
    try {
      process.env["XDG_DATA_HOME"] = "/first";
      expect(defaultStateDir()).toBe("/first/psq");
      process.env["XDG_DATA_HOME"] = "/second";
      expect(defaultStateDir()).toBe("/second/psq");
    } finally {
      if (before === undefined) delete process.env["XDG_DATA_HOME"];
      else process.env["XDG_DATA_HOME"] = before;
    }
  });
});

describe("the envelope round trip", () => {
  it("writes, reads back, lists and deletes", () => {
    const dir = stateDir();
    expect(listEnvelopeIds(dir)).toEqual([]);
    writeEnvelope(dir, envelope());
    writeEnvelope(dir, envelope({ id: "000000000000" }));
    expect(listEnvelopeIds(dir)).toEqual(["000000000000", "abcdef012345"]);

    const read = readEnvelope(dir, "abcdef012345");
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.envelope.seed).toBe(1337);

    expect(deleteEnvelope(dir, "abcdef012345")).toBe(true);
    expect(deleteEnvelope(dir, "abcdef012345")).toBe(false);
    expect(listEnvelopeIds(dir)).toEqual(["000000000000"]);
  });

  it("refuses garbage, a wrong version, and a graph that fails its schema", () => {
    // The ids here are real store ids (twelve lowercase hex) because
    // `envelopePath` now rejects anything else, so which case is which cannot
    // live in the filenames. It lives in the `reason` assertions below, and it
    // has to: `{ ok: false }` alone was satisfied by all four cases equally,
    // and three of the four fixtures could be deleted with the suite still
    // green. B10 in G-b2 names these six cases individually and would
    // otherwise be free to test one of them four times.
    const dir = stateDir();
    mkdirSync(reposDir(dir), { recursive: true });
    writeFileSync(envelopePath(dir, "0a0a0a0a0a0a"), "{not json");
    writeFileSync(envelopePath(dir, "0b0b0b0b0b0b"), JSON.stringify(envelope({ version: 99 as 1 })));
    writeFileSync(
      envelopePath(dir, "0c0c0c0c0c0c"),
      JSON.stringify({ ...envelope(), graph: { kind: "entity" } }),
    );

    // Four mutually distinct reasons, so deleting any one fixture reddens
    // exactly its own line. The fourth has no fixture — its absence IS the
    // case, which is why no mutant can be built for it.
    //
    // `expect.stringMatching`, not a bare regex. Measured in this phase:
    // `toMatchObject({ reason: /not JSON/ })` passes against EVERY one of
    // these strings and against a `/THIS_CANNOT_MATCH/` that matches none of
    // them — a bare RegExp under `toMatchObject` asserts nothing at all in
    // vitest 2.1.9. The form that reads like an assertion was not one.
    expect(readEnvelope(dir, "0a0a0a0a0a0a"))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/not JSON/) });
    expect(readEnvelope(dir, "0b0b0b0b0b0b"))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/version/) });
    expect(readEnvelope(dir, "0c0c0c0c0c0c"))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/graph/) });
    expect(readEnvelope(dir, "0d0d0d0d0d0d"))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/ENOENT|no such file/) });
  });

  // B30. A stray file in `repos/` must be invisible rather than a permanent
  // `failed` entry in the rehydrate counter. The valid id is the positive
  // control: without it this passes just as well on a filter that lists
  // nothing at all.
  it("B30: hides junk from listEnvelopeIds without hiding real envelopes", () => {
    const dir = stateDir();
    writeEnvelope(dir, envelope());
    writeFileSync(join(reposDir(dir), "notes.json"), "shopping list");
    writeFileSync(join(reposDir(dir), ".hidden.json"), "{}");
    expect(listEnvelopeIds(dir)).toEqual(["abcdef012345"]);
  });

  // B31. The ordering guarantee from `writeEnvelope`: a refused id must not
  // have created the store directory on its way to being refused.
  it("B31: a hostile id throws before writeEnvelope creates anything", () => {
    const dir = stateDir();
    expect(() => writeEnvelope(dir, envelope({ id: "../../escape" })))
      .toThrow(/Not a repo id/);
    expect(existsSync(reposDir(dir))).toBe(false);
  });
});

describe("B19: permissions", () => {
  // Asserted on the FIRST write. Under temp+rename every write creates a new
  // file, so the hazard is a missing `{ mode: 0o600 }`, which leaves the very
  // first envelope at the umask default (0644 under umask 022). A rewrite
  // would catch the same thing and prove less.
  it("creates the store 0700 and its envelopes 0600 on the first write", () => {
    const dir = stateDir();
    writeEnvelope(dir, envelope());
    expect(statSync(reposDir(dir)).mode & 0o777).toBe(0o700);
    expect(statSync(envelopePath(dir, "abcdef012345")).mode & 0o777).toBe(0o600);
  });

  it("keeps 0600 across a rewrite", () => {
    const dir = stateDir();
    writeEnvelope(dir, envelope());
    writeEnvelope(dir, envelope({ seed: 7 }));
    expect(statSync(envelopePath(dir, "abcdef012345")).mode & 0o777).toBe(0o600);
  });
});

describe("B26: the write is atomic and leaves nothing behind", () => {
  const tmpFiles = (dir: string): string[] =>
    readdirSync(reposDir(dir)).filter((n) => n.endsWith(".tmp"));

  it("leaves no temp residue after a successful write", () => {
    const dir = stateDir();
    writeEnvelope(dir, envelope());
    writeEnvelope(dir, envelope({ seed: 7 }));
    expect(tmpFiles(dir)).toEqual([]);
  });

  it("leaves no temp residue after a failed rename", () => {
    const dir = stateDir();
    // A directory where the envelope belongs: the staging write succeeds and
    // the rename cannot. Without the cleanup this leaves a `.tmp` file that
    // every later boot would list.
    mkdirSync(join(reposDir(dir), "abcdef012345.json"), { recursive: true });
    writeFileSync(join(reposDir(dir), "abcdef012345.json", "occupant"), "x");
    expect(() => writeEnvelope(dir, envelope())).toThrow();
    expect(tmpFiles(dir)).toEqual([]);
  });

  // The EXDEV hazard: a temp file in `os.tmpdir()` renames across devices and
  // fails permanently on any machine whose temp directory is a separate
  // filesystem — and D-Gb-6 swallows the error, so nothing would be louder
  // than an empty store. An unwritable destination directory is what tells the
  // two apart: staging INTO it fails, staging elsewhere would not.
  it("stages the temp file in the destination directory", () => {
    const dir = stateDir();
    mkdirSync(reposDir(dir), { recursive: true });
    chmodSync(reposDir(dir), 0o500);
    let caught: NodeJS.ErrnoException | undefined;
    try {
      writeEnvelope(dir, envelope());
    } catch (err) {
      caught = err as NodeJS.ErrnoException;
    }
    expect(caught?.code).toBe("EACCES");
    expect(caught?.path).toBeDefined();
    expect(dirname(caught?.path ?? "")).toBe(reposDir(dir));
    expect(caught?.path ?? "").toMatch(/\.tmp$/);
    // And the naming helper agrees, for the same reason.
    expect(dirname(tempPathFor(envelopePath(dir, "0e0e0e0e0e0e")))).toBe(reposDir(dir));
  });
});

describe("the Workspace writes what it opened", () => {
  beforeEach(() => {
    calls.extractWithDigest = 0;
    calls.digestOf = 0;
  });

  // B5a. The fingerprint is compared against a digest the test computes for
  // itself, so an empty string, a missing field, or a fingerprint copied from
  // somewhere else all redden it.
  it("B5a: stores a fingerprint equal to an independently computed digest", () => {
    const dir = stateDir();
    const w = new Workspace(() => "2026-01-01T00:00:00.000Z", { stateDir: dir });
    // An unnormalized path, built by concatenation because `join` would
    // collapse the `..` itself. Measured: `digestOf` is invariant under it —
    // the digest walks the same tree either way — so the fingerprint half of
    // this test cannot tell raw from resolved. `path` and `id` can, and must,
    // because the id is `shortId(resolvedPath)`.
    const raw = `${MINI_EFCORE}/../mini-efcore`;
    const repo = w.open(raw, { seed: 99, rows: 7 });
    try {
      const read = readEnvelope(dir, repo.id);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.envelope.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(read.envelope.fingerprint).toBe(digestOf(resolve(MINI_EFCORE)));
      expect(read.envelope.path).toBe(resolve(MINI_EFCORE));
      expect(read.envelope.id).toBe(repo.id);
      // B6's inputs, stored rather than re-defaulted (D-Gb-3 / F10).
      expect(read.envelope.seed).toBe(99);
      expect(read.envelope.rows).toBe(7);
      expect(read.envelope.extractor).toBeGreaterThanOrEqual(1);
      expect(read.envelope.graph.entities.length).toBe(repo.graph.entities.length);
    } finally {
      w.closeAll();
    }
  });

  // B23. `extract(path)` followed by `digestOf(path)` is digest-AFTER-extract:
  // a file written during the extraction window yields an old graph carrying a
  // current fingerprint, which is permanently stale. That mistake passes B5a
  // and B5b, because both sides of both gates are `digestOf`. Only the call
  // shape tells them apart.
  it("B23: takes the digest through extractWithDigest, never separately", () => {
    const dir = stateDir();
    const w = new Workspace(() => "2026-01-01T00:00:00.000Z", { stateDir: dir });
    try {
      w.open(MINI_EFCORE);
      expect(calls.extractWithDigest).toBe(1);
      expect(calls.digestOf).toBe(0);
    } finally {
      w.closeAll();
    }
    // The control. Without it, `digestOf === 0` would also be satisfied by a
    // mock that is not intercepting anything at all.
    digestOf(MINI_EFCORE);
    expect(calls.digestOf).toBe(1);
  });

  // B17's sibling, from the store's own side: the seam is opt-in.
  it("writes nothing when no stateDir was given", () => {
    const dir = stateDir();
    const w = new Workspace(() => "2026-01-01T00:00:00.000Z");
    try {
      w.open(MINI_EFCORE);
      expect(existsSync(reposDir(dir))).toBe(false);
      expect(w.forget("anything")).toBe(false);
    } finally {
      w.closeAll();
    }
  });
});

describe("the store never fails a request", () => {
  // B12. The state directory is unwritable BEFORE the first open, so the
  // store cannot even create its `repos/` directory. The log assertion is the
  // mechanism: without it this gate passes just as happily on a store that
  // does nothing at all.
  it("B12: returns 201 with the state dir at 0500, and says so in the log", async () => {
    const dir = stateDir();
    chmodSync(dir, 0o500);
    const lines: string[] = [];
    const { app, workspace } = createApp(undefined, {
      stateDir: dir,
      log: (l) => lines.push(String(l)),
    });
    try {
      const res = await request(app).post("/api/repos").send({ path: MINI_EFCORE });
      expect(res.status).toBe(201);
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("psq store");
      expect(lines[0]).toContain(res.body.repo.id);
    } finally {
      workspace.closeAll();
      chmodSync(dir, 0o700);
    }
  });

  // The control for the line above: a writable store logs nothing, so
  // "the log is non-empty" is a statement about the failure and not noise.
  it("logs nothing when the store is writable", async () => {
    const dir = stateDir();
    const lines: string[] = [];
    const { app, workspace } = createApp(undefined, {
      stateDir: dir,
      log: (l) => lines.push(String(l)),
    });
    try {
      const res = await request(app).post("/api/repos").send({ path: MINI_EFCORE });
      expect(res.status).toBe(201);
      expect(lines).toEqual([]);
    } finally {
      workspace.closeAll();
    }
  });
});

describe("the API seam", () => {
  // B22. Every other gate here builds a Workspace directly, so without this
  // the production wiring — AppOptions -> default Workspace -> store — is
  // unproven until the boot gate lands a phase later.
  it("B22: createApp forwards a stateDir to the Workspace it builds", async () => {
    const dir = stateDir();
    const { app, workspace } = createApp(undefined, { stateDir: dir });
    try {
      const res = await request(app).post("/api/repos").send({ path: MINI_EFCORE });
      expect(res.status).toBe(201);
      const id = res.body.repo.id as string;
      expect(existsSync(envelopePath(dir, id))).toBe(true);
      expect(JSON.parse(readFileSync(envelopePath(dir, id), "utf8")).id).toBe(id);
    } finally {
      workspace.closeAll();
    }
  });

  it("does not forward a stateDir to a Workspace the caller supplied", async () => {
    const dir = stateDir();
    const w = new Workspace(() => "2026-01-01T00:00:00.000Z");
    const { app } = createApp(w, { stateDir: dir });
    try {
      expect((await request(app).post("/api/repos").send({ path: MINI_EFCORE })).status).toBe(201);
      expect(existsSync(reposDir(dir))).toBe(false);
    } finally {
      w.closeAll();
    }
  });

  // B15. Rehydrate keeps the files of entries it could not load, so an entry
  // that is on disk but never in the Map must still be deletable. `close()`
  // alone 404s on it, and it would be retried on every restart forever.
  it("B15: DELETE removes an envelope that was never loaded", async () => {
    const dir = stateDir();
    mkdirSync(reposDir(dir), { recursive: true });
    writeFileSync(envelopePath(dir, "deadbeef0001"), "{not json");
    const { app, workspace } = createApp(undefined, { stateDir: dir });
    try {
      const res = await request(app).delete("/api/repos/deadbeef0001");
      expect(res.status).toBe(200);
      expect(existsSync(envelopePath(dir, "deadbeef0001"))).toBe(false);
    } finally {
      workspace.closeAll();
    }
  });

  // The id goes straight from the URL into `unlinkSync`, and `join` collapses
  // `..`. Measured before the guard existed: this exact request returned 200
  // `{"closed": true}` and deleted the file two directories above the state
  // directory. Express 5 percent-decodes `req.params`, so `%2F` arrives as a
  // real separator, and `config.ts:80` only REQUIRES a token off-loopback, so
  // `pnpm dev:server` on loopback served this with no gate at all.
  it("B28: DELETE cannot reach a file outside the store", async () => {
    const dir = stateDir();
    const victim = join(dirname(dir), `psq-victim-${process.pid}.json`);
    writeFileSync(victim, "precious");
    const lines: string[] = [];
    const { app, workspace } = createApp(undefined, {
      stateDir: dir,
      log: (l) => lines.push(String(l)),
    });
    try {
      const hostile = `..%2F..%2Fpsq-victim-${process.pid}`;
      const res = await request(app).delete(`/api/repos/${hostile}`);
      expect(existsSync(victim)).toBe(true);
      expect(res.status).toBe(404);
      // The refusal is reported rather than silent, and names the id.
      expect(lines.join("\n")).toContain("Not a repo id");
    } finally {
      workspace.closeAll();
      rmSync(victim, { force: true });
    }
  });

  // The control, and the positive half of the gate above: a well-formed id
  // that names nothing still takes the same 404 path, so B28 is not passing
  // because DELETE stopped working.
  it("still 404s for an id that is neither open nor on disk", async () => {
    const dir = stateDir();
    const { app, workspace } = createApp(undefined, { stateDir: dir, log: () => {} });
    try {
      expect((await request(app).delete("/api/repos/nosuchid00000")).status).toBe(404);
      // And a well-formed id that names nothing takes the same path.
      expect((await request(app).delete("/api/repos/0f0f0f0f0f0f")).status).toBe(404);
    } finally {
      workspace.closeAll();
    }
  });
});
