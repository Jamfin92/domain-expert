# Phase F — seed parity, and a choice that can be selected by its text

**Rev 2**, after a plan review that raised four blocking items. Rev 1's design
survived; its *gates* did not — two of its three controls were vacuous. Branch
`f-seed-parity` from `master` at `9770685`. Previous record: `../m5c-ii/progress.md`.

Two defects Phase E measured and deliberately left. They are one phase because
they compose: seed parity is what makes `psq selftest` a gate for the served
bank, and the grading bug is what that gate has been failing to catch at one seed
and catching at another.

---

## The two defects, measured this session

### 1. The grader cannot select a one-character choice by its text

`packages/quiz/src/grade.ts:50-53`, choice mode:

```
50  let picked = -1;
51  if (/^\d+$/.test(trimmed)) picked = Number(trimmed) - 1;
52  else if (/^[a-z]$/i.test(trimmed)) picked = trimmed.toLowerCase().charCodeAt(0) - 97;
53  else picked = choices.findIndex((c) => normalize(c) === normalize(trimmed));
```

Line 52 tests the **shape of the input** and never looks at the choices, so any
one-letter input is read as an option letter before line 53 can compare it to
choice text. **A choice whose text is one character is unreachable by text.**

And it is worse than "unreachable at some indices". A one-character choice past
`d` maps to an index **out of range for a four-choice MCQ** — `x` → 23, `y` → 24.
So it is unreachable *structurally*, not by seed luck.

Measured live, CLI at its default seed:

```
selftest failed — 1 finding(s) across 89 questions
  not-a-member/ds.member.src/types/application.ts.ApplicationStatus:
  reference answer is graded wrong (chose "X", answer is X)
```

**The visible finding is one of six, and the other five are invisible.** Census
over all six corpus roots at the default seed (603 questions, 379 choice-mode):

| | count |
|---|---|
| choices that are one character (raw) | **6** |
| choices that *normalize* to one character | 6 |
| choices that are purely numeric | **0** |

Of those six: one is the answer above; **five are distractors** — `X` in
repoAClient, and `t`/`t`/`x`/`y` across three questions in **repoD, a root
selftest calls `ok`**. A learner can never select any of them. They pass because
a mutation to them grades "wrong" for the wrong reason: the input is
unparseable, not badly chosen. **The gate is blind to five of the six.**

This is structural, not one generator's bug. `entity-mcq.ts:26-53` and
`ds-mcq.ts:33-60` each carry their own near-identical `mcq()` helper whose only
filter is the `MIN_CHOICES` pool-size check; `ds-mcq.ts:188` passes
`distractors: shape.members` unfiltered. Only `client-mcq.ts` guards
(`unselectable()` at `:73-75`).

**Correcting Phase E's record:** it attributed the casualty to `client.busiest`.
Measured, it is `not-a-member`, a **ds-mcq** question. The generator that *has*
the guard is not the one that was hurt.

### 2. The CLI and the server seed the same repo differently

| | bank construction | quiz selection |
|---|---|---|
| CLI | data `seed ?? 1337` (`apps/cli/src/index.ts:95`); **questions raw `seed`** (`:96`) | `seed ?? hashSeed(g.repo)` (`:193`) |
| server | `opts.seed ?? 1337` for both (`apps/server/src/workspace.ts:137-139`) | `seed ?? r.seed`, and `r.seed` is that same 1337 (`:193`) |

`buildBank` (`bank.ts:21-38`) forwards the seed unchanged; each of the six
generators then does its own `seed ?? hashSeed(g.repo)`. An absent `--seed` makes
the CLI sample at a repo-derived hash while the server samples at 1337 — **the
divergence is doubled**, at construction and again at selection.

```
psq selftest --repo <repoAClient>              -> failed, 1 finding, 89 questions
psq selftest --repo <repoAClient> --seed 1337  -> ok,             89 questions
```

**Defect 2 is what let defect 1 hide.** At 1337 the offending member is a
distractor, not the answer, so the server has been serving a bank whose gate was
red in the other shell.

---

## Measured baseline at `9770685` (live, this session)

- `PSQ_NO_CORPUS=1 pnpm test` → **272 passed | 58 skipped (330)**, 23 files passed / 3 skipped.
- selftest at the CLI default seed: repoA 213 ok · repoB 107 ok · repoC 2 ok ·
  repoD 136 ok · repoE 56 ok · **repoAClient 89, 1 finding**.
- Counts are **identical at `--seed 1337`** on all six roots (measured, twice, by
  two agents independently).
- `hashSeed(<repoAClient path>) = 916108129` — the CLI's current default there.
- Service `com.psq.server` running, pid 16538, started `Fri Sep 4 15:05:56`.
- `master == origin/master` at `9770685`, tree clean. (Phase E's record says
  "not pushed"; that is stale.)

---

## Decisions

### D-F-1 — grade by choice text first, option letter second

```
let picked = choices.findIndex((c) => normalize(c) === normalize(trimmed));
if (picked === -1) {
  if (/^\d+$/.test(trimmed)) picked = Number(trimmed) - 1;
  else if (/^[a-z]$/i.test(trimmed)) picked = trimmed.toLowerCase().charCodeAt(0) - 97;
}
```

The rule becomes statable: **an exact choice text always wins; the shortcut
applies only to input matching no choice.** Fixed in the grader, not the
generators: one edit covers all ~15 exposed sub-generators, and a generator's job
is to describe a repo, not to work around its reader.

**The semantic change is empirically empty.** Behaviour moves only for input
matching `/^\d+$/` or `/^[a-z]$/i` *that also matches a choice's normalized text*.
Measured across 445 choice-mode questions (7 fixtures + 6 corpus roots) at both
seeds: 0 numeric choices, 0 choices normalizing to a bare digit, 0 choices
shadowing their own question's `a`–`d`. Multi-character input never satisfied
either regex, so it always reached `findIndex` — the reorder does not touch it.
(`normalize("foo.X") === "x"` is a real sharp edge in `normalize()`, but it is
pre-existing and orthogonal to this diff.)

### D-F-2 — one `DEFAULT_SEED`, and only one

`export const DEFAULT_SEED = 1337;` in `packages/quiz/src/rng.ts` — it already
owns `rng` and `hashSeed`, imports nothing (so no cycle), and `bank.ts` would
create a real cycle with `sql/seed.ts`. Re-exported from `packages/quiz/src/index.ts`.
`@psq/quiz` exports source directly and the server is `tsx`-loaded, so a value
export resolves under `verbatimModuleSyntax` + `NodeNext`.

It replaces the **three** hardcoded `1337` literals (`apps/cli:95`,
`apps/server/src/workspace.ts:137`, `packages/quiz/src/sql/seed.ts:232` — the
server's single literal serves both `materialize` and `buildBank`) and the CLI's
`hashSeed` selection fallback:

- `bank.ts` resolves `seed ?? DEFAULT_SEED` **once** and passes a resolved number
  to all six generators. This is the choke point.
- `apps/cli/src/index.ts:95` data seed, `:193` selection seed.
- `apps/server/src/workspace.ts:137`.
- `packages/quiz/src/sql/seed.ts:232`.

Safe: scouted and verified repo-wide, **no caller outside the CLI relies on the
`hashSeed(g.repo)` fallback**. `apps/web`/`apps/desktop` never import `@psq/quiz`;
`e2e/harness.ts` imports only `referenceAnswer`; every unit test passes an
explicit seed.

**`psq quiz` changes behaviour by design** — its order was seeded from the repo
path and is now seeded from `DEFAULT_SEED`, matching the server. That is the
point of the phase and the one user-visible change in it.

### D-F-3 — the six generators default to `DEFAULT_SEED` too *(reversed from rev 1)*

Rev 1 kept their `seed ?? hashSeed(g.repo)` to keep the diff at the choke point.
That preserves **two different defaults in one system**, which is the exact bug
class this phase exists to kill: unreachable through `buildBank`, but reachable,
and the next direct caller gets a silently different bank. No test calls a
generator without an explicit seed, so this is a six-token diff at zero risk.
Change all six.

### D-F-4 — three comments and one help string name the old behaviour; all four change

A false because-clause outliving its fix is a failure this repo has recorded
before, so the fix and *its stated reason* ship together:

1. `client-mcq.ts:62-70` — names `grade.ts:52` as a live bug and declines to fix
   it. **Keep `unselectable()`**: its true remaining reason is that a
   one-character choice is ambiguous *to the person answering*, who cannot tell
   it from an option letter, and D-F-1 resolves that silently in favour of the
   choice. Rewrite the comment to the reason that survives.
2. `test/client-mcq.test.ts:154-157` — carries the *identical* false clause, in a
   test whose title asserts the obsolete reason. Comment and title only.
3. `component-label.ts:14` — cites `grade.ts:53` for the text branch, which moves
   to ~`:50`. Line drift, not a false clause; fix the pointer.
4. `apps/cli/src/index.ts:210` — `--seed <n> fix the generator seed (default:
   derived from the repo path)`. **This becomes a lie.** A phase whose purpose is
   killing a divergence must not ship the help text documenting it.

While in that help block: `:212-213` lists sections as `(entity, ds)` and omits
`client`, which Phase E shipped. Pre-existing and unrelated, corrected in passing
because it is two words in a string this diff already edits. Listed, not smuggled.

### D-F-5 — do not add guards to `entity-mcq.ts` / `ds-mcq.ts`

D-F-1 removes the grading failure for all of them at once. Their remaining
exposure is post-`normalize()` collision, already caught by selftest's
`choices collide after normalization` rule (`selftest.ts:85`) — and after D-F-2
the gated seed is the served seed. Unifying the three duplicated `mcq()` helpers
behind one guarded builder is a real refactor and a later phase.

**Exposure this creates, stated rather than discovered later:** `selftest.ts:47`
mutates a choice question by `String(other + 1)`. Under text-first that string is
matched against choice text first, so a choice normalizing to a small decimal
would make the mutation resolve to the answer and raise a spurious "cannot be got
wrong". Zero such choices today (gate 3 keeps measuring it), but the invariant
moved from "deterministic index" to "index unless a choice looks like a number".
Mutating by `choices[other]` text instead would remove the coupling and exercise
the path a human uses; **not done this phase**, recorded as the follow-up.

---

## Files touched

| # | Path | Change |
|---|---|---|
| 1 | `packages/quiz/src/grade.ts` | reorder 50-53 per D-F-1; comment states the precedence rule |
| 2 | `packages/quiz/src/rng.ts` | **add** `DEFAULT_SEED` |
| 3 | `packages/quiz/src/index.ts` | export `DEFAULT_SEED` |
| 4 | `packages/quiz/src/bank.ts` | resolve the seed once; pass resolved to all six |
| 5 | `packages/quiz/src/sql/seed.ts` | line 232 |
| 6 | `packages/quiz/src/generate/entity-mcq.ts` | seed default (D-F-3) |
| 7 | `packages/quiz/src/generate/entity-cloze.ts` | seed default |
| 8 | `packages/quiz/src/generate/entity-sql.ts` | seed default |
| 9 | `packages/quiz/src/generate/ds-mcq.ts` | seed default |
| 10 | `packages/quiz/src/generate/ds-cloze.ts` | seed default |
| 11 | `packages/quiz/src/generate/client-mcq.ts` | seed default **+ comment 62-70** |
| 12 | `packages/quiz/src/generate/component-label.ts` | **comment only** (`:14` pointer) |
| 13 | `apps/cli/src/index.ts` | `:95`, `:193`, help `:210` and `:212-213`; **delete the now-dead `hashSeed` import at `:12`**, folding `DEFAULT_SEED` into the block at `:7-11` |
| 14 | `apps/server/src/workspace.ts` | `:137` |
| 15 | `test/client-mcq.test.ts` | **comment and test title only** (`:154-157`) |
| 16 | `test/grade-choice.test.ts` | **new**, hermetic |
| 17 | `test/seed-parity.test.ts` | **new**, hermetic |
| 18 | `feature-research/f-seed-parity/audit.md` | the implementer's audit |

Nothing else. `apps/web`, `apps/desktop`, `e2e/`, every fixture and every other
test file are expected untouched — if one needs an edit, **report it before
making it**. Note `tsconfig.base.json` has no `noUnusedLocals`, so a dead import
will not be caught by `pnpm typecheck` (hence #13 being explicit).

## New tests

**`test/grade-choice.test.ts`** — hermetic, literal `Question` objects, no fixture:
1. a one-character choice at a non-zero index grades correct given its text
   — **the regression case; fails at `9770685`**
2. the same question grades **wrong** given a different member's text
3. `"b"` picks index 1 when no choice is `"b"` (letter shortcut intact)
4. `"2"` picks index 1 when no choice is `"2"` (number shortcut intact)
5. full choice text picks its own index
6. input matching no choice and no valid letter/number grades wrong, not index 0
7. the documented ambiguity is pinned: choices `["b","Alpha","Bravo","Charlie"]`
   given `"b"` picks index **0** (text), not 1 (letter)
8. a choice past `d` — `["Alpha","Bravo","X","Delta"]` given `"X"` — picks index 2,
   the case that is structurally out of range today

**`test/seed-parity.test.ts`** — hermetic, over `MINI_FULLSTACK_REACT`:
1. **bank** — `buildBank(g, seeded)` deep-equals `buildBank(g, seeded, DEFAULT_SEED)`.
2. **non-vacuity** — `buildBank(g, seeded, hashSeed(g.repo))` **differs from**
   `buildBank(g, seeded, DEFAULT_SEED)`. Assert bank *inequality* directly. Rev 1
   said "assert the seeds differ, or skip"; both are wrong — differing seeds do
   not imply differing banks, and the skip would silently delete the only thing
   keeping case 1 honest. If the banks are equal, that is a finding, not a skip.
3. **CLI shell** — spawn `psq questions --repo <MINI_FULLSTACK_REACT> --out A`
   and `... --seed 1337 --out B`; assert `questions/*.json` and `schema.sql` are
   byte-identical. **This fails at `9770685`** and moves if `cli:95`, `cli:96` or
   `bank.ts` regresses. Two `tsx` subprocesses; there is no in-process
   alternative, because `apps/cli/src/index.ts` runs `main()` at import and
   exports nothing.
4. **selection** — `DEFAULT_SEED === 1337`, pinning the served value.

## Gates

Run in order. Every negative gate has a positive control, because a gate that
passes by finding nothing can pass because it broke.

1. **Baseline re-probe** on the branch before any edit — the two baseline blocks
   above must reproduce. If not, stop and report.
2. **`pnpm typecheck`** — clean, all four projects.
3. **Choice census, before editing `grade.ts`.** Over all six corpus roots and
   every fixture, at both the default seed and 1337, count choices whose
   **`normalize(choice)`** is (a) one character, (b) a bare `a`–`d` letter,
   (c) a decimal in `1..choices.length`. Census the *normalized* form, not
   `choice.trim().length` — `"Card (src/x/v2.0)"` normalizes to `"0)"` and a raw
   length count would miss it. Also count selftest mutation strings whose meaning
   changes. **Report the numbers even if zero**; expected 6/0/0/0 at the default
   seed, 3/0/0/0 at 1337.
4. **`test/grade-choice.test.ts` fails at baseline** — write it first, run it
   against unmodified `grade.ts`, record which cases fail and with what message.
   Cases 1 and 8 must fail. Then apply D-F-1 and watch them pass.
5. **`PSQ_NO_CORPUS=1 pnpm test`** — 272 passed | 58 skipped (330) plus the new
   cases, 0 failed. **A drop in the skipped count means the corpus config
   vanished, not that something improved.**
6. **`pnpm test`** — 330 + new, 0 failed.
7. **selftest, six roots, default seed** — all six `ok`; repoAClient's finding
   gone; counts still 213 / 107 / 2 / 136 / 56 / 89. The justification for
   pinning counts is that they were **measured identical at both seeds**, not
   that bank size cannot move with the seed — it can: `choicesCollide()` runs on
   the sampled list and can legitimately drop a client question on a reseed.
8. **selftest, six roots, `--seed 1337`** — identical output to gate 7.
9. **Control (a), D-F-1 — at the OLD default seed.** Revert only the `grade.ts`
   reorder and run `selftest --repo <repoAClient> --seed 916108129`
   (`= hashSeed(<that exact path string>)`; recompute it rather than trusting the
   literal, since `g.repo` is the path as passed, unresolved). Expect the finding
   verbatim; restore and expect `ok` at the same seed. **Running this control at
   the new default seed would report `ok` and be misread as "the fix did
   nothing"** — at 1337 the `X` member is a distractor, not the answer.
10. **Control (b), parity.** Revert `bank.ts`'s resolution → parity case 1 must
    fail. Then restore, revert `apps/cli:95` → case 3 must fail. Report which
    revert moves which case. If a case moves for neither, it is vacuous and must
    be rewritten before this phase ships.
11. **Control (c), selection (`cli:193`).** Attempt: pipe stdin to
    `psq quiz --repo <fixture> --n 3`, strip ANSI, and compare the prompt order
    against `selectQuiz(buildBank(g, seeded, DEFAULT_SEED), 3, DEFAULT_SEED)`.
    **If that cannot be made deterministic in about thirty lines, ship `:193`
    ungated and say so plainly in the record** — do not invent a gate, and do not
    let gate 8 be read as covering selection parity. It does not.
12. **Determinism** — selftest twice at the same seed, byte-identical; and gate
    11's piped `psq quiz` twice, byte-identical after ANSI stripping.
13. **`git show --stat`** — exactly the 18 paths, no more.

`pnpm test:e2e` is **not** in this list. It runs `pnpm build:web`, which empties
the served `apps/web/dist` mid-build, and this checkout is the live personal
deploy. **Ask before running it.**

## Deploy

Out of scope, James's call, as in Phase E. This changes `packages/quiz` **source**,
which pid 16538 `tsx`-loaded on Sep 4, so the running service serves none of it
until restarted. Do not restart it.

## Out of scope, recorded

- Unifying the three duplicated `mcq()` helpers behind one guarded builder (D-F-5).
- Changing `selftest.ts:47` to mutate by choice text rather than `String(other+1)`,
  which would remove the coupling D-F-5 names.
- `--seed abc` → `Number("abc")` is `NaN`, not `undefined`, so `??` never fires and
  `rng(NaN)` seeds `0` (`rng.ts:23`, `NaN >>> 0 === 0`). Pre-existing in **both**
  shells; a bad `--seed` is silently seed 0.
- A selftest rule for a choice that shadows an option letter — D-F-1 makes such a
  choice *selectable*, but it stays ambiguous to a human reader.
- `README.md:25-38` still has no M5c row. Offered in Phase E, not taken; offered
  again, not taken.
