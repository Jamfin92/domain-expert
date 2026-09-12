# Phase G-a — the digest — PROGRESS

**Status: SHIPPED at `b83c5e7` (2026-09-12). Three review rounds, all "Ship",
zero blocking findings in any of them; James accepted.** Feature work on
`master` across `cfd8892` → `28736d8` → `b83c5e7`, with the phase records
committed alongside. **Not pushed** — `master` is 6 ahead of `origin/master`
(4 from G-a plus the 2 pre-existing Phase F commits), James's call as in
Phases E and F.

Plan: `plan.md`, rev 2 plus **Amendments 1, 2 and 3**, all approved in-flight.
Rev 1 was reviewed and sent back; its post-mortem is at the end of `plan.md`.
Audit: `audit-a.md`, three amendment sections with the original record intact.

G-b — the store and rehydrate — is **planned but not started**. Its design
(D-Gb-1 … D-Gb-8) and its 21 gates are in the same `plan.md`.

---

## Why this phase exists

James asked for local persistence so psq would not re-run extraction every time
he wants a concrete mapping. Measured first, and the premise did not survive
contact: the whole pipeline is 0.6–1.9s per corpus root, and `psq help` alone is
0.57s of tsx/pnpm startup, so recompute costs ~1.3s at worst. **Speed was never
the prize.**

What actually costs: the server's `Workspace` is an in-memory `Map` that opens
nothing at startup, so every restart — and it self-restarts under `KeepAlive` —
leaves `repos: 0` and an empty "open a repo" screen. And nothing ever reads a
mapping back: `psq graph --out` writes `entity.graph.json` and no code anywhere
parses it.

James chose **"survive restarts"** and **"graph only on disk"**, and explicitly
declined an export/query surface and a persisted seeded DB. G-a is the digest
that makes a stored graph safe to reuse; G-b is the store itself.

## What shipped

| Part | Where | What |
|---|---|---|
| The digest | `packages/extract/src/files.ts` | **new** `digestOf(root)` — sha256 over the walked set, framed `relpath + NUL + byteLength + NUL + contents` |
| Its extension list | same | **new** `DIGEST_EXTENSIONS`, ten entries, package-private |
| Digest + graph together | `packages/extract/src/detect.ts` | **new** `extractWithDigest()`, digest taken **before** extraction |
| Producer version | same | **new** `EXTRACTOR_VERSION = 1` |
| Exports | `packages/extract/src/index.ts` | `digestOf`, `extractWithDigest`, `EXTRACTOR_VERSION` |
| Typecheck reach | `tsconfig.json` | `include` widened to `packages/*/test` and `apps/*/test` |
| Amendment 1 | `apps/server/test/auth.test.ts` | two `@ts-expect-error` comments, no executable line changed |
| Gates | `packages/extract/test/digest.test.ts` | **new**, 23 tests |

`extract()` is **byte-for-byte unchanged** — it now wraps a private
`extractGraph()` holding the original switch verbatim. Verified by the reviewer
diffing the two bodies. All five call sites are untouched and `entity.graph.json`
does not change a byte.

## The finding this phase turns on

**The plan's central technical premise was false, and it was false in the
direction that ships a permanently stale graph.**

Rev 1 claimed `detectProvider()`'s walk (`[.csproj,.cs,.ts,.tsx]`) is a superset
of what the two readers read, so one digest over that list would suffice. It is
not. `node.ts:167`'s walk is a **fallback**; the primary path is
`ts.createProgram(parsed.fileNames)` driven by a `tsconfig.json` read at
`node.ts:119`. So:

- edit `tsconfig.json` → the file set *and* the compiler options change, digest does not
- add a nested `tsconfig.json` → `nodeRootFor` (`merge.ts:50,67`) re-roots the whole TS half, digest does not move
- `detectProvider` branches on `existsSync(package.json | tsconfig.json)` (`detect.ts:41-43`) — the **provider itself** can flip
- `.mts`/`.cts` are read by the program and match no walk

The failure mode is not the conservative one rev 1 claimed. An under-broad digest
does not over-invalidate; it serves a stale graph forever, with no escape short of
DELETE and re-add, and makes psq assert facts about a repo that are no longer
true. `digestOf` therefore **owns its own list** and `detect.ts:32`'s list is
documented as a subset, not the source of truth.

## The correction most worth remembering

**Three times this phase, a claim about what a gate holds was made from reading
and was wrong — and each was falsifiable in minutes by the mutation technique
already in hand.**

1. "`apps/*/test` is now covered" — `tsconfig.json` already excludes `apps/web`,
   so `apps/web/test/*` is typechecked by **nothing**, before or after.
2. "A8 tests the length framing" — A8's pair separates on the **NUL alone**. A
   mutant keeping `relpath + NUL + contents` and dropping only the length passed
   all 18 tests.
3. "Testing the ordering race would need a write from another thread" —
   `extractGraph` is module-private and unspiable, but `digestOf` is an
   **imported binding** and therefore mockable. The deterministic test is ~35
   lines with no threads and no sleeps.

Each was caught by a reviewer that measured instead of reading, and each was
recorded as a retraction rather than quietly fixed. The generalisable form:
**a claim about what a gate holds is itself a claim, and it is cheap to measure.**
The repo already knew that a gate can pass by finding nothing
([[negative-gates-need-positive-control]]); this phase adds that the *explanation*
of why a gate bites is the part that goes unverified.

## Gates

Baseline `e7adccd`: `pnpm test` 342 (`284 | 58`), typecheck clean.

| Gate | Result |
|---|---|
| A1 `pnpm typecheck` | exit 0, 0 errors, all four projects, with test dirs newly in scope |
| A2 `PSQ_NO_CORPUS=1 pnpm test` | **307 passed \| 58 skipped (365)**, 0 failed |
| A3 `pnpm test` | **365 passed (365)**, 0 failed |
| A4 determinism, run first | 2 passed — incl. two identical trees at **different absolute paths** digesting equal |
| A5 sensitivity ×6 extensions | 6 passed |
| A6 add / delete / **rename** | 5 passed |
| A7 negative (README, node_modules) + mutate-after control | 3 passed |
| A8 NUL framing | 2 passed |
| A8b length framing | 3 passed |
| A10 digest-before-extract ordering | 2 passed |
| A9 `git show --stat` | 8 / 6 / 4 paths across the three commits, each matching its scope |

**Skipped held at 58** at every step, across all three amendments. A drop there
means the private corpus config vanished, not that something improved.

Mutation measurements, each mutant killing exactly its own gate across the whole
suite, reproduced independently by the reviewer:

```
contents only                  -> 2 failed | 305 passed | 58 skipped   (A6 renames)
relpath dropped, framing kept  -> 2 failed | 305 passed | 58 skipped   (A6 renames)
length dropped, NUL kept       -> 1 failed | 306 passed | 58 skipped   (A8b)
graph-first ordering           -> 1 failed | 306 passed | 58 skipped   (A10)
constant from real digestOf    -> 13 of 23 in digest.test.ts
```

## What G-b needs to know

- **Path-awareness of the digest lives in exactly two assertions**: A6's two
  renames in `packages/extract/test/digest.test.ts`. Verified twice, including
  with a mutant that drops only the relpath and keeps the framing. Delete or
  weaken either and the digest silently stops being path-aware with 363 other
  tests still green. **Do not "tidy" that file.**
- **`vi.mock` in `digest.test.ts` is file-wide, not per-test.** Every gate in
  that file runs through a wrapper that delegates to the real `digestOf`. Proved
  transparent (a constant returned from the real implementation reddens 13 of
  23), but it **hard-codes arity 1**. If G-b widens `digestOf`'s signature, the
  wrapper silently drops the extra argument and every test stays green while
  testing a one-argument call. Fix with
  `(...args: Parameters<typeof actual.digestOf>)` in G-b's first commit.
- **`files.ts:91-92` still has a wrong comment** — says "All **eleven** of the
  other entries" then lists **twelve**, including `node_modules`, which is not an
  "other" entry. Third revision of the same comment, carried deliberately rather
  than reopening G-a. Fix it in G-b's first commit.
- **`digestOf("/gone")` returns the empty-tree sha256 rather than throwing**, and
  an unreadable file hashes the same as a deleted one (`files.ts:114-117` drops
  the entry, path included). This is exactly why **D-Gb-4 step 2's
  path-is-a-directory check must stay strictly before the fingerprint
  comparison** — otherwise a vanished repo reads as "a repo that changed" and
  triggers a doomed re-extract instead of `missing`.
- **`walk`'s 20,000-file cap now binds the digest before any extraction walk**,
  because `DIGEST_EXTENSIONS` is ~2.5× broader than `detect.ts:32`'s list. Past
  the cap, changes never move the digest, and A4's cross-tree determinism stops
  being guaranteed because truncation follows `readdirSync` order. Unreachable on
  the corpus (max 260 files). Recorded, not fixed.
- **`EXTRACTOR_VERSION` ships untested by construction** — nothing observable
  changes until G-b puts it in an envelope. **B9 is the gate that makes it
  observable**, and it is already in the plan. It is also a discipline control:
  nothing can catch a forgotten bump, and forgetting one means serving
  old-extractor graphs after a `scripts/deploy.sh`.
- **Two staleness gaps stay open by choice**, both documented in code: `.d.ts`
  and lib files resolved by `ts.createProgram` from inside `node_modules` (which
  `walk` skips), and sources under `walk`'s other `SKIP` entries — a tsconfig
  whose `include` reaches generated code under `build/` or `.next/` gives a
  program file set the digest cannot see. Narrowing `SKIP` in `digestOf` alone
  would make the digest and the readers disagree about what the repo is.
- **`naiveDigest` and `unlengthedDigest` are hand-written duplicates of the
  framing.** If `digestOf`'s framing is ever reordered, both keep
  collide/not-collide-ing exactly as asserted while no longer being statements
  about `digestOf` at all.
- **A10's fixture depends on its tsconfig `include` being a glob.** Rewriting it
  to an explicit `files: [...]` list turns A10 red, and it will read as an
  ordering regression.
- `apps/web/test/*` is typechecked by nothing — root `tsconfig.json` excludes
  `apps/web`, which beats the new include, and `apps/web/tsconfig.json` covers
  only `src/**` and `vite.config.ts`. G-b's three new test files land in
  `apps/server/test`, which **is** covered.
- Unchanged from Phase F and still true: never run `pnpm test:e2e` casually — it
  runs `build:web`, which empties the `apps/web/dist` the live server serves from
  disk. Unit tests go where the plan's file list says. The private corpus config
  is the only copy of the ground truth.

## Starting G-b

Read this file, then `plan.md` from `# G-b — the store and rehydrate`. The
design is D-Gb-1 … D-Gb-8 and the gates are B1 … B21; both already incorporate
the rev-1 review that caught the `stateDir === undefined` hazard (`pnpm test`
would otherwise have written into the live store), the DELETE-cannot-reach-an-
unloaded-entry hole, and the shutdown-erases-the-store trap.

The first commit of G-b carries the two items listed above.
