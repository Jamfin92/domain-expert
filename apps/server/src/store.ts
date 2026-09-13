import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { EntityGraph } from "@psq/schema";
import { z } from "zod";

/**
 * The on-disk store: one JSON envelope per open repo, written atomically.
 *
 * It exists because the server self-restarts under `KeepAlive` and its
 * `Workspace` is an in-memory Map, so every restart left `repos: 0`. Nothing
 * here is a source of truth — every field can be rebuilt from the repo plus a
 * seed — so every failure is the caller's to log and swallow (D-Gb-6).
 *
 * The store lives OUTSIDE the checkout (D-Gb-1). This repo is public, the
 * envelopes hold absolute paths to private repos and their extracted entity
 * and table names, and an untracked directory inside the checkout is one
 * `git clean` from gone.
 */

/** Bumped when the envelope's own shape changes. Not the extractor's version. */
export const STORE_VERSION = 1;

export const StoredRepo = z.object({
  version: z.literal(STORE_VERSION),
  /** `EXTRACTOR_VERSION` at the time the graph was produced. */
  extractor: z.number().int(),
  id: z.string(),
  path: z.string(),
  seed: z.number().int(),
  rows: z.number().int(),
  openedAt: z.string(),
  /** `digestOf(path)` taken before extraction. See `extractWithDigest`. */
  fingerprint: z.string(),
  graph: EntityGraph,
});
export type StoredRepo = z.infer<typeof StoredRepo>;

/**
 * `${XDG_DATA_HOME:-$HOME/.local/share}/psq`.
 *
 * The environment is read at CALL time, never at module load: the boot gate
 * spawns a child with `XDG_DATA_HOME` pointed at a temp directory, and a value
 * captured at import would silently ignore it and write into the live store.
 * `env` is a parameter only so the three branches can be tested directly; the
 * default is evaluated on every call.
 */
export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env["XDG_DATA_HOME"];
  if (xdg !== undefined && xdg !== "") return join(xdg, "psq");
  const home = env["HOME"];
  if (home === undefined || home === "") {
    throw new Error(
      "Cannot resolve the psq state directory: neither XDG_DATA_HOME nor HOME is set. " +
        "Set one of them, or accept that this process runs without persistence.",
    );
  }
  return join(home, ".local", "share", "psq");
}

/** Where the envelopes live under a state directory. */
export function reposDir(stateDir: string): string {
  return join(stateDir, "repos");
}

/**
 * Exactly what `shortId` produces: twelve lowercase hex characters.
 *
 * Every id reaching the store comes off the wire — `DELETE /api/repos/:id` is
 * the surface today, and a "reopen by id" surface would be the next one. Ids
 * are not otherwise sanitised anywhere, and Express percent-decodes
 * `req.params`, so `..%2F..%2Fvictim` arrives here as real path separators.
 */
const STORE_ID = /^[0-9a-f]{12}$/;

/** Whether a string can name an envelope at all. */
export function isStoreId(id: string): boolean {
  return STORE_ID.test(id);
}

/**
 * The envelope path for one repo id. `id` is `shortId(resolvedPath)`.
 *
 * The validation lives HERE rather than at the route because this is the
 * chokepoint: `join` collapses `..`, so an unchecked id turns `unlinkSync`
 * into an arbitrary-file delete anywhere the server user can write. Checking
 * at one route would leave the next caller to rediscover that.
 */
export function envelopePath(stateDir: string, id: string): string {
  if (!isStoreId(id)) {
    throw new Error(`Not a repo id: ${JSON.stringify(id)}`);
  }
  return join(reposDir(stateDir), `${id}.json`);
}

let tempCounter = 0;

/**
 * The temp path a write stages through, in the DESTINATION directory.
 *
 * Not `os.tmpdir()`: `rename` across devices is `EXDEV`, which would turn the
 * atomic write into a permanent silent failure on any machine whose temp
 * directory is a different filesystem — and D-Gb-6 swallows the error, so
 * nothing would be louder than an empty store.
 */
export function tempPathFor(dest: string): string {
  tempCounter += 1;
  return join(dirname(dest), `.${basename(dest)}.${process.pid}.${tempCounter}.tmp`);
}

/**
 * Write one envelope atomically: stage into the destination directory, then
 * `rename` over the target. A crash mid-write leaves the previous envelope
 * intact rather than a half-written one.
 *
 * The modes are set on creation rather than chmod'ed afterwards. Under
 * temp+rename every write creates a NEW file, so a missing `{ mode: 0o600 }`
 * would leave every envelope at the umask default from the very first write.
 */
export function writeEnvelope(stateDir: string, envelope: StoredRepo): void {
  // Validated BEFORE anything is created on disk. Write-side ids are always
  // `shortId`, so nothing reaches this with a hostile id today; the ordering is
  // here so the guard reads as what it is — the first thing that happens —
  // rather than as a check a refused id has already had a side effect past.
  const dest = envelopePath(stateDir, envelope.id);
  mkdirSync(reposDir(stateDir), { recursive: true, mode: 0o700 });
  const tmp = tempPathFor(dest);
  try {
    writeFileSync(tmp, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, dest);
  } catch (err) {
    // Never leave residue behind a failed write; the next boot would list it.
    rmSync(tmp, { force: true });
    throw err;
  }
}

export type ReadResult =
  | { ok: true; envelope: StoredRepo }
  | { ok: false; reason: string };

/**
 * Read and validate one envelope.
 *
 * Returns a result rather than throwing because every caller classifies the
 * failure instead of propagating it, and because "this entry is bad" is an
 * ordinary outcome for a store on disk, not an exception.
 *
 * The graph is validated with the same `EntityGraph` schema an extracted graph
 * satisfies. A loaded graph gets no weaker treatment than an extracted one.
 */
export function readEnvelope(stateDir: string, id: string): ReadResult {
  let raw: string;
  try {
    raw = readFileSync(envelopePath(stateDir, id), "utf8");
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `not JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = StoredRepo.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, envelope: result.data };
}

/**
 * Every envelope id in the store, sorted. A missing store is an empty store.
 *
 * `isStoreId` filters for legibility, NOT for safety: `readEnvelope` returns
 * `{ ok: false }` for an id `envelopePath` refuses, so an unfiltered stray
 * `notes.json` could never crash or abort a caller's loop. What it would do is
 * become a permanent `failed` entry in the rehydrate counter that nothing ever
 * cleans up — an alarm a user cannot clear. Junk is better invisible.
 */
export function listEnvelopeIds(stateDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(reposDir(stateDir));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".json") && !n.startsWith("."))
    .map((n) => n.slice(0, -".json".length))
    .filter(isStoreId)
    .sort();
}

/** Remove one envelope. `false` means there was nothing there. */
export function deleteEnvelope(stateDir: string, id: string): boolean {
  try {
    unlinkSync(envelopePath(stateDir, id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
