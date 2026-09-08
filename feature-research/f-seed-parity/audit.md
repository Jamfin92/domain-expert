# Phase F audit — seed parity, and a choice that can be selected by its text

Branch `f-seed-parity`, from `master` at `9770685`. Plan rev 2, followed as written
except where measurement contradicted it (gate 10, recorded below).

## Files changed

17 code/test paths + this audit = 18, exactly the plan's table.

1. `packages/quiz/src/grade.ts` — modified
2. `packages/quiz/src/rng.ts` — modified
3. `packages/quiz/src/index.ts` — modified
4. `packages/quiz/src/bank.ts` — modified
5. `packages/quiz/src/sql/seed.ts` — modified
6. `packages/quiz/src/generate/entity-mcq.ts` — modified
7. `packages/quiz/src/generate/entity-cloze.ts` — modified
8. `packages/quiz/src/generate/entity-sql.ts` — modified
9. `packages/quiz/src/generate/ds-mcq.ts` — modified
10. `packages/quiz/src/generate/ds-cloze.ts` — modified
11. `packages/quiz/src/generate/client-mcq.ts` — modified
12. `packages/quiz/src/generate/component-label.ts` — modified
13. `apps/cli/src/index.ts` — modified
14. `apps/server/src/workspace.ts` — modified
15. `test/client-mcq.test.ts` — modified
16. `test/grade-choice.test.ts` — **new**
17. `test/seed-parity.test.ts` — **new**
18. `feature-research/f-seed-parity/audit.md` — **new** (this file)

Nothing outside the table was touched. `feature-research/f-seed-parity/plan.md`
is left untracked deliberately: committing it would make a 19th path and gate 13
says exactly 18.

## What changed, per file

**`grade.ts`** (D-F-1) — choice mode now runs `choices.findIndex(normalize ===)`
first and falls back to the `"2"`/`"b"` shortcut only when that returns `-1`.
The comment states the precedence rule and why the old order was wrong.

**`rng.ts`** — adds `export const DEFAULT_SEED = 1337;` above `rng()`, with the
divergence it exists to kill written down.

**`index.ts`** — re-exports `DEFAULT_SEED`.

**`bank.ts`** (D-F-2) — resolves `const s = seed ?? DEFAULT_SEED` once and passes
the resolved number to all six generators. The choke point.

**`sql/seed.ts`** — `materialize`'s `opts.seed ?? 1337` → `?? DEFAULT_SEED`.

**Six generators** (D-F-3) — each `seed ?? hashSeed(g.repo)` → `seed ?? DEFAULT_SEED`;
the now-unused `hashSeed` import dropped from all six (`DEFAULT_SEED` imported in
its place). No generator still references `hashSeed`.

**`client-mcq.ts`** (D-F-4.1) — `unselectable()` kept; its comment rewritten. The
old text called `grade.ts:52` a live bug it declined to fix. That reason is gone,
so the comment now states the reason that survives: a one-character choice is
ambiguous *to the reader*, who cannot tell it from an option letter, and the
grader now resolves that silently in favour of the choice.

**`component-label.ts`** (D-F-4.3) — pointer `grade.ts:53` → `grade.ts:54`.
Verified: the text branch is now at line 54.

**`apps/cli/src/index.ts`** — `:95` data seed → `DEFAULT_SEED`; `:193` selection
seed `hashSeed(g.repo)` → `DEFAULT_SEED`; `DEFAULT_SEED` folded into the existing
`@psq/quiz` import block and the now-dead standalone `import { hashSeed }` line
deleted (verified by eye in `git diff`, since `tsconfig.base.json` sets no
`noUnusedLocals` — `grep hashSeed apps/cli/src/index.ts` returns nothing).
Help text `--seed` no longer claims "derived from the repo path"; `--section`
list corrected from `(entity, ds)` to `(entity, client, ds)`.

**`apps/server/src/workspace.ts`** — `:137` literal → `DEFAULT_SEED`, import added.
Value-identical; single-source only.

**`test/client-mcq.test.ts`** (D-F-4.2) — comment and title only. Title was
"asks nothing when the ANSWER would be a single character"; now "…would be
ambiguous with an option letter". No assertion changed.

**`test/grade-choice.test.ts`** — new, 8 hermetic cases, literal `Question`
objects, no fixture, no graph.

**`test/seed-parity.test.ts`** — new, 4 cases over `MINI_FULLSTACK_REACT`. Case 3
spawns two `node --import tsx apps/cli/src/index.ts questions --out <tmpdir>`
subprocesses (the CLI runs `main()` at import and exports nothing) and compares
`questions/entity.json` and `schema.sql` byte for byte. Temp dirs are removed in
`afterAll`.

## Gate results — measured

**1. Baseline re-probe** — PASS, reproduced exactly.
- `PSQ_NO_CORPUS=1 pnpm test` → 272 passed | 58 skipped (330); 23 files passed | 3 skipped.
- selftest at CLI default seed: repoA 213 ok · repoB 107 ok · repoC 2 ok · repoD 136 ok ·
  repoE 56 ok · repoAClient **failed, 1 finding across 89**:
  `not-a-member/ds.member.src/types/application.ts.ApplicationStatus: reference answer is graded wrong (chose "X", answer is X)`
- `hashSeed("/Users/james/Developer/paper-profile/client")` recomputed = **916108129**,
  path length **43**. (`repoArg()` calls `resolve()`, a no-op on an already-absolute path,
  so `g.repo` is the string as passed.)

**2. `pnpm typecheck`** — PASS before edits and after. Exit 0, all four projects, no output.

**3. Choice census, run BEFORE editing `grade.ts`.** Over the six corpus roots plus
seven fixtures, counting the `normalize(choice)` form. **445 choice-mode questions**
at each seed.

| | default seed | `--seed 1337` |
|---|---|---|
| choice-mode questions | 445 | 445 |
| normalizes to one character | **6** | **3** |
| bare `a`–`d` after normalize | **0** | **0** |
| decimal in `1..choices.length` | **0** | **0** |
| selftest `String(other+1)` mutations whose meaning moves under text-first | **0** | **0** |

6/0/0/0 and 3/0/0/0 — exactly what the plan predicted. The six at the default seed:

```
repoD       ds.collection.server/src/release.ts.RegisteredMessage            "t"
repoD       ds.collection.server/src/ws-gate.ts.RegisteredMessage            "t"
repoD       ds.collection.web/src/components/ContextMenu.tsx.Props           "x"
repoD       ds.collection.web/src/components/ContextMenu.tsx.Props           "y"
repoAClient ds.member.src/features/applications/ppb3-pistol/types.ts.Sex     "X"
repoAClient ds.member.src/types/application.ts.ApplicationStatus             "X"   <- the visible finding
```

At 1337 the surviving three are the two repoD `ContextMenu` ones and the
repoAClient `Sex` one. **One detail of the plan is off:** it says that at 1337 the
offending `X` "is a distractor, not the answer" on the `ApplicationStatus`
question. Measured, at 1337 that question does not carry a one-character choice
at all — `X` is not among its four choices. The `Sex` question is the one that
carries `X` as a distractor at both seeds. The conclusion the plan drew (selftest
is `ok` at 1337, and five of six one-character choices are invisible to it) is
unaffected.

**4. `test/grade-choice.test.ts` at baseline, unmodified `grade.ts`** — written
first and run before any edit. **3 failed | 5 passed (8)**:
- case 1 (one-char choice at index 1, given `"X"`) — `AssertionError: expected false to be true`, line 34. **Required to fail — did.**
- case 7 (choice `"b"` at index 0, given `"b"`) — `AssertionError: expected false to be true`, line 68. Fails at baseline because the letter shortcut wins there; this is the behaviour case 7 pins as changing.
- case 8 (choice `"X"` at index 2, given `"X"`) — `AssertionError: expected false to be true`, line 75. **Required to fail — did.**

After D-F-1: **8 passed (8)**.

**5. `PSQ_NO_CORPUS=1 pnpm test`** — PASS. **284 passed | 58 skipped (342)**,
25 files passed | 3 skipped. 272 + 12 new (8 + 4); skipped count **unchanged at 58**,
so the private corpus config is intact.

**6. `pnpm test`** — PASS. **342 passed (342)**, 28 files passed, 0 failed, 0 skipped.

**7. selftest, six roots, CLI default seed** — PASS. All six `ok`; the repoAClient
finding is gone. Counts **213 / 107 / 2 / 136 / 56 / 89**, unchanged from baseline.

**8. selftest, six roots, `--seed 1337`** — PASS. Byte-identical result lines to
gate 7 (the only `diff` hunks are pnpm's own echoed command line, which now carries
the extra flag).

*Method note:* the first attempt passed `--seed 1337` through an unquoted shell
variable. This shell is zsh, which does **not** word-split, so the CLI received it
as a single argv token and the flag was silently inert — gate 8 would have been
vacuous. Rerun with the flag written out literally; gate 9's revert independently
confirms `--seed` does reach the CLI.

**9. Control (a), D-F-1, at the OLD default seed 916108129** — PASS, non-vacuous.
- `grade.ts` reorder reverted, everything else in place,
  `psq selftest --repo /Users/james/Developer/paper-profile/client --seed 916108129`
  → `selftest failed — 1 finding(s) across 89 questions` /
  `not-a-member/ds.member.src/types/application.ts.ApplicationStatus: reference answer is graded wrong (chose "X", answer is X)`
  — the baseline message verbatim.
- Restored, same seed, same command → `selftest ok — 89 questions`.

**10. Control (b), parity — the plan's attribution is WRONG; measured matrix below.**

The plan says "revert `bank.ts`'s resolution → parity case 1 must fail; restore,
revert `apps/cli:95` → case 3 must fail". Neither holds. Measured, all four
reverts run against `test/seed-parity.test.ts`:

| revert | case 1 | case 2 | case 3 | case 4 |
|---|---|---|---|---|
| A. `bank.ts` alone (pass raw `seed` to the six) | pass | pass | pass | pass |
| B. the six generators alone (back to `hashSeed(g.repo)`) | pass | pass | pass | pass |
| C. `bank.ts` **and** the generators | **FAIL** | pass | **FAIL** | pass |
| D. `apps/cli:95` alone (`DEFAULT_SEED` → literal `1337`) | pass | pass | pass | pass |
| E. nothing reverted (shipped state) | pass | pass | pass | pass |

Two findings:

- **A and B are individually vacuous because D-F-2 and D-F-3 are redundant with
  each other.** Rev 2 added D-F-3 (the generators default to `DEFAULT_SEED` too)
  on top of D-F-1's choke point in `bank.ts`. Either half alone holds the line, so
  neither revert alone can move a case. Revert C — both together, which is the
  `9770685` behaviour for these files — moves cases 1 and 3, so **neither test is
  vacuous**: they fail if the seed-resolution path regresses anywhere along it.
  The plan's stated pass condition ("if a case moves for neither revert it is
  vacuous and must be rewritten") is satisfied — both cases move, for revert C.
  The redundancy is deliberate belt-and-braces per D-F-3 and is left as designed.
- **`apps/cli:95` cannot move any case, ever.** The literal it replaced was `1337`
  and `DEFAULT_SEED === 1337`, so revert D is numerically a no-op. The CLI's real
  divergence was `:96` forwarding a bare `undefined` question seed — a line the plan
  never lists as touched and which is unchanged in this diff; `bank.ts` now resolves
  it. `:95` is a single-source-of-truth edit, not a behaviour edit, and should be
  described as such.

Case 2 (non-vacuity of case 1) passes on its own terms: on `MINI_FULLSTACK_REACT`
the bank at `hashSeed(g.repo)` genuinely differs from the bank at `DEFAULT_SEED`,
so case 1 is comparing something that could have differed.

**11. Control (c), selection parity (`cli:193`)** — **achieved, PASS.** It took
roughly thirty lines, so the plan's ungated fallback was not used.

- First attempt, on `MINI_FULLSTACK_REACT` at `--n 3` as the plan sketched, was
  **vacuous**: reverting `:193` to `hashSeed(g.repo)` produced a byte-identical
  prompt order. That fixture's bank is too small for `selectQuiz`'s round-robin to
  be seed-sensitive at n=3. Reported rather than accepted.
- Rerun on repoAClient (89 questions) at `--n 12`:
  - piped `psq quiz --repo <repoAClient> --n 12` (12 blank lines on stdin, ANSI
    stripped) emits 12 prompts whose first lines are **identical, in order**, to
    `selectQuiz(buildBank(g, seeded, DEFAULT_SEED), 12, DEFAULT_SEED).map(q => q.prompt)`.
    (Comparison is on each prompt's first line only — cloze prompts are multi-line
    and the CLI interleaves them with option lines.)
  - Positive control: with `:193` reverted to `hashSeed(g.repo)`, the order moves —
    9 of 12 lines differ. Restored, it matches again.

**Gate 8 does not cover selection parity and is not claimed to.** `psq selftest`
grades the whole bank and never calls `selectQuiz`. Gate 11 is the only selection
gate, and it is a one-off probe, not a committed test.

**12. Determinism** — PASS.
- selftest over all six roots, run twice at the default seed: `diff` clean.
- piped `psq quiz --repo <repoAClient> --n 12` run twice: full transcript
  byte-identical after ANSI stripping.

**13. `git status --porcelain`** — 15 modified + 2 new tests + this audit = the 18
paths and nothing else. No fixture, no `apps/web`, no `apps/desktop`, no `e2e/`.

## Deviations from the plan

1. **Gate 10's attribution was wrong and is corrected above by measurement, not
   re-run into passing.** No test was rewritten: both parity cases are live under
   the combined revert. The plan's claim that `apps/cli:95` gates case 3 is false
   and cannot be made true, because the value it replaced is the same number.
2. **Gate 3's minor factual correction:** at 1337 the `ApplicationStatus` question
   has no one-character choice at all, rather than carrying `X` as a distractor.
   Every count the plan predicted (6/0/0/0 and 3/0/0/0) was met.
3. **Gate 11 needed a larger bank than the plan sketched.** The fixture-at-n=3
   version passed vacuously; recorded above rather than shipped.
4. Gate 8's first run was inert because of zsh's lack of word-splitting; rerun.
   Recorded because a gate that passes by finding nothing can pass because it broke.

## Not done, deliberately

- **`pnpm test:e2e` was not run.** It runs `pnpm build:web`, which empties the
  served `apps/web/dist`, and this checkout is the live personal deploy. No e2e
  coverage was added or exercised. `e2e/harness.ts` imports only `referenceAnswer`,
  which this diff does not touch.
- **`com.psq.server` (pid 16538) was not restarted.** It `tsx`-loaded
  `packages/quiz` source on Sep 4, so it serves none of this until someone restarts
  it. Deploy is James's call.
- Nothing outside the 18 paths was edited. `selftest.ts:47`, the three duplicated
  `mcq()` helpers, and `README.md` are untouched, as D-F-5 and "out of scope" state.

## Open risks

1. **`psq quiz`'s question order changes for every user with no `--seed`.** By
   design (D-F-2) and the one user-visible change in the phase, but it is a real
   behaviour change to a shipped command.
2. **`selftest.ts:47` mutates a choice question by `String(other + 1)`.** Under
   text-first that string now hits choice text before the index shortcut, so a
   choice normalizing to a small decimal would make a mutation resolve to the
   answer and raise a spurious "cannot be got wrong". Zero such choices today
   (gate 3 measured 0/445 at both seeds), but the invariant moved from
   "deterministic index" to "index unless a choice looks like a number". The fix —
   mutating by `choices[other]` text — is the recorded follow-up.
3. **D-F-2 and D-F-3 are mutually redundant** (gate 10, reverts A and B). That is
   intentional defence in depth, but it means no single-file revert of the seed
   path is detectable by the test suite; only the pair is.
4. `--seed abc` is still silently seed 0 (`Number("abc")` is `NaN`, `??` never
   fires, `NaN >>> 0 === 0`). Pre-existing in both shells, unchanged, out of scope.
