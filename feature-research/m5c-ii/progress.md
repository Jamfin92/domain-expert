# Phase E — M5c-ii: the comparative client-call generator — PROGRESS

**Status: SHIPPED at `7dbc101` (2026-09-08); reviewer "Ship" after one blocking
round of two items; James accepted.** Feature commit on `m5c-ii-client-generator`,
branched from `master` at `c7d4128`. This record is committed on top and `master`
fast-forwarded to it — the D1/D2/D-A-3 shape. **Not pushed** (D-C-8: James's call).

Plan: `plan.md` — approved as rev 2, after a plan review overturned two of rev 1's
premises. It carries two dated in-place blocks (a `CORRECTED` on gate 7(b), later
`AMENDED`; and a `SUPERSEDED` on D-E-3a). Audit: `audit.md`. Previous phase
record: `../m5c-i/progress-d2.md`.

---

## What shipped

The first question generator to emit `section: "client"` — a value the `Section`
enum has carried since M5a that **no generator had ever produced**. One
comparative MCQ, `client.busiest` (generator `most-calls`): *"Which component
makes the most API calls?"*, graded answer a component name, count in the
rationale, mirroring `mostConnected`.

| Part | Where | What |
|---|---|---|
| Label helper | `packages/quiz/src/generate/component-label.ts` | **new** — `componentLabel(g, component)`; bare name, or `name (file **without extension**)` on collision |
| Generator | `packages/quiz/src/generate/client-mcq.ts` | **new** — `generateClientMcq`, one sub-generator, local `mcq()` (the `entity-mcq` one hardcodes its section) |
| Registration | `packages/quiz/src/bank.ts` | the single composition point |
| Exports | `packages/quiz/src/index.ts` | both new symbols, beside `shapeLabel` |
| Label tests | `test/component-label.test.ts` | **new**, 6 cases — mirrors `test/shape-label.test.ts` |
| Generator tests | `test/client-mcq.test.ts` | **new**, 11 cases on synthetic graphs |
| Bank gate | `test/client-quiz.test.ts` | **new**, 4 cases, **through `buildBank`** — see below |
| Fixture | `test/fixtures/mini-fullstack-react/src/components/{admin,shop}/Panel.tsx` | **new** — two components both named `Panel`, 3 and 1 calls |
| Fixture pins | `test/mini-fullstack-react.test.ts`, `test/fixtures.ts` | re-pinned to 4 components / 8 calls; docstring rewritten |
| Server pins | `apps/server/test/api.test.ts` | re-pinned; **+ the `/shapes` negative assertion** (D2 debt) |
| e2e | `e2e/psq.e2e.ts` | re-pinned; **split into two `it`s** (D2 debt), 22 → 23 |

`apps/web` needed **no change**: `SECTION_LABEL` at `Dashboard.tsx:47-51` already
carried `client: "Clients"`, and the section checkboxes are built from whichever
sections the bank actually returns. The picker appears on its own now.

## The finding this phase turns on (D-E-3, and why it is not re-litigable)

**A label of the form `Name (path/File.tsx)` cannot be MCQ choice text. It does
not merely confuse the reader — it makes the question unfailable.**

`normalize.ts:14-25` drops namespace qualification by slicing at the **last `.` in
the whole string**; with no `<` present the head *is* the whole string, so a file
extension eats everything before it. Measured:

```
"Card (src/components/admin/Card.tsx)"   -> "tsx)"
"Panel (src/components/admin/Panel.tsx)" -> "tsx)"
```

All four choices normalize identically; `grade.ts:53` then returns index 0 for any
text answer, so the reference answer grades wrong whenever `answerIndex !== 0` and
no mutation can be wrong — rule 5, violated.

**The trap, stated precisely, because it is not obvious: `shapeLabel` produces this
same format and is perfectly safe.** It is only ever interpolated into **prompts**
(`ds-mcq.ts:125,148,182`, `ds-cloze.ts:70,91`), which `normalize()` never touches.
The format is safe in a prompt and fatal in a choice. So the D2 carry-forward
instruction — *"should use `shapeLabel` for any shape it names"* — was not merely
vacuous (this generator names no shape); **it pointed at the one thing that breaks
grading.** Do not "fix" the missing `shapeLabel` call.

Consequence: the quiz-side `componentLabel` **deliberately differs from the web
copy**, which keeps the extension (pinned at `e2e/psq.e2e.ts:453-454`). They cannot
be shared — `apps/web` does not depend on `@psq/quiz` and must not, as that pulls
the `better-sqlite3` sandbox into a browser bundle. The divergence is load-bearing
and is gated: `test/component-label.test.ts:88-101` goes `expected 1 to be 2` the
moment anyone re-aligns them.

## Why the fixture grew

`mini-fullstack-react` had **2 components and 4 calls, both components tied at 2**
(the `save-card.ts` call D2 added is attributed to both) — against `mostConnected`'s
`length < 4` floor *and* its skip-on-tie guard. Two new components named `Panel`
(3 and 1 calls) give 4 components with a unique top of 3, 8 calls, unattributed
still 1, `matches: null` now 2. `server.ts` was **not** touched, which keeps D2's
exact `routes` array and its 25/30 line pins green for free.

The names are paired deliberately: every choice is then file-disambiguated, which
is what makes the fixture a regression gate for the `normalize()` trap above, and
it avoids an answer-shape tell (with a pool of exactly 3, `sample(pool, 3)` always
returns all four components, so a single uniquely-named top would be the only bare
choice in the list).

**Rev 1 of the plan justified this growth with a false premise** — see below.

## Gates

| Gate | Baseline (`c7d4128`) | Result |
|---|---|---|
| probe, before dependent edits | — | 4 components; top 3 unique; unattributed 1; `matches: null` 2; `warnings` `[]` |
| `pnpm typecheck` | clean | clean, all four projects |
| `PSQ_NO_CORPUS=1 pnpm test` | 250 \| 58 (295→308) | **272 \| 58 (330)**, 0 failed |
| `pnpm test` | 308 | **330**, 0 failed |
| `pnpm test:e2e` | 22 | **23**, 0 failed |
| fixture selftest | 2 questions, exit 0 | **3**, includes `most-calls`, exit 0 |
| control (a) registration removed | — | exactly the 4 `client-quiz.test.ts` cases fail; other two files stay green |
| control (b) extension kept | — | question dropped by `choicesCollide()`; 4 cases fail |
| control (b) deep, guard stubbed | — | selftest reports the §1 pair verbatim |
| control (b1) guard removed | — | exactly the 2 cases it exists for fail; counter-case stays green |
| control (c) bare labels | — | **no question emitted** (dedupe before the floor), *not* a selftest finding |
| control (d) tie guard deleted | — | synthetic tie case fails |
| control (e) answer → runner-up | — | fails; `choices` length assertion still catches a 4-choice mis-point |
| determinism | — | seeds 1337/1338: repeated seed byte-identical, two seeds differ in order, same answer |
| fuzz (reviewer) | — | 40,000 graphs over case twins / dotted dirs / one-char names: 30,422 emitted, **0** leaks |
| `git show --stat` | — | exactly the 13 paths |

## Review history

1. **Plan review (rev 1)** — "fix first", three blocking. It overturned two
   premises: the label format (below), and the claim that no input in existence
   makes the generator fire. Rev 2 rewritten around the measurements.
2. **Implementation review** — "fix first", two blocking (B1 the proxy guard, B2 a
   false because-clause in the audit).
3. **Targeted re-review** — **Ship.** It fuzzed the guard swap rather than reading
   it, and confirmed the implementer's pushback against the orchestrator.

## The correction most worth remembering

**A guard whose docstring named the real invariant while its code checked a proxy —
and the supersession claim that was itself wrong in one direction.**

The shipped guard was specified (D-E-3a) as *"drop the question if any choice
contains a `.`"*. Its docstring claimed it enforced "a choice that cannot be graded
deterministically". Those are not the same thing. The invariant `selftest` enforces
is **no two choices normalize alike**; a dot is one way to break it, and **case is
another** — `refs.ts:69-70` admits both `Api` and `API`, distinct under an exact
name comparison, so both get bare labels and neither holds a dot. Measured, the
generator emitted `['Charlie','Api','Bravo','API']`, which selftest reported as
`choices collide after normalization` **and** `reference answer is graded wrong` —
it mis-grades, not merely gets flagged. Rule 1 says drop it; the code shipped it.

Then the instruction to fix it said the new `normalize()`-collision check
"**subsumes** the dot rule". **That was wrong, and the implementer refused it with
a measurement.** The new check is stricter *and looser*: a **single** dotted
directory among clean labels does not collide —

```
["Card (src/v1.2/Card)", "Card (src/v2/Card)", "Bravo", "Charlie"]
  -> ["2/card)", "card (src/v2/card)", "bravo", "charlie"]   collides: false
```

— and that question was measured to grade correctly end to end, every choice
individually selectable by text. So the old rule had been **dropping a gradable
question**, and the old unit test asserted a drop rule 1 never required. Both
directions are now pinned: the colliding variant as dropped, the non-colliding one
as *still asked*.

Two lessons, and the second is the one that generalises. First: when a guard's
comment names a rule, check that the code tests the rule and not a symptom of it.
Second: **a correction is not exempt from the verification it demands.** The
"subsumes" claim was asserted by the orchestrator, in the middle of fixing a
finding about unverified claims, and it took a measurement from the implementer to
kill it — the same shape as D2's false because-clause, one level up.

## What the next phase needs to know

- **D2's two deferred debts are CLEARED**: the e2e spec is split into two `it`s
  (22 → 23, desktop page now closed on the failing path), and `/shapes` is now
  asserted *not* to carry `clientCalls`/`components`, guarding D-D-12.
- **The CLI and the server ask different questions from the same repo.**
  Pre-existing, measured this phase, **not fixed**: `apps/cli/src/index.ts:96`
  passes the question seed raw (so `undefined` → each generator falls back to
  `hashSeed(g.repo)`), while `apps/server/src/workspace.ts:137-139` uses
  `opts.seed ?? 1337`. The *data* seed already matches in both shells
  (`index.ts:95` is `seed ?? 1337`), so only sampling diverges. **Consequence: a
  green `psq selftest` does not imply the served bank is green.** This is the most
  load-bearing thing in this record.
- **The corpus client root's "1 finding" is seed-dependent**, not a property of the
  repo: 1 finding at the CLI's default seed, **0 at 1337**. Choice lengths on the
  offending question are `[1,8,9,11]` vs `[5,13,8,11]` — a one-character choice is
  drawn at one seed and not the other. Any future gate must pin the seed too.
- **`grade.ts:52` is a live bug in the bank**: a one-character choice is swallowed
  by the option-letter shortcut before the text branch runs, so it can never be
  selected by text. One confirmed casualty today, from `not-a-member` on the corpus
  client root. This generator sidesteps it (`unselectable()`); nothing fixes it.
- **All three guard paths are covered only synthetically.** Measured across every
  root that yields components — 354 components over five roots (1/4/15/133/201) —
  there are **zero** case twins, **zero** dotted paths and **zero** one-character
  names. Deliberately not fixed, and **do not "fix" it by growing
  `mini-fullstack-react`**: a case twin there would suppress `client.busiest` on
  the only hermetic root where it fires, destroying the coverage this phase grew
  the fixture for. The guards are pure functions of a string list, so a fixture
  adds no fidelity (unlike the attribution owner-walk, which genuinely needed real
  extraction and got gate 1 for it). If ever wanted hermetically, use a fourth
  fixture — `MINI_SOLUTION_TIE` is the precedent: no e2e constant, no harness entry.
- **Question *existence* is seed-dependent on a repo holding a case twin**, since
  `choicesCollide()` reads the sampled list. Measured on a synthetic 8-component
  graph: **32 of 40 seeds emit, 8 drop**, deterministic at every seed (so rule 7 is
  not in play). Composed with the seed asymmetry above, the two shells could
  disagree about whether the question exists at all. Not observed on any real root.
- **The live service will not serve these questions without a restart.** D2's "no
  restart needed" argument was about `apps/web/dist`, a static bundle read per
  request. This changes `packages/quiz` *source*, which pid 16538 `tsx`-loaded at
  `Fri Sep 4 15:05:56`. Deploy remains James's call (D-C-8).
- **`test/client-quiz.test.ts` must keep going through `buildBank`.** It is the
  only thing in the suite proving the single-composition-point rule; calling
  `generateClientMcq` directly would make control (a) vacuous. It needs a
  `SeededDb` from `materialize` for that reason alone.
- **Unit tests live in root `test/`, never `packages/quiz/test/`** — root
  `tsconfig.json` includes `test/**/*.ts` but not `packages/*/test/**`, so the
  latter is typechecked by nothing. Same trap D2 recorded for `apps/web/test`.
- **`README.md:25-38`'s milestone table still has no M5c row**, and nothing gates
  it. Offered and not taken this phase.
- Carried forward unchanged: drift-site id collisions; no Dockerfile, no CI; the
  corpus config is the only copy of the ground truth, and a dropped test count is
  the only signal it vanished.
- **Deferred milestones remaining** (from the MVP table): quiz history / weak-area
  persistence keyed by repo id, and the .NET route reader — M5b's remaining half,
  without which "which endpoint touches which table" has no .NET side.
