import { describe, it, expect, afterEach, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invariants } from "@psq/graph";
import { referenceAnswer } from "@psq/quiz";
import { Workspace } from "../src/workspace.js";
import {
  STORE_VERSION,
  envelopePath,
  listEnvelopeIds,
  readEnvelope,
  type StoredRepo,
} from "../src/store.js";
import { MINI_EFCORE, MINI_EFCORE_REFS, MINI_NODE } from "../../../test/fixtures.js";

/**
 * The read side. Every test here builds a real store by opening a real
 * fixture, then rehydrates it in a SECOND `Workspace` — the same thing a
 * restart does, minus the process boundary. `boot.test.ts` covers the process
 * boundary itself.
 */

// Two counting wrappers, for two different gates. Both delegate to the real
// implementations, so every test in this file does genuine extraction — the
// idiom is `store.test.ts:29-42`, which is in turn `digest.test.ts:16-25`.
//
// B24 is the reason `digestOf` is counted rather than inferred from an
// outcome: the bug it exists to catch — comparing the digest before checking
// that the directory is still there — produces the SAME `missing` count as
// the correct ordering, because the re-extract it fires then fails and the
// catch re-classifies it. Only the call count separates them.
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

// B29 cannot be built with permissions: at 0500 the staging write and the
// unlink both fail EACCES, so the superseded envelope survives either way and
// the gate would pass on the bug. A mocked `writeEnvelope` is the only way to
// reach a write failure that does NOT also block the delete — the ENOSPC
// shape D-Gb2-5's invariant is actually stated for.
//
// Off by default so the rest of the file uses the real store.
const store = vi.hoisted(() => ({ failWrites: false }));

vi.mock("../src/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store.js")>();
  return {
    ...actual,
    writeEnvelope: (...args: Parameters<typeof actual.writeEnvelope>) => {
      if (store.failWrites) throw new Error("ENOSPC: no space left on device, write");
      return actual.writeEnvelope(...args);
    },
  };
});

import { EXTRACTOR_VERSION, digestOf, extractDotnet } from "@psq/extract";

const AT = "2026-01-01T00:00:00.000Z";
const made: string[] = [];
const opened: Workspace[] = [];

function tmp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `psq-${tag}-`));
  made.push(dir);
  return dir;
}

/**
 * A fixture copied to its own temp directory.
 *
 * B10 needs this and not a shared path: three of its cases must load, and if
 * they all pointed at one fixture they would share one `shortId`, collapse
 * into a single Map entry while `loaded` incremented three times, and the gate
 * would pass over a broken outcome.
 */
function copyOf(fixture: string): string {
  const dest = join(tmp("repo"), "repo");
  cpSync(fixture, dest, { recursive: true });
  return dest;
}

function ws(stateDir: string, log: string[] = []): Workspace {
  const w = new Workspace(() => AT, { stateDir, log: (l) => log.push(String(l)) });
  opened.push(w);
  return w;
}

/** Read an envelope's raw JSON, mutate it, write it back. */
function patch(stateDir: string, id: string, over: Record<string, unknown>): void {
  const p = envelopePath(stateDir, id);
  const env = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  writeFileSync(p, JSON.stringify({ ...env, ...over }, null, 2));
}

afterEach(() => {
  store.failWrites = false;
  calls.extractWithDigest = 0;
  calls.digestOf = 0;
  for (const w of opened.splice(0)) w.closeAll();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("B5b: an unchanged repo is not re-extracted", () => {
  it("the stored fingerprint still equals digestOf(path), and the graph is reused", () => {
    const state = tmp("state");
    const repo = copyOf(MINI_EFCORE);
    const id = ws(state).open(repo).id;

    const read = readEnvelope(state, id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.envelope.fingerprint).toBe(digestOf(repo));

    calls.extractWithDigest = 0;
    const w2 = ws(state);
    return w2.rehydrate().then(() => {
      expect(w2.rehydrateStatus()).toEqual({
        state: "done", loaded: 1, failed: 0, missing: 0,
      });
      // The whole point of the stored graph: nothing was extracted again.
      expect(calls.extractWithDigest).toBe(0);
    });
  });
});

describe("B6: fidelity", () => {
  // Non-default seed AND non-default rows. The seeded database is a function
  // of (graph, seed, rows), so a `rows` that fell back to the default would
  // reproduce a different bank while still looking like a successful load.
  it("rehydrates the identical ordered question list under a non-default seed and rows", async () => {
    const state = tmp("state");
    const repo = copyOf(MINI_EFCORE);
    const first = ws(state).open(repo, { seed: 4242, rows: 7 });
    const before = first.questions.map((q) => q.id);
    expect(before.length).toBeGreaterThan(0);

    const w2 = ws(state);
    await w2.rehydrate();
    const after = w2.get(first.id);
    expect(after).toBeDefined();
    expect(after?.seed).toBe(4242);
    expect(after?.rows).toBe(7);
    expect(after?.openedAt).toBe(AT);
    expect(after?.questions.map((q) => q.id)).toEqual(before);
  });
});

describe("B7: a rehydrated repo still grades", () => {
  it("passes selftest, and marks a right answer right and a wrong answer wrong", async () => {
    const state = tmp("state");
    const repo = copyOf(MINI_EFCORE);
    const id = ws(state).open(repo).id;

    const w2 = ws(state);
    await w2.rehydrate();

    // Rule 5: every question must be failable. `selftest` grades each with its
    // reference answer, which must pass, and with a mutation, which must fail.
    // An empty finding list is the strongest form of this gate.
    expect(w2.selftestOf(id)).toEqual([]);

    // And the same thing through the session surface the UI uses, so a
    // rehydrated repo is proven gradable end to end and not only in isolation.
    const session = w2.startQuiz(id, 4);
    const qs = w2.questionsOf(session);
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(w2.answer(session.id, qs[0]!.id, referenceAnswer(qs[0]!)).result.correct).toBe(true);
    expect(w2.answer(session.id, qs[1]!.id, "not the answer to anything").result.correct)
      .toBe(false);
  });
});

describe("B8: stale detection", () => {
  it("re-extracts a changed repo, the new fact appears, and the envelope is rewritten", async () => {
    const state = tmp("state");
    const repo = copyOf(MINI_NODE);
    const id = ws(state).open(repo).id;

    const beforeEnv = readEnvelope(state, id);
    expect(beforeEnv.ok).toBe(true);
    if (!beforeEnv.ok) return;
    const ports = beforeEnv.envelope.graph.entities.find((e) => e.tableName === "ports");
    expect(ports).toBeDefined();
    expect(ports?.properties.map((p) => p.name)).not.toContain("region");

    // An OBSERVABLE change, not merely a different digest: a digest assertion
    // alone would pass on a re-extract that produced the same graph, and on a
    // stored graph that was never refreshed at all.
    const schema = join(repo, "schema.ts");
    writeFileSync(
      schema,
      readFileSync(schema, "utf8").replace(
        "  country TEXT NOT NULL\n",
        "  country TEXT NOT NULL,\n  region  TEXT\n",
      ),
    );

    calls.extractWithDigest = 0;
    const w2 = ws(state);
    await w2.rehydrate();
    expect(calls.extractWithDigest).toBe(1);
    expect(w2.rehydrateStatus()).toEqual({ state: "done", loaded: 1, failed: 0, missing: 0 });

    const after = w2.get(id);
    expect(after?.graph.entities.find((e) => e.tableName === "ports")?.properties
      .map((p) => p.name)).toContain("region");

    // The store was brought forward too, or the next boot re-extracts again.
    const afterEnv = readEnvelope(state, id);
    expect(afterEnv.ok).toBe(true);
    if (!afterEnv.ok) return;
    expect(afterEnv.envelope.fingerprint).toBe(digestOf(repo));
    expect(afterEnv.envelope.fingerprint).not.toBe(beforeEnv.envelope.fingerprint);
    expect(afterEnv.envelope.graph.entities.find((e) => e.tableName === "ports")?.properties
      .map((p) => p.name)).toContain("region");
  });
});

describe("B9: a stale extractor forces a re-extract", () => {
  // `StoredRepo` types `extractor` as `z.number().int()` rather than pinning
  // it to `EXTRACTOR_VERSION`, so a stale envelope parses cleanly and the
  // staleness check runs in `workspace.ts` with the whole envelope — and the
  // `path` — in hand. That is what makes this case recoverable at all.
  it("re-extracts when the envelope was written by an older extractor", async () => {
    const state = tmp("state");
    const repo = copyOf(MINI_EFCORE);
    const id = ws(state).open(repo).id;
    patch(state, id, { extractor: 0 });

    calls.extractWithDigest = 0;
    const w2 = ws(state);
    await w2.rehydrate();
    expect(calls.extractWithDigest).toBe(1);
    expect(w2.rehydrateStatus()).toEqual({ state: "done", loaded: 1, failed: 0, missing: 0 });
    // And the rewritten envelope carries the current extractor, so the next
    // boot does not pay for this again.
    const env = readEnvelope(state, id);
    expect(env.ok && env.envelope.extractor).not.toBe(0);
  });
});

describe("B10/B11: a corrupt store", () => {
  it("classifies all six cases, keeps every file, and still loads the good entry", async () => {
    const state = tmp("state");

    // Three loadable cases, three SEPARATE fixture directories. Pointed at one
    // directory they share a `shortId`, collapse to one Map entry, and this
    // gate passes with `loaded: 3` over a single repo.
    const staleDir = copyOf(MINI_EFCORE);
    const badInvDir = copyOf(MINI_EFCORE);
    const goodDir = copyOf(MINI_NODE);
    const vanishedDir = copyOf(MINI_EFCORE);

    const seeder = ws(state);
    const staleId = seeder.open(staleDir).id;
    const badInvId = seeder.open(badInvDir).id;
    const goodId = seeder.open(goodDir).id;
    const vanishedId = seeder.open(vanishedDir).id;
    seeder.closeAll();

    // 1. garbage JSON — unrepairable, `path` is discarded with the payload.
    writeFileSync(envelopePath(state, "0a0a0a0a0a0a"), "{not json");
    // 2. a version this psq does not know. Written by a NEWER psq; must not be
    //    silently downgraded by re-extracting over it.
    writeFileSync(
      envelopePath(state, "0b0b0b0b0b0b"),
      readFileSync(envelopePath(state, goodId), "utf8").replace(
        `"version": ${STORE_VERSION}`, `"version": 99`),
    );
    // 3. a graph that fails `EntityGraph.parse`.
    const bad = JSON.parse(readFileSync(envelopePath(state, goodId), "utf8")) as StoredRepo;
    writeFileSync(
      envelopePath(state, "0c0c0c0c0c0c"),
      JSON.stringify({ ...bad, id: "0c0c0c0c0c0c", graph: { kind: "entity" } }),
    );
    // 4. a stale extractor — parses, so `path` survives and it re-extracts.
    patch(state, staleId, { extractor: 0 });
    // 5. a graph that PARSES but fails `invariants()`: an entity with no
    //    primary key. Also recoverable, by the same route.
    const inv = JSON.parse(readFileSync(envelopePath(state, badInvId), "utf8")) as StoredRepo;
    inv.graph.entities[0]!.keys = [];
    writeFileSync(envelopePath(state, badInvId), JSON.stringify(inv));
    // 6. a path that is no longer a directory.
    rmSync(vanishedDir, { recursive: true, force: true });

    const log: string[] = [];
    calls.extractWithDigest = 0;
    const w = ws(state, log);
    await w.rehydrate();

    expect(w.rehydrateStatus()).toEqual({
      state: "done", loaded: 3, failed: 3, missing: 1,
    });

    // The counts alone do NOT separate case 5 from a load of the broken
    // stored graph — measured in this phase, with the try/catch mutant the
    // plan predicted would redden here. `invariants` cannot throw, so under
    // that mutant the bad graph is materialized instead of re-extracted and
    // every counter is identical. Two assertions close it:
    //
    // Exactly two re-extracts — the stale extractor and the bad invariants.
    // The good entry uses its stored graph and must not be extracted at all.
    expect(calls.extractWithDigest).toBe(2);
    // And the repaired graph is the one in the Map: a re-extract from source
    // has its primary key back, a materialized stored graph does not.
    expect(invariants(w.get(badInvId)!.graph)).toEqual([]);
    expect(w.get(badInvId)!.graph.entities[0]!.keys.length).toBeGreaterThan(0);

    // Three DISTINCT repos in the Map, not one counted three times.
    expect([...new Set([staleId, badInvId, goodId])].length).toBe(3);
    for (const id of [staleId, badInvId, goodId]) expect(w.get(id)).toBeDefined();
    expect(w.list().length).toBe(3);

    // B11. Nothing is deleted. A corrupt entry the user can see is one they
    // can DELETE; an entry rehydrate silently removed is one they cannot.
    for (const id of ["0a0a0a0a0a0a", "0b0b0b0b0b0b", "0c0c0c0c0c0c", vanishedId]) {
      expect(existsSync(envelopePath(state, id))).toBe(true);
    }
    expect(listEnvelopeIds(state)).toContain(vanishedId);

    // Each failure said which entry and why, or the counter is an alarm with
    // no way to act on it.
    expect(log.filter((l) => l.includes("failed")).length).toBe(3);
    expect(log.filter((l) => l.includes("missing")).length).toBe(1);
    expect(log.join("\n")).toContain(vanishedId);
  }, 60_000);
});

describe("B16: the status is observable while it runs", () => {
  // Two envelopes, not one. The `await` lives inside the per-entry loop, so a
  // zero-entry or single-entry store can run to completion before the next
  // synchronous line and this would read "done" on a correct implementation.
  it("reads running synchronously after the call, and done after the await", async () => {
    const state = tmp("state");
    const seeder = ws(state);
    seeder.open(copyOf(MINI_EFCORE));
    seeder.open(copyOf(MINI_NODE));
    seeder.closeAll();
    expect(listEnvelopeIds(state).length).toBe(2);

    const w = ws(state);
    expect(w.rehydrateStatus().state).toBe("pending");
    const running = w.rehydrate();
    // The very next synchronous line. `state = "running"` is set before the
    // first await, so this is an assertion and not a poll against a race.
    expect(w.rehydrateStatus().state).toBe("running");
    await running;
    expect(w.rehydrateStatus()).toEqual({ state: "done", loaded: 2, failed: 0, missing: 0 });
  }, 60_000);

  it("is off, and touches no disk, when persistence is off", async () => {
    const w = new Workspace(() => AT);
    expect(w.rehydrateStatus().state).toBe("off");
    await w.rehydrate();
    expect(w.rehydrateStatus()).toEqual({ state: "off", loaded: 0, failed: 0, missing: 0 });
  });

  it("hands out a copy, so a caller cannot mutate the counters", () => {
    const w = ws(tmp("state"));
    w.rehydrateStatus().loaded = 99;
    expect(w.rehydrateStatus().loaded).toBe(0);
  });
});

describe("B32: an id that does not agree with its path or filename", () => {
  // D-Gb2-8, and it needed a gate: with the condition replaced by `if (false)`
  // the whole of `apps/server/test/` stayed at 88 passed (88).
  //
  // The envelope-count assertion is the half that matters. `failed: 1` alone
  // is also what a guard that merely refused to load would produce; the
  // damage the guard actually prevents is the re-extract branch calling
  // `open()`, which derives its own id from the path and writes a SECOND
  // envelope — leaving the wrong-named one behind to re-orphan on every boot
  // forever, reported by no API surface and so undiscoverable without listing
  // the directory. (It is not undeletable: a DELETE by the id it is filed
  // under does remove it, which is what B15 gates and what the assertion at
  // the end of this test says. An earlier version of this comment claimed
  // otherwise and was measured false.)
  it("books failed and writes no second envelope", async () => {
    const state = tmp("state");
    const repo = copyOf(MINI_EFCORE);
    const seeder = ws(state);
    const realId = seeder.open(repo).id;
    seeder.closeAll();

    // The envelope moved to a filename that is a valid store id but the wrong
    // one, and made stale so the re-extract branch is the one that runs.
    const env = JSON.parse(readFileSync(envelopePath(state, realId), "utf8")) as StoredRepo;
    rmSync(envelopePath(state, realId));
    writeFileSync(
      envelopePath(state, "222222222222"),
      JSON.stringify({ ...env, id: "222222222222", extractor: 0 }),
    );

    const log: string[] = [];
    const w = ws(state, log);
    await w.rehydrate();

    expect(w.rehydrateStatus()).toEqual({ state: "done", loaded: 0, failed: 1, missing: 0 });
    expect(w.get(realId)).toBeUndefined();
    // Exactly the one envelope it started with. No orphan, and the bad one is
    // kept so a DELETE can still reach it by the id it is filed under.
    expect(listEnvelopeIds(state)).toEqual(["222222222222"]);
    expect(log.join("\n")).toContain("222222222222");
  }, 60_000);
});

describe("D-Gb2-6: closeAll stops an in-flight rehydrate", () => {
  // Also ungated until now: deleting `this.stopping = true` from `closeAll()`
  // left `apps/server/test/` at 88 passed (88).
  //
  // A rehydrate still yielding after shutdown keeps materializing repos into
  // a Map that has just been cleared, so every `SeededDb` it opens from that
  // point on leaks past the process's own shutdown path.
  it("stops short of the entry count instead of running to the end", async () => {
    const state = tmp("state");
    const seeder = ws(state);
    for (let i = 0; i < 6; i++) seeder.open(copyOf(MINI_EFCORE));
    seeder.closeAll();
    expect(listEnvelopeIds(state).length).toBe(6);

    const w = ws(state);
    const running = w.rehydrate();
    // The loop yields before each entry, so this lands between entries.
    await new Promise((r) => setImmediate(r));
    w.closeAll();
    await running;

    const status = w.rehydrateStatus();
    expect(status.state).toBe("done");
    // The control on both sides: it stopped early, and it is not vacuously
    // zero-work either — without the flag this reaches 6.
    expect(status.loaded).toBeLessThan(6);
    expect(w.list().length).toBe(0);
  }, 60_000);
});

describe("B24: a vanished path is missing, and is never digested", () => {
  it("counts missing and never calls digestOf for it", async () => {
    const state = tmp("state");
    const repo = copyOf(MINI_EFCORE);
    const id = ws(state).open(repo).id;
    rmSync(repo, { recursive: true, force: true });

    calls.digestOf = 0;
    calls.extractWithDigest = 0;
    const w = ws(state);
    await w.rehydrate();

    expect(w.rehydrateStatus()).toEqual({ state: "done", loaded: 0, failed: 0, missing: 1 });
    // The control. `digestOf` on a vanished root returns the empty-input
    // sha256 instead of throwing, so an implementation that compared first
    // would see "changed", fire a re-extract, and land in the catch — which
    // re-classifies it as missing and produces this EXACT same count. The
    // call count is the only thing that separates the two.
    expect(calls.digestOf).toBe(0);
    expect(calls.extractWithDigest).toBe(0);
  });
});

describe("B29: a failed re-open persist never leaves the superseded envelope", () => {
  it("leaves no envelope rather than the one it replaced", async () => {
    const state = tmp("state");
    const repo = copyOf(MINI_EFCORE);
    const log: string[] = [];
    const w = ws(state, log);

    const id = w.open(repo, { seed: 111, rows: 5 }).id;
    const before = readEnvelope(state, id);
    expect(before.ok && before.envelope.seed).toBe(111);

    // A write that fails for a reason that does not also block the unlink.
    store.failWrites = true;
    w.open(repo, { seed: 222, rows: 9 });

    // Current or absent, never stale. A surviving envelope here would have
    // rehydrate resurrect seed 111 — a configuration the user has replaced.
    expect(existsSync(envelopePath(state, id))).toBe(false);
    expect(listEnvelopeIds(state)).toEqual([]);
    expect(log.join("\n")).toContain("could not save");

    // And the in-memory repo is the new one: the store failing must not turn
    // a successful open into a failed one (D-Gb-6).
    expect(w.get(id)?.seed).toBe(222);
  }, 60_000);
});

/**
 * H-b1. Two new `it()` blocks, deliberately NOT folded into B10/B11's six-case
 * test: that one is pinned to `{loaded:3, failed:3, missing:1}` at :305-307,
 * and any extra envelope in it moves those counters.
 */
describe("G22: an envelope stored before `entityRefs` existed", () => {
  it("loads, and yields [] from the schema default rather than failing", async () => {
    const state = tmp("state");
    // MINI_EFCORE_REFS specifically. On MINI_EFCORE a fresh extraction returns
    // `[]` too (that is G21), so this gate would pass on a deleted
    // `.default([])` — the `[]` would have come from re-extraction. The
    // fixture and the `extractor` value below are the whole gate.
    const repo = copyOf(MINI_EFCORE_REFS);
    const id = ws(state).open(repo).id;

    // Strip the field, leaving the extractor CURRENT and the fingerprint
    // intact, so nothing else can trigger a re-extract and supply the `[]`.
    const p = envelopePath(state, id);
    // Typed loosely on purpose: `delete` refuses a required property, and
    // `entityRefs` is required in `EntityGraph`'s OUTPUT type — which is the
    // very thing this test is here to exercise. The parsed object still
    // carries every other field, so writing it back is lossless.
    const env = JSON.parse(readFileSync(p, "utf8")) as {
      extractor: number;
      graph: Record<string, unknown>;
    };
    expect(env.extractor).toBe(EXTRACTOR_VERSION);
    // It is there, and non-empty, before we take it away — so the `[]` this
    // test ends on is a fact about the schema default and not about an
    // envelope that never carried the field in the first place.
    expect((env.graph["entityRefs"] as unknown[]).length).toBeGreaterThan(0);
    delete env.graph["entityRefs"];
    writeFileSync(p, JSON.stringify(env, null, 2));

    calls.extractWithDigest = 0;
    const w = ws(state);
    await w.rehydrate();

    expect(w.rehydrateStatus()).toEqual({ state: "done", loaded: 1, failed: 0, missing: 0 });
    // Nothing was extracted again, so the `[]` below can only be the default.
    expect(calls.extractWithDigest).toBe(0);
    expect(w.get(id)!.graph.entityRefs).toEqual([]);

    // The positive control. A fresh extraction of this SAME repo is non-empty,
    // which is what makes the `[]` above attributable to `.default([])` and
    // not to the fixture simply having no refs.
    expect(extractDotnet(repo).entityRefs.length).toBeGreaterThan(0);
  });
});

describe("G23: the extractor bump", () => {
  it("re-extracts an envelope written by the PREVIOUS extractor, and not one at the current version", async () => {
    // The bump is one half of D-Hb-12: without it a graph stored by the
    // previous extractor would parse cleanly and serve stale extraction
    // forever, which is indistinguishable from a repo that genuinely has none.
    //
    // Both literals below track the bump and MUST move with it. The two
    // `toBe(EXTRACTOR_VERSION)` assertions further down read the constant
    // SYMBOLICALLY and are therefore true at any value — a declaration cannot
    // be gated by a test that merely mirrors it. These two are the gate:
    //   - the bound below reddens when `EXTRACTOR_VERSION` is reverted (M8);
    //   - the `extractor: 2` patch is the behavioural half, proving that an
    //     envelope written by version 2 really does re-extract under 3.
    // H-e raised both from 1 to 2 with the 2 -> 3 bump. Raise them again on
    // the next bump, or the gate silently stops gating.
    expect(EXTRACTOR_VERSION).toBeGreaterThan(2);

    const state = tmp("state");
    const stale = copyOf(MINI_EFCORE_REFS);
    const current = copyOf(MINI_EFCORE_REFS);

    const seeder = ws(state);
    const staleId = seeder.open(stale).id;
    const currentId = seeder.open(current).id;
    seeder.closeAll();

    patch(state, staleId, { extractor: 2 });

    calls.extractWithDigest = 0;
    const w = ws(state);
    await w.rehydrate();

    expect(w.rehydrateStatus()).toEqual({ state: "done", loaded: 2, failed: 0, missing: 0 });
    // Exactly one re-extract: the stale one. The control is the other entry —
    // a version check that fired for both would read the same in the counters
    // above and only differs here.
    expect(calls.extractWithDigest).toBe(1);
    // And the rewritten envelope carries the new version, with the refs it
    // was re-extracted for.
    const env = readEnvelope(state, staleId);
    expect(env.ok && env.envelope.extractor).toBe(EXTRACTOR_VERSION);
    expect(w.get(staleId)!.graph.entityRefs.length).toBeGreaterThan(0);
    expect(w.get(currentId)!.graph.entityRefs.length).toBeGreaterThan(0);
  });
});
