# Phase A — AUDIT (items A1, A2, A3, A4, A6; A5 deliberately not done)

Plan: `feature-research/green-and-push/plan.md` (verbatim copy of the approved
plan). Branch `m5b-component-attribution`. **Everything left uncommitted.**

## Files changed

1. `packages/extract/test/node.test.ts` — modified
2. `packages/extract/test/dotnet.test.ts` — modified
3. `test/fixtures.ts` — modified (docblocks only)
4. `test/corpus.local.example.json` — modified (one value)
5. `test/corpus.local.json` — modified (one value; **gitignored, untracked**)
6. `feature-research/green-and-push/plan.md` — new
7. `feature-research/green-and-push/audit.md` — new (this file)
8. `feature-research/green-and-push/progress.md` — new

`git diff --stat` (tracked, non-record files):

```
 packages/extract/test/dotnet.test.ts |  3 ++-
 packages/extract/test/node.test.ts   | 22 +++++++++++++++++++---
 test/corpus.local.example.json       |  2 +-
 test/fixtures.ts                     |  6 ++++++
 4 files changed, 28 insertions(+), 5 deletions(-)
```

Nothing outside the plan's "Files touched" list was modified. No `src/`, no
fixture, no `tsconfig.json`, no `README.md`, no `MINI_*` test.

## Baseline (before any edit)

| Command | Result |
|---|---|
| `pnpm test` | `Tests  2 failed \| 260 passed (262)` — both in `packages/extract/test/node.test.ts` repoD block (`:50` relations, `:60` house-style warning) |
| `PSQ_NO_CORPUS=1 pnpm test` | `Tests  204 passed \| 58 skipped (262)` |

The `:50` failure was 7 received ids vs 5 pinned. The `:60` failure was a
pinned warning string whose embedded table count had grown.

## A1 — edits

**`packages/extract/test/node.test.ts`**

- `:49-63` (repoD, "infers relations from `<table>_id`…"): the ordered
  `expect(g.relations.map((r) => r.id)).toEqual(exp.relationIds!)` became
  ```ts
  const ids = g.relations.map((r) => r.id);
  expect(ids).toEqual(expect.arrayContaining(exp.relationIds!));
  expect(ids.length).toBeGreaterThanOrEqual(exp.relationIds!.length);
  ```
  with a comment in the tone of the routes floor at `:88-93`, saying why a
  permanently-red gate verifies nothing. The `not.toContain(absentForeignKey)`
  and `every(source === "inferred")` lines are unchanged and still follow it.
- `:69-71` (repoD house style): `expect(g.warnings).toContain(...)` became
  `expect(g.warnings.some((w) => w.startsWith(exp.houseStyleWarning!))).toBe(true);`
  with a two-line comment saying the pinned value stops before the count.
- `:124-131` (repoE, "links on a natural key…"): same floor treatment as
  repoD, existing comment kept, new comment cross-referencing repoD.

**`packages/extract/test/dotnet.test.ts:133-135`** — `expect(cascades.length).toBe(exp.cascade!.count)`
became `toBeGreaterThanOrEqual`, one comment line ("Aggregate over a live repo").
The `every(deleteBehavior === ...)` line is unchanged.

**`test/fixtures.ts`** — three docblocks added inside `CorpusNodeExpect` /
`CorpusDotnetExpect`:
- `relationIds` (`:129-131`): hand-verified **subset**, the reader may return
  more as the live repo grows, asserted as a floor.
- `houseStyleWarning` (`:133-135`): stable **prefix**, stops before the table
  count, matched with `startsWith`.
- `cascade` (`:176-178`): `count` is a floor, not an exact count.

**`test/corpus.local.json`** and **`test/corpus.local.example.json`** — the
`houseStyleWarning` value for the repoD entry lost its trailing
"` <N> tables, so it reads as a naming convention; no relation inferred from it`".
The stored value now ends immediately before the number, which is the boundary
the emitting code (`packages/extract/src/node/ddl.ts:317`) makes stable — that
template interpolates the count right after the retained text. No trailing
space was kept, so the value is not silently fragile to reformatting.

Left exact, per the plan's aggregate-vs-declaration rule: `node.test.ts` wide-table
keys and utility-shape fields, `dotnet.test.ts` key arrays and the precision
tuple, `structure.test.ts` attribute arrays, and every scalar `toBe`.

## A2 — tsconfig.json

No change, as planned. James's sign-off (2026-09-04): the `exclude` entry stays
as the whole `test/fixtures/mini-fullstack-csharp` directory, matching the
`mini-react` / `mini-solution-tie` precedent. This closes the OPEN item in
`feature-research/complexity-facts/progress-1b.md`, which stays intact as the
historical record.

## A4 — README

`README.md:336-337` already reads `204 tests` (hermetic) and `262 tests` (full).
Both still correct after A1 — only corpus-gated assertions changed, no test was
added or removed. **No edit made.**

## Gates (after the edits, exact summary lines)

| Gate | Output |
|---|---|
| `PSQ_NO_CORPUS=1 pnpm test` | `Test Files  15 passed \| 3 skipped (18)` / `Tests  204 passed \| 58 skipped (262)` |
| `pnpm test` | `Test Files  18 passed (18)` / `Tests  262 passed (262)` — **0 failed** |
| `pnpm typecheck` | clean, exit 0 (all four projects: root, e2e, `@psq/web`, `@psq/desktop`) |
| `pnpm test:e2e` | `Test Files  1 passed (1)` / `Tests  19 passed (19)` |

The hermetic count is unchanged from baseline, which is the control that A1
touched nothing outside the corpus-gated blocks.

## Negative controls

All three mutate only `test/corpus.local.json`, which was byte-backed-up to the
scratchpad after the A1 edit and byte-restored after each control (`cmp -s`
confirms **IDENTICAL** to the post-A1 state at the end).

**NC-1a — remove one pinned id from repoD `relationIds` (5 → 4).**
Result: `Tests  18 passed (18)` — **GREEN, and correctly so.** This is a
deviation from the plan's literal wording, which expected red. Under a subset
floor, *shrinking* the expectation cannot fail: `arrayContaining` over a smaller
list still matches, and the length floor drops with it. Recorded, not
worked around: the control the plan actually wants is NC-1b.

**NC-1b — mutate one pinned id to an id the repo does not have** (simulating a
relation the repo genuinely deleted, which is progress-1b's "deletion is the
interesting failure" concern). Result: `Tests  1 failed | 17 passed (18)`,
failing at `packages/extract/test/node.test.ts:58:17` — the `arrayContaining`
line. **RED.** Restored → `Tests  18 passed (18)`. This is the control that
proves the weakened assertion still catches a real regression.

**NC-2 — set repoD `houseStyleWarning` to a prefix the reader never emits.**
Result: `Tests  1 failed | 17 passed (18)`, failing at
`packages/extract/test/node.test.ts:71:74` — the `startsWith` line. **RED.**
Restored → `Tests  18 passed (18)`.

**Tracked-file control.** After restoring: `git check-ignore -v` reports
`test/corpus.local.json` matched by `.gitignore:10`, and
`git ls-files --error-unmatch test/corpus.local.json` errors with "did not match
any file(s) known to git" — it is ignored and untracked, so no private value can
reach a commit through it. `git status --short` lists exactly the four modified
tracked files above.

~~No negative control was run for the `dotnet.test.ts` cascade floor; the change
is the same idiom as the relations floor and the plan did not ask for one.~~
**Superseded** — a negative control for the cascade floor *was* run later; see
**"Non-blocking 1 — negative control for the cascade floor"** below (~line 266),
which records the RED/GREEN run.

## A3 — pre-push leak sweep: **BLOCKING HIT**

Term list (36 terms, scratchpad only, never committed): every corpus repo
absolute path and every non-generic path segment from `test/corpus.local.json`,
plus every non-hidden sibling directory name under `~/Developer` except
`domain-expert` and obviously generic names. Case-insensitive `grep -E`.

**Positive control, run first:** the term list against `test/corpus.local.json`
itself → **10 matching lines**. The sweep works; an empty result elsewhere
means clean rather than broken.

| Sweep target | Matching lines |
|---|---|
| `git diff origin/master..HEAD` (content) | **62 — NOT CLEAN** |
| `git log origin/master..HEAD --format=%B` (messages) | 0 |
| `git diff` (uncommitted working tree) | 0 |
| untracked, non-ignored files (the three new records) | **2** — one line each in `plan.md` and `progress.md`, both Class 2 |

Five distinct terms hit. Classified by origin, without naming any of them:

**Class 1 — terms that come from `test/corpus.local.json` (private corpus repo
path / directory names). These are the real leak.** Three committed files in
the unpushed range carry them:

- `feature-research/m5b-component-attribution/plan.md` — carries a **full
  private absolute corpus path**, inside what looks like an illustrative
  `corpus.local.json` snippet, plus corpus directory names
- `feature-research/m5b-component-attribution/audit.md`
- `feature-research/m5b-component-attribution/roadmap.md`

**Class 2 — terms that are sibling directory names under `~/Developer` but do
NOT appear in `test/corpus.local.json`** (other local projects of James's, not
corpus repos). Two such terms, across 22 committed files under
`feature-research/complexity-facts/`, `feature-research/northwind-testbed/`,
`feature-research/template-refresh/` and `feature-research/m5b-component-attribution/`.
One of them is referenced deliberately and repeatedly as a measurement target in
the phase records (e.g. `progress-1b.md`'s "Measured, on …" table), so this class
is plausibly an accepted disclosure rather than an accident — but that is
James's call, not mine.

The two hits in the new records are the **same single line**, appearing in the
verbatim plan copy and again where `progress.md` reproduces the MVP table. It
is the approved plan's own Deploy-phase wording, naming local project
namespaces only to say the new LaunchAgent label must NOT collide with them.

**Correction (review fix).** This audit originally classified those two lines
as Class 2 (sibling directory names, not corpus repos) and left them in place.
That classification was wrong. The label prefix the line said the new
LaunchAgent must not collide with is **the basename of corpus repo D's path in
`test/corpus.local.json`** — Class 1, the same class as the committed hits, and
easy to miss because the word is also an ordinary English word. The port note
on the same row named two further local services beside their ports. Both
files have since been reworded identically to drop every name: the LaunchAgent
clause now says only that `com.psq.server` is a prefix no other service on this
Mac uses, and the port note says only that 9450 and 9444 are taken by two
existing tailnet services. A re-sweep of `plan.md`, `progress.md` and this file
against the full private-name set returns 0 matching lines in each.
**Resolved.** The Class 1 hits in the three *committed* files are untouched and
still block the push.

**Per my instructions I stopped and did not scrub anything.** No file listed
above was edited. **Phase A cannot proceed to A5 (push) until James decides on
Class 1 at minimum** — the repo is public and `origin/master` is one
fast-forward away from publishing those three files.

Note for whoever scrubs: rewriting those files in a new commit does not remove
the strings from the pushed history, but nothing here is pushed yet, so amending
or rewriting the unpushed range is still enough. (Memory record: GitHub keeps old
commits after a force-push — that only applies once something is pushed.)

## A5 — not done, by instruction

No `git commit`, `git checkout`, `git merge`, `git push`, or any other
state-changing git command was run. Working tree left dirty on
`m5b-component-attribution`.

## Deviations and open items

1. **NC-1a green instead of red** — explained above; the plan's literal control
   is not expressible against a subset floor. NC-1b substitutes for it and is
   strictly the stronger control.
2. **A3 is not clean** — the blocking finding above. Not fixed here.
3. `apps/server/test/api.test.ts:213` did not flake in any of today's runs
   (hermetic x2, full x2, e2e x1, plus six scoped `node.test.ts` runs).

---

## Review fixes

Applied after review. Records only — **no source or test file was edited in
this pass**, and `test/corpus.local.json` is byte-identical to its pre-pass
state (verified with `cmp` against a scratchpad backup).

**Files changed in this pass**

- `feature-research/green-and-push/plan.md`
- `feature-research/green-and-push/progress.md`
- `feature-research/green-and-push/audit.md`

**Blocking 1 — Deploy row reworded (both records, identically).** The MVP
estimate table's Deploy row named a launchd label prefix that is also a private
corpus repo basename, and named two other local services beside their ports.
Both clauses are now generalised: the LaunchAgent is described as
`com.psq.server`, a label prefix no other service on this Mac uses, and the
port note reads that 9450 and 9444 are taken by two existing tailnet services.
A case-insensitive sweep of `plan.md`, `progress.md` and `audit.md` against the
full private basename set derived from `test/corpus.local.json`, plus the three
extra service names the reviewer supplied, returns **0 matching lines in each
file**.

**Blocking 2 — sweep count and classification corrected.** `progress.md` no
longer claims the sweep found 0 hits in the new records; it states that each
record carried one Class 1 line at first writing, that the reviewer found it,
and that it is now reworded. The classification paragraph in this audit, which
called those lines Class 2, now carries a correction naming the true class
(Class 1: the basename of corpus repo D's path) and marking it resolved.

**Non-blocking 1 — negative control for the cascade floor.** The floor
assertion at `packages/extract/test/dotnet.test.ts:135` had never been shown to
fail. Control run: the pinned `cascade.count` for repo B was raised by 1 (7 →
8) in `test/corpus.local.json` and the test went **RED** —
`AssertionError: expected 7 to be greater than or equal to 8` at
`dotnet.test.ts:135`. The file was then restored from the backup, `cmp`
reported byte-identical, and the same test ran **GREEN** (1 passed, 11
skipped). The floor therefore binds at its pinned value rather than passing
vacuously.

**Gates re-run after the edits**

- `PSQ_NO_CORPUS=1 pnpm test` — 204 passed, 58 skipped.
- `pnpm test` — 262 passed.
- e2e and typecheck skipped by instruction: no code changed.

`git status --short` after the pass shows only the four modified test files
from the original implementation, the untracked
`feature-research/green-and-push/` directory, and no entry for
`test/corpus.local.json` (still gitignored and untracked).

---

## History rewrite (2026-09-04, records-only follow-up)

**Files changed in this follow-up pass** (records only, no code):

- `feature-research/green-and-push/progress.md` — status line, stale
  "push is blocked" statement replaced with the resolution, new "History
  rewrite" section with the old→new SHA map, two new items under "What the
  next phase needs to know", D-A-3 un-gated.
- `feature-research/green-and-push/audit.md` — this section appended.

No other file was created or modified. No git state-changing command was run.

Executed after James chose **"rewrite the unpushed commits"** over leaving them
unpushed. No code was touched. This section records the evidence and the exact
commands used to produce it, so the claims can be re-checked rather than
trusted.

**Method.** `git filter-branch --tree-filter` over `origin/master..HEAD`, the
filter restricted to `feature-research/m5b-component-attribution/*.md`. Each
private corpus repo basename was replaced (case-insensitive, word-bounded) with
its `repoA`..`repoE` key, and each absolute corpus path with `<repoX path>`.
The replacement map lived only in the session scratchpad and was never written
into the repo or into these records.

**Evidence.**

| Check | Result |
|---|---|
| Commits in range before / after | 7 / 7 |
| Commit subjects before / after | identical, in order (`diff` of the two subject lists is empty) |
| Positive control: Class 1 hits in `git log -p` on the backup ref | **8** |
| Class 1 hits in `git log -p origin/master..HEAD` | **0** |
| Absolute-path hits in `git log -p origin/master..HEAD` | **0** |
| `git diff --stat backup/pre-scrub-2026-09-04 HEAD` | 3 files, 8 insertions(+), 8 deletions(-) — only `feature-research/m5b-component-attribution/{audit.md,plan.md,roadmap.md}` |
| `master` an ancestor of HEAD | yes |
| New tip | `2a4aacf` (was `4e2b7d6`) |

The positive control matters here: the 0-hit results are the *pass* condition,
and a sweep that silently broke would also report 0. Running the identical
sweep against the pre-scrub backup ref returns 8, which proves the pattern set
and the grep both work before the 0 is believed.

**Verification commands used.**

```
# ranges and subjects
git rev-list --count origin/master..backup/pre-scrub-2026-09-04   # 7
git rev-list --count origin/master..HEAD                          # 7
diff <(git log --reverse --format=%s origin/master..backup/pre-scrub-2026-09-04) \
     <(git log --reverse --format=%s origin/master..HEAD)          # empty

# old -> new SHA map
paste <(git log --reverse --format='%h  %s' origin/master..backup/pre-scrub-2026-09-04) \
      <(git log --reverse --format=%h origin/master..HEAD)

# basename set derived programmatically from the gitignored corpus config
# into the session scratchpad (never committed), then:
git log -p origin/master..backup/pre-scrub-2026-09-04 \
  | grep -c -i -w -F -f "$SCRATCH/basenames.txt"                   # 8  (positive control)
git log -p origin/master..HEAD \
  | grep -c -i -w -F -f "$SCRATCH/basenames.txt"                   # 0
git log -p origin/master..HEAD | grep -c -E '/Users/[^ ]*/Developer'  # 0

# blast radius and push safety
git diff --stat backup/pre-scrub-2026-09-04 HEAD
git merge-base --is-ancestor master HEAD && echo YES               # YES
```

**Re-sweep of this phase's own records.** The three files in
`feature-research/green-and-push/` were swept again after the rewrite against
the same programmatically derived basename set and against the corpus absolute
paths:

| File | Basename hits | Corpus-path hits | `/Users/.../Developer` hits |
|---|---|---|---|
| `plan.md` | 0 | 0 | 0 |
| `progress.md` | 0 | 0 | 0 |
| `audit.md` | 0 | 0 | 0 |

**Backups retained — MUST NEVER BE PUSHED.** Three local-only refs:
`backup/pre-scrub-2026-09-04` (original tip `4e2b7d6`),
`refs/original/refs/heads/m5b-component-attribution` (filter-branch's own), and
`wip/backup-2026-09-01` — a working-tree snapshot taken before Phase 1, branched
off the old HEAD: **3 commits beyond `origin/master`, 12 leaking lines in
`git log -p`.** All three contain the private corpus names and the absolute
corpus path in full. All three are local-only and exist nowhere on the remote.
The first two are the only rollback, so they stay until the push of the
rewritten branch is verified and are deleted immediately after. All three are to
be deleted once the push is verified — **subject to James's word on the wip
snapshot**, which holds 46 lines HEAD does not and so may be worth salvaging
before it goes.

**Second decision recorded (James).** Non-corpus local project names — the
public testbed repos named across 22 phase records — **stay as-is**. They are
not private, and the rewrite deliberately did not touch them.
