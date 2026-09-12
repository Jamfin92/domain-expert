# Phase G-a audit — the digest

Branch `g-a-digest`, cut from `master` at `e7adccd`. Implements plan rev 2
**G-a only**, including **Amendment 1** (2026-09-12). No part of G-b was
touched: no `store.ts`, no `workspace.ts`, no server change.

This phase halted once, at gate A1, exactly as the plan's file-4 note requires.
Amendment 1 resolved it (option 2: keep the full widening, suppress in
`auth.test.ts`). The halt and its measurement are kept below rather than tidied
away, because the gate working as designed is part of the record.

## Files changed

| # | File | Why |
|---|---|---|
| 1 | `packages/extract/src/files.ts` | D-Ga-1 / D-Ga-2: `DIGEST_EXTENSIONS`, `digestOf(root)` |
| 2 | `packages/extract/src/detect.ts` | D-Ga-2 / D-Ga-3: `extractWithDigest()`, `EXTRACTOR_VERSION`; `extract()` becomes a wrapper |
| 3 | `packages/extract/src/index.ts` | export `digestOf`, `DIGEST_EXTENSIONS`, `extractWithDigest`, `EXTRACTOR_VERSION` |
| 4 | `tsconfig.json` | `include` gains `packages/*/test/**/*.ts` and `apps/*/test/**/*.ts` |
| 5 | `apps/server/test/auth.test.ts` | Amendment 1: two `@ts-expect-error` lines with reasons. No behavioural change |
| 6 | `packages/extract/test/digest.test.ts` | new — gates A4–A8 |
| 7 | `feature-research/g-local-persistence/plan.md` | the plan (was untracked) |
| 8 | `feature-research/g-local-persistence/audit-a.md` | this file |

`progress-a.md` is deliberately absent: James writes it after review.

## What changed, per file

### 1. `packages/extract/src/files.ts`
- `const NUL = Buffer.from([0])`, the framing separator.
- `export const DIGEST_EXTENSIONS` — D-Ga-1's ten entries verbatim
  (`.cs .csproj .ts .tsx .mts .cts .js .jsx tsconfig.json package.json`).
  `walk`'s matcher is `endsWith`, so the two whole filenames work as suffixes.
  The doc comment carries D-Ga-1's reasoning: `detect.ts`'s list is recorded as
  a **subset**, not the source of truth; the TS reader's walk is a fallback and
  the real file set comes from `tsconfig.json`; `detectProvider` can flip on a
  file no walk returns; over-invalidating costs a re-extract, while missing a
  file serves a permanently stale graph (CLAUDE.md rule 2). The `node_modules`
  `.d.ts` limit is stated in the comment, not silently accepted.
- `export function digestOf(root): string` — `walk(root, DIGEST_EXTENSIONS)` in
  `walk`'s existing sorted order, sha256 over
  `relpath + NUL + byteLength + NUL + contents` per entry. A file that vanishes
  between the walk and the read is skipped, not thrown on.

### 2. `packages/extract/src/detect.ts`
- `export const EXTRACTOR_VERSION = 1`, with D-Ga-3's caveat in the comment:
  it is a discipline control, nothing enforces the bump, and the auto-derived
  alternative was considered and rejected.
- `extractWithDigest(root): { graph, digest }`, calling `digestOf` — never an
  inlined second hash.
- The original `switch` body moved **verbatim** into a private `extractGraph()`;
  `extract()` is now `return extractGraph(repoRoot)`. Signature unchanged, both
  production call sites and the three test sites untouched, `entity.graph.json`
  unchanged (A3 covers this: the existing 342 tests all still pass).

### 5. `apps/server/test/auth.test.ts`
Two `@ts-expect-error` comments, immediately above the `.set("Authorization", […])`
calls formerly at `:61` and `:66`. `@ts-expect-error` rather than `@ts-ignore`
or a cast, per Amendment 1: it fails the build if `@types/supertest` ever
permits the array, so it invalidates itself rather than outliving its reason.
The comment names what the test proves (Node keeps the first `Authorization`
line, discards the second) and that only the declaration disallows it. No
executable line changed.

## Gates — measured results

Baseline at `e7adccd`: `pnpm test` 342 (`284 passed | 58 skipped`), typecheck
clean. G-a adds **15 tests**, all in `digest.test.ts`.

| # | Result |
|---|---|
| A1 | `pnpm typecheck` **exit 0, 0 errors**, all four projects (`tsconfig.json`, `e2e/tsconfig.json`, `@psq/web`, `@psq/desktop`), with `packages/*/test` and `apps/*/test` now in scope |
| A2 | `PSQ_NO_CORPUS=1 pnpm test` → **299 passed \| 58 skipped (357)**, 26 files passed \| 3 skipped. 0 failed. 284 + 15 = 299 ✓ |
| A3 | `pnpm test` → **357 passed (357)**, 29 files passed, 0 skipped, 0 failed. 342 + 15 = 357 ✓ |
| A4 | **2 passed \| 13 skipped.** Determinism holds on a repeat call and across two identical trees in different temp directories |
| A5 | **6 passed \| 9 skipped.** One flipped byte moves the digest in each of `.cs`, `.ts`, `.tsx`, `.csproj`, `tsconfig.json`, `package.json` |
| A6 | **2 passed \| 13 skipped.** Adding a `.ts` and deleting a `.ts` each move the digest |
| A7 | **3 passed \| 12 skipped.** Editing `README.md` and adding `.ts`/`package.json` under `node_modules/` each leave the digest unchanged, plus a positive control |
| A8 | **2 passed \| 13 skipped** (1 of them the control). The naive concat collides; `digestOf` does not |
| A9 | `git show --stat` = **8 paths**, exactly the file list above. Recorded below |

### A1 — ran twice, failed twice, and both failures were real

**First run** (widening only, before any test file existed): **exit 2, 2
errors**, both `TS2769` in `apps/server/test/auth.test.ts:61,66`, both
pre-existing and in a file this phase had not touched. Per plan file 4 the build
**halted and reported** rather than fixing them. Isolated against an otherwise
unmodified config: `packages/*/test/**/*.ts` alone → **0 errors**;
`apps/*/test/**/*.ts` → **2**. That measurement is what Amendment 1 decided on.

**Second run** (after the suppressions and the new test file): **exit 2, 1
error** — `packages/extract/test/digest.test.ts(47,25): error TS2532: Object is
possibly 'undefined'`, in a `Buffer` index read inside this phase's own test
helper. Amendment 1's "a third error is a stop-and-report" clause governs
*pre-existing* errors surfaced by the widening; this one was mine, written in
this phase, so it was fixed here rather than reported: the helper now bounds-
checks and throws a named error on an empty fixture.

Worth recording plainly: **that error is the widening paying for itself on its
first day.** Under the old `include`, a new test file in `packages/*/test` was
invisible to the only lint gate the repo has, and this bug would have shipped
inside the very gate meant to prove the digest works.

**Third run: exit 0, 0 errors.** A4, A2 and A3 were re-measured after that edit;
the numbers above are the post-edit ones.

### A4 ran before A5–A8, and is the reason they mean anything

Stated explicitly because the plan asks for it: a hash that changed on every
call would pass A5, A6 and A8 and fail only A4. A4 passed, so the "it moved"
assertions are evidence of sensitivity rather than of noise. A4 is also
stronger than the plan required — beyond repeating the call on one tree, it
asserts two identical trees at **different absolute paths** digest equal, which
is the property G-b's cross-time comparison actually depends on and which a
digest that folded the root path into the hash would fail.

### A7 carries a positive control the plan did not ask for

A7 is a negative gate: it passes by finding no change. A negative gate can pass
because the mechanism broke and now sees nothing at all. So a third test edits
`README.md`, asserts the digest is unchanged, then mutates a `.ts` **in the same
tree via the same call** and asserts it moves. Without it, a `digestOf` that
returned a constant would pass both A7 cases.

### A8 — the framing is tested, not assumed

The pair: one file `a.ts` containing `"b.tsZ"`, versus two files `a.ts` (empty)
and `b.ts` containing `"Z"`. Both concatenate to `a.tsb.tsZ` under a naive
`relpath + contents` scheme. The test implements that naive digest locally over
the same `walk`, asserts it **collides**, then asserts `digestOf` does not. The
collides half is the control: without it the gate passes whether the NUL/length
framing does anything or not.

### A9 — `git show --stat`

Two commits, per the Phase F convention: the feature commit `cfd8892`, then the
phase records on top. `git diff --stat master..HEAD` over both:

```
 apps/server/test/auth.test.ts                   |  10 +
 feature-research/g-local-persistence/audit-a.md | 191 ++++++++++++
 feature-research/g-local-persistence/plan.md    | 399 ++++++++++++++++++++++++
 packages/extract/src/detect.ts                  |  33 +-
 packages/extract/src/files.ts                   |  71 ++++-
 packages/extract/src/index.ts                   |  10 +-
 packages/extract/test/digest.test.ts            | 158 ++++++++++
 tsconfig.json                                   |   2 +
 8 files changed, 870 insertions(+), 4 deletions(-)
```

Eight paths, matching the amended file list exactly. The plan file is included
deliberately — the Phase F lesson, where "exactly 18 paths" left a shipped plan
untracked.

### Secret sweep (not a numbered gate; carried forward from Phase F)

The staged diff was swept for the 7 absolute corpus paths in
`test/corpus.local.json` and their leaf directory names (14 identifying strings
in all), plus `*.ts.net` hostnames and bare IPv4 addresses: **no hits**. The
sweep's positive control fires on a planted token that is genuinely absent from
the diff, so a clean result means the sweep looked rather than that it was
blind. A first, cruder sweep tokenised the whole corpus JSON and reported 29
false hits on generic words like `test` and `health`; it was narrowed to
path-like values rather than trusted.

## Where the plan was wrong, imprecise, or incomplete

1. **Plan file 4 anticipated the collision but not its location.** It warned
   that widening `include` might surface pre-existing errors; it did not say
   which half was at risk. It is `apps/*/test`, and G-b adds three new test
   files under exactly that glob. Now measured and recorded in Amendment 1.
2. **Amendment 1's "third error is a stop-and-report" needs a qualifier.** As
   written it does not distinguish a pre-existing error from one this phase
   wrote. Taken literally it would have halted the build over a bug in G-a's own
   new test file — which is the opposite of what a lint gate is for. Read as
   scoped to pre-existing errors, which is how it was applied.
3. **The plan's gate list has no `EXTRACTOR_VERSION` gate, and cannot have
   one.** D-Ga-3 says so and it is true: nothing observable changes until G-b
   puts the constant in an envelope. The constant ships here untested by
   construction. This is the known cost recorded in "Risks and known limits",
   restated so review does not read its absence as an oversight.
4. Nothing in D-Ga-1, D-Ga-2 or D-Ga-3 proved unimplementable. No gate turned
   out vacuous or unrunnable, and none was substituted with a weaker one.

## Open risks carried into G-b

- **Dependency-type changes do not invalidate the digest** (D-Ga-1's stated
  limit). `ts.createProgram` resolves `.d.ts` under `node_modules`, which `walk`
  skips. Bounded and recorded in the code comment, not just here.
- **`EXTRACTOR_VERSION` is discipline.** Forgetting the bump after an extraction
  change serves old-extractor graphs. No gate can catch it.
- **Over-invalidation is chosen, not accidental.** `.js`, `.jsx` and
  `package.json` are hashed unconditionally though only some configurations read
  them. Costs a ~1.3s re-extract; the opposite error is a permanently stale
  graph.
- The rehydrate-cost measurement belongs to G-b and was not taken here.

## Constraints observed

`pnpm test:e2e` and `pnpm build:web` were never run, so the `apps/web/dist` the
live server serves from disk is untouched. The service was not restarted,
deployed, or otherwise touched: no `scripts/deploy.sh`, no `launchctl`. Nothing
was pushed. No corpus path, tailnet host or token appears in any changed file,
in this audit, or in the commit message. The new tests build their own fixtures
in `mkdtempSync` temp directories and clean up in `afterEach`; they read no
corpus and write nothing outside `tmpdir()`.

---

# Amendment 2 — review follow-ups

Appended, not merged into the record above: the original audit stands as written,
including the parts Amendment 2 corrects. G-a review returned **Ship, no blocking
issues**; these are the four non-blocking items, folded in as a follow-up commit
on `master` rather than an amend.

Two of them were found by **mutation-testing the controls**, not by reading the
diff — including one real ordering bug that every one of my 15 tests passed over.
That is the headline of this round and the lesson worth carrying into G-b: my own
gates were green on code that could serve a permanently stale graph.

## Files changed in this round

| File | Why |
|---|---|
| `packages/extract/src/detect.ts` | item 1: hoist `digestOf` **before** `extractGraph` |
| `packages/extract/src/files.ts` | item 3: document the rest of `walk`'s `SKIP` list as the same staleness class |
| `packages/extract/src/index.ts` | item 4: unexport `DIGEST_EXTENSIONS` |
| `packages/extract/test/digest.test.ts` | item 2: three new A6 tests — two renames and a byte-identity control |
| `feature-research/g-local-persistence/plan.md` | Amendment 2, rewritten A6, two new Risks, D-Gb-4 step 2 ordering |
| `feature-research/g-local-persistence/audit-a.md` | this section |

## 1. The digest is now taken before extraction

`extractWithDigest` was:

```ts
return { graph: extractGraph(repoRoot), digest: digestOf(repoRoot) };
```

Object-literal properties evaluate in source order, so the graph was built from
the bytes at T0 and stamped with a fingerprint of the bytes at T0+1.3s. A file
edited inside that window produced an old graph carrying a current digest, which
a later comparison would call fresh — **permanently stale, the exact class
D-Ga-1 exists to prevent**. Now:

```ts
const digest = digestOf(repoRoot);
return { graph: extractGraph(repoRoot), digest };
```

Digest-first inverts the race: the graph may contain bytes newer than the
fingerprint, so a later comparison mismatches and re-extracts. An unnecessary
re-extract costs ~1.3s; a stale graph costs the premise of the tool. The
reasoning is in the code, not only here, because the correctness of this function
is entirely in the order of two statements and nothing about reading it makes
that obvious.

**No gate in G-a catches this, and none was added.** The window is a real-time
race against a 1.3s extraction; a test would need to write into the tree from
another thread mid-extract. G-b's B5 (cross-time parity) and B8 (stale detection
with an observable graph change) are where this becomes testable. Recording the
gap rather than claiming coverage.

## 2. A6 now holds the property it claims — verified by mutation

The reviewer's finding, reproduced: **a `digestOf` that hashes contents only,
dropping the relpath entirely, passed all 15 of the original tests.** The add and
delete cases both move the content stream, so neither separates a path-aware
digest from a contents-only one.

Three tests added:

- rename `src/schema.ts` → `src/schema2.ts` with byte-identical contents;
- move `tsconfig.json` one directory down, bytes unchanged — the load-bearing
  instance, because `nodeRootFor` (`merge.ts:50,67`) scans one level down for a
  nested `tsconfig.json` and re-roots the whole TS half of a fullstack graph on
  finding one. A contents-only digest calls that repo unchanged while extraction
  produces a different graph;
- a control asserting the renamed file really is byte-identical, so the two
  above cannot pass for the wrong reason.

### The mutation measurement

I dropped the relpath, length and NUL framing from `digestOf` (leaving
`h.update(contents)`), ran the suite, then restored. Measured:

| gate | under the contents-only mutant |
|---|---|
| A4 | 2 passed — still green |
| A5 | 6 passed — still green |
| **A6** | **2 failed \| 3 passed** — both new renames fail; the original add/delete pair still passes |
| A7 | 3 passed — still green |
| A8 | 2 passed — still green |
| whole file | **2 failed \| 16 passed (18)** |

Exactly the two new tests fail and nothing else does. That is the measurement
the instruction asked for: a rename test that passed with and without the relpath
would be worth nothing, and this one is not.

Two things fall out of it worth recording. The reviewer's claim that all 15
original tests pass the mutant is **confirmed** — 16 of 18 pass, and the 2 that
fail are both new. And **A8 passes the mutant too**: its collision pair separates
under a contents-only hash (`"b.tsZ"` vs `"Z"`), so A8 tests the framing of the
length field but never held the relpath property either. A6 is now the only gate
holding it.

Restoration verified by re-reading the five `h.update` lines at
`files.ts:127-131`, not by assuming the copy-back worked.

## 3 and 4. The two small ones

**Item 3.** The `DIGEST_EXTENSIONS` comment recorded only the `node_modules`
limit. It now covers the rest of `SKIP` (`dist`, `build`, `bin`, `obj`, `.next`,
`coverage`): a tsconfig whose `include` reaches generated sources there hands the
program a file set the digest cannot see, and a change confined to those
directories leaves a permanently stale graph. I also recorded **why it stays
open**, which the amendment did not ask for but which the next reader will:
hashing build output would re-invalidate on every build, and `SKIP` is shared
with the extraction walks, so narrowing it in `digestOf` alone would make the
digest and the readers disagree about what the repo is.

**Item 4.** `DIGEST_EXTENSIONS` unexported from the package index, with a comment
pointing at the `merge.test.ts` precedent. `digest.test.ts:6` already imported it
from `../src/files.js`, so nothing changed at the call site. It was the one symbol
in the G-a diff the plan had not named — worth noting as a process point: the
file list named the files, and a symbol slipped through inside one of them.

## Gates — re-measured after all four items

Full suite, not just the digest tests, since item 1 touches `extractWithDigest`.
Baseline to beat: 357 (`299 | 58` under `PSQ_NO_CORPUS=1`). G-a now adds **18**
tests rather than 15.

| # | Result |
|---|---|
| A1 | `pnpm typecheck` **exit 0, 0 errors**, all four projects |
| A2 | `PSQ_NO_CORPUS=1 pnpm test` → **302 passed \| 58 skipped (360)**, 26 files passed \| 3 skipped, 0 failed. 299 + 3 = 302 ✓ |
| A3 | `pnpm test` → **360 passed (360)**, 29 files, 0 skipped, 0 failed. 357 + 3 = 360 ✓ |
| A4 | **2 passed \| 16 skipped** — run first again |
| A5 | **6 passed \| 12 skipped** |
| A6 | **5 passed \| 13 skipped** (was 2; +2 renames, +1 byte-identity control) |
| A7 | **3 passed \| 15 skipped** |
| A8 | **2 passed \| 16 skipped**, one the naive-collides control |
| A9 | **6 paths**, recorded below |

**The skipped count is 58**, the number observed, unchanged from baseline.

## The A1 correction, accepted

Amendment 2 is right and my original audit overstated the widening's reach. I
wrote that `apps/*/test` was now covered; `tsconfig.json` already excludes
`apps/web`, so `apps/web/test/*` is typechecked by nothing, before or after. The
13 files that entered the program are all under `packages/*/test` and
`apps/server/test`. No regression either way, and G-b's three new files land in
covered territory — but the claim as I wrote it was broader than what I measured,
which is the same failure shape the plan's own "rev 1 got wrong" list opens with.

## Still open after this round

- The **digest-before-extract race has no G-a gate** (item 1 above). It becomes
  testable at B5/B8.
- **`walk`'s 20,000-file cap binds the digest sooner than any extraction walk**,
  and past it A4's cross-tree determinism stops being guaranteed because
  truncation follows `readdirSync` order. Now in the plan's Risks; unreachable on
  the measured corpus (max 260 files).
- **Unreadable is indistinguishable from absent**: `digestOf("/gone")` returns
  the empty-tree sha256 rather than throwing. Harmless in G-a, and it is why
  D-Gb-4 step 2 now requires the `missing` check strictly before the fingerprint
  comparison — otherwise a vanished repo reads as "a repo that changed" and
  triggers a doomed re-extract instead of being marked missing.
- `EXTRACTOR_VERSION` remains untested by construction until G-b.

## Constraints observed

`pnpm test:e2e` and `pnpm build:web` were not run in this round either; the
service was not restarted, deployed or touched; nothing pushed. The diff was
swept again for corpus paths, `*.ts.net` hosts and tokens, with a positive
control — result below. The mutation experiment touched only the working tree
and was reverted before commit; the committed `files.ts` is the framed digest.

---

# Amendment 3 — closing round

Appended; the Amendment 1 and 2 records above stand unchanged, including the two
claims this section retracts.

Both substantive items this round are **corrections to assertions I made in the
Amendment 2 audit and did not test**. Recording that plainly, because it is the
same shape twice: I explained why a gate held a property, and why another
property could not be gated, from reading rather than from measurement. Both
explanations were wrong, and both were falsifiable in minutes with the mutation
technique I had already used elsewhere in the same round.

All mutation testing this round ran in a throwaway `git worktree` at
`HEAD` (`28736d8`), never in this checkout, which is the live production deploy.
The worktree was removed and `git worktree list` confirmed clean.

## Files changed in this round

| File | Why |
|---|---|
| `packages/extract/src/files.ts` | item 3: name all twelve `SKIP` entries |
| `packages/extract/test/digest.test.ts` | A8b (3 tests), A10 (2 tests), item 4 relabel |
| `feature-research/g-local-persistence/plan.md` | Amendment 3, gates A8b and A10 |
| `feature-research/g-local-persistence/audit-a.md` | this section |

No change to `detect.ts` or `index.ts`: Amendment 2 left both correct, and A10
now proves the `detect.ts` ordering rather than asserting it.

## 1. A8b — retraction and fix

**What I wrote in Amendment 2:** "A8 tests the framing of the length field but
never held the relpath property." The first half is **wrong**. A8's pair
(`a.ts`=`"b.tsZ"` versus `a.ts`=`""` + `b.ts`=`"Z"`) separates on the **NUL
alone**: with the separator present and no length at all, `"b.tsZ"` and `"Z"`
still differ. A8 held the separator and nothing else, and the length field was
gated by nothing.

A8b uses the reviewer's pair: one file `a.ts` containing `b.ts\0Z`, versus
`a.ts` (empty) + `b.ts` containing `Z`. The payload supplies its own NUL, so
both render as `a.ts\0b.ts\0Z` once the length is gone. Only the byte count
separates them. Three tests: the collision control on a length-free digest, the
real assertion on `digestOf`, and a third asserting **A8's own pair does not
hold the length** — the finding turned into an executable claim rather than a
sentence in an audit that the next round has to re-derive.

### Mutation measurement — drop only the length

`h.update(relpath); h.update(NUL); h.update(contents)`, length removed, framing
otherwise intact:

| scope | result |
|---|---|
| `digest.test.ts` | **1 failed \| 22 passed (23)** |
| whole suite | **1 failed \| 306 passed \| 58 skipped (365)** |

The single failure is `A8b: digestOf does not collide on the NUL-bearing pair`.
Nothing else in the repository moves — which is the measurement that proves A8b
is load-bearing and confirms the reviewer's claim that the length-dropped mutant
passed all 18 previous tests.

## 2. A10 — retraction and fix

**What I wrote in Amendment 2:** "No gate in G-a catches this, and none was
added. The window is a real-time race against a 1.3s extraction; a test would
need to write into the tree from another thread mid-extract." **Wrong, and the
reasoning was lazy.** `extractGraph` is module-private and cannot be spied, but
`digestOf` is an *imported binding* in `detect.ts` and is therefore mockable. A
partial `vi.mock` whose `digestOf` writes into the fixture before delegating
reproduces the race exactly, deterministically, with no threads and no sleeps.
The deferral to B5/B8 was a choice I presented as a constraint.

A10 installs a hook that writes a new `CREATE TABLE` into the fixture at the
instant the digest is taken, then asserts the new entity appears in the returned
graph. Digest-first means extraction runs after the write and must see it;
graph-first means it cannot. Two tests: the ordering assertion (which also
asserts the hook fired exactly once, so a mock that silently failed to apply
reads as a broken premise rather than an ordering bug), and a control asserting
the untouched fixture yields exactly `["voyages"]` — without it, an extractor
that invented the entity, or a fixture that already declared it, would pass
whatever the ordering.

The mock wrapper delegates to the real `digestOf` and does nothing unless a test
installs a hook, so the other 21 tests in the file still exercise the genuine
implementation.

### Mutation measurement — revert to graph-first

Restoring `return { graph: extractGraph(repoRoot), digest: digestOf(repoRoot) }`:

| scope | result |
|---|---|
| `digest.test.ts` | **1 failed \| 22 passed (23)** |
| whole suite | **1 failed \| 306 passed \| 58 skipped (365)** |

The single failure is A10 itself. Both directions verified as instructed: green
against the shipped digest-first order, red against the reverted one.

This also closes the gap the amendment named — **`extractWithDigest` was
executed by nothing in the 360-test suite**, the one function whose entire
correctness is the order of two statements. It now has two tests.

## 3. The `SKIP` comment now names all twelve

It listed six. It now names all twelve entries — `node_modules`, `bin`, `obj`,
`.git`, `dist`, `build`, `.next`, `.vs`, `TestResults`, `coverage`, `.venv`,
`__pycache__` — checked against the live `SKIP` set at `files.ts:9-12` rather
than copied from the amendment text, since copying the amendment faithfully is
what produced the error the first time.

## 4. A6's byte-identity test relabelled

Renamed from "A6 control: …" to "A6: … (insurance, not a control)", with a
comment saying why: the renames write bytes read straight back from the same
file with no helper in between, so nothing short of the filesystem corrupting
data can redden it. Kept as cheap insurance against a future refactor
introducing such a helper, and named so it is not mistaken for the equal of the
genuinely load-bearing A7 and A8b non-vacuity tests.

## Where the relpath property stands now

Re-measured, because the suite grew by 5 tests since the reviewer's count. The
contents-only mutant against the whole suite:

**2 failed | 305 passed | 58 skipped (365)** — the two failures are still
exactly Amendment 2's two renames. A8b and A10 do not hold the relpath property,
so the reviewer's warning is unchanged and should carry into G-b: **two tests in
the entire repository hold it, and weakening either silently makes the digest
path-blind.**

Summarised, each mutant now kills exactly its own gate and nothing else:

| mutant | fails | whole-suite result |
|---|---|---|
| contents only (no relpath, no framing) | A6 ×2 renames | 2 failed \| 305 passed \| 58 skipped |
| `relpath + NUL + contents` (no length) | A8b | 1 failed \| 306 passed \| 58 skipped |
| graph-first ordering | A10 | 1 failed \| 306 passed \| 58 skipped |

After each mutant the file was restored from the real checkout and re-verified —
`files.ts:129-133` re-read for the five `h.update` lines, `detect.ts:83` for the
hoisted `const digest`, and the 23-test file re-run green — rather than assuming
the copy-back worked.

## Gates — final measured results

Baseline to beat: 360 (`302 | 58` under `PSQ_NO_CORPUS=1`). G-a now adds **23**
tests.

| # | Result |
|---|---|
| A1 | `pnpm typecheck` **exit 0, 0 errors**, all four projects |
| A2 | `PSQ_NO_CORPUS=1 pnpm test` → **307 passed \| 58 skipped (365)**, 26 files passed \| 3 skipped, 0 failed. 302 + 5 = 307 ✓ |
| A3 | `pnpm test` → **365 passed (365)**, 29 files, 0 skipped, 0 failed. 360 + 5 = 365 ✓ |
| A4 | **2 passed \| 21 skipped** — run first again |
| A5 | **6 passed \| 17 skipped** |
| A6 | **5 passed \| 18 skipped** |
| A7 | **3 passed \| 20 skipped** |
| A8 | **2 passed** (assertion + naive-collides control) |
| A8b | **3 passed \| 20 skipped** (assertion + 2 controls) |
| A10 | **2 passed \| 21 skipped** (assertion + fixture control) |
| A9 | **4 paths**, recorded below |

**The skipped count is 58** — observed, unchanged across all three amendments.
2 + 6 + 5 + 3 + 2 + 3 + 2 = 23 accounts for every test in the file.

## Still open going into G-b

Unchanged from Amendment 2 except where noted:

- **Only two tests hold the relpath property** (measured again above). New, and
  the most important thing to carry forward.
- `walk`'s 20,000-file cap binds the digest before any extraction walk; past it
  A4's cross-tree determinism stops being guaranteed.
- `digestOf("/gone")` returns the empty-tree sha256 rather than throwing — why
  D-Gb-4 step 2 needs the `missing` check strictly before the fingerprint
  comparison.
- `EXTRACTOR_VERSION` remains untested by construction until G-b.
- The `SKIP` staleness class stays open by choice; the reasoning is in the code.
- **Closed this round:** the ordering race (A10) and the length framing (A8b)
  are no longer un-gated, and `extractWithDigest` is no longer unexecuted.

## Constraints observed

No `pnpm test:e2e`, no `pnpm build:web`, service not restarted or touched,
nothing pushed. Mutation testing ran only in a detached worktree under the
session scratchpad, removed afterwards with `git worktree list` verified clean.
Diff swept for corpus paths, `*.ts.net` hosts and tokens with a positive
control. The A10 fixture is built in a temp directory and reads no corpus.
