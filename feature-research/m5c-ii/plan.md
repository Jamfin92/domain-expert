# Phase E — M5c-ii: the comparative client-call generator — PLAN (rev 2)

**Status: awaiting approval.** Rev 1 went to the reviewer and came back "fix
first" with three blocking findings; two of them overturned premises rev 1 was
built on. Both were re-measured independently before this rewrite. §10 records
what changed and why.

Previous phase record: `feature-research/m5c-i/progress-d2.md`.
Baseline: `master` = `m5c-i-web` = `origin/master` = **`c7d4128`**, tree clean,
nothing unpushed. (`cd54ac2` is D2's *code* commit; `c7d4128` is the record on
top of it. The D2 record's "SHIPPED at `cd54ac2`" is true of the code and stale
as a description of where `master` points.)

Spec, verbatim, from `feature-research/green-and-push/progress.md`:

> | E | **M5c-ii**: one comparative question generator over components/calls (the
> `mostConnected` idiom: graded answer is a name, count in the rationale),
> registered in `bank.ts`, passes `selftest` both ways | medium |

---

## 1. The finding that shapes this phase

**A disambiguated label of the form `Name (path/File.tsx)` cannot be used as MCQ
choice text. It is not merely ambiguous — it makes the question unfailable,
violating rule 5.**

`packages/quiz/src/normalize.ts:14-25` drops "namespace qualification on the head
symbol" by slicing at the **last `.` in the whole string**. With no `<` present,
the head *is* the entire string, so a filename extension eats everything before
it. Measured against the repo's real `normalize`:

```
"Card (src/components/admin/Card.tsx)"   -> "tsx)"
"Card (src/components/shop/Card.tsx)"    -> "tsx)"
"Panel (src/components/admin/Panel.tsx)" -> "tsx)"
```

All four choices of such an MCQ normalize to the identical string `"tsx)"`. Then
`grade.ts:53` (`choices.findIndex(c => normalize(c) === normalize(trimmed))`)
returns index 0 for *any* text answer, so the reference answer grades wrong
whenever `answerIndex !== 0`, and no mutation can ever be wrong. `selftest`
reports both `choices collide after normalization` (`selftest.ts:84-85`) and
`reference answer is graded wrong`. The milestone's own bar — "passes `selftest`
both ways" — is unmeetable with that format.

Note the trap precisely, because it is not obvious: **`shapeLabel` produces this
same format and is perfectly safe**, because it is only ever interpolated into
**prompts** (`ds-mcq.ts:125,148,182`, `ds-cloze.ts:70,91`), which `normalize()`
never touches. The format is safe in a prompt and unsafe in a choice. Reasoning
"`shapeLabel` does it, so we can" — which rev 1 did — is exactly the unverified
because-clause this project already has a lesson about.

**Measured-safe formats** (two different components never collide):

| Format | `normalize()` result | Verdict |
|---|---|---|
| `Card (src/components/admin/Card.tsx)` | `tsx)` | **unsafe** |
| `Card (src/components/admin/Card)` | unchanged, lowercased | safe |
| `admin/Card` | `admin/card` | safe |
| `Card [admin]` | `card [admin]` | safe |

The rule is simply: **any `.` anywhere in the label is fatal.** Brackets and
slashes do not protect it — `Card [src/x/Card.tsx]` collapses to `tsx]` too.

## 2. The second correction: the generator already fires on a real repo

Rev 1 claimed no input in existence makes this generator fire. **That was wrong.**
The committed template `test/corpus.local.example.json` declares no client
expectations, but the live (gitignored) `test/corpus.local.json` declares a
**`repoAClient`** entry with `componentChains`, pinned by
`packages/extract/test/node.test.ts:178-210`. Measured on it:

| Metric | Value |
|---|---|
| components | 201 |
| clientCalls | 50 |
| components with ≥1 call | 31 |
| top per-component counts | **11**, then 7, 7, 7, 7 — top is strictly unique |
| components sharing a name with another | 50 |
| **highest call count among name-sharing components** | **0** |

So the `mostConnected` guards (`length < 4`, tie-at-top) both pass and the
generator produces a question there today, unchanged. Every component with a
nonzero call count has a unique name, so on this repo the answer is a bare name
and the disambiguation path never fires — which is exactly why the hermetic
fixture must carry the collision (§4).

**What this changes:** fixture growth is no longer a precondition for the
generator to exist. It is now justified as **the hermetic control** — the corpus
is gitignored, so on any machine without it (and under the standing
`PSQ_NO_CORPUS=1` gate) the client generator would otherwise have *zero*
coverage, and a vanished corpus already shows up only as a dropped test count.
That is a good reason, and a different one from the one rev 1 gave.

## 3. Decisions

- **D-E-1 — grow `mini-fullstack-react` as the hermetic control.** Rev 1 argued a
  fourth fixture would cost an e2e constant and a harness entry; that was wrong —
  `MINI_SOLUTION_TIE` has neither (`test/fixtures.ts:101`, used only by
  `test/mini-react.test.ts`). The honest trade: a dedicated fixture touches zero
  existing pins, while growing the shared one touches three exact-equality sites
  across three files. I still prefer growing it — one fullstack fixture stays the
  single source of truth, and those pins are *loud*: they cannot drift silently.
  **This is a reasonable place to overrule me.**
- **D-E-2 — MCQ, mirroring `mostConnected`.** The spec names the idiom.
- **D-E-3 — `componentLabel` lives in `@psq/quiz`, duplicated from the web copy,
  and deliberately produces a *different string*.** The quiz label drops the file
  extension (`Card (src/components/admin/Card)`); the panel keeps it
  (`Card (src/components/admin/Card.tsx)`, pinned at `e2e/psq.e2e.ts:453-454`).
  They must differ, because the panel's format is fatal in choice text (§1).
  Rev 1's requirement that the two copies "agree on output format" is withdrawn
  as impossible. They cannot be shared either: `apps/web` does not depend on
  `@psq/quiz` and must not — that would pull the `better-sqlite3` seed/sandbox
  into a browser bundle.
- **D-E-3a — a belt-and-braces guard.** `componentLabel` strips the extension,
  but a path can hold another dot (`src/v1.2/Card.tsx`). The generator therefore
  **drops the question if any choice still contains a `.`** — rule 1: a question
  that cannot be graded deterministically does not ship. Neither known input
  triggers it.

  > **SUPERSEDED 2026-09-08, at implementation review.** The no-dot rule guarded
  > a *proxy*. The invariant `selftest` enforces is that no two choices normalize
  > alike, and a dot is only one way to break it — **case is another**:
  > `refs.ts:69-70` admits both `Api` and `API`, which are distinct under
  > `component-label.ts`'s exact name comparison, so both get bare labels and
  > neither holds a dot. Measured, the generator emitted
  > `['Charlie', 'Api', 'Bravo', 'API']`, which selftest then reported as
  > `choices collide after normalization` **and** `reference answer is graded
  > wrong (chose API, answer is Api)` — it mis-grades, not merely gets flagged.
  >
  > Shipped instead: `choicesCollide()`, a `normalize()`-collision check on the
  > final choice list, plus `unselectable()` for the single-character case
  > (D-E-3b, which remains a genuinely separate failure mode). **The new check is
  > not a superset of the old one** — I asserted it was, and that was wrong in
  > one direction. It is stricter (it catches the caseless collision) and looser:
  > a *single* dotted directory among clean labels does not collide, and that
  > question was measured to grade correctly end to end, so rule 1 never required
  > dropping it. The old rule dropped a gradable question. Both directions are
  > now pinned — the colliding variant as dropped, the non-colliding one as
  > **still asked**.
- **D-E-3b — drop the question if any choice is a single character.** Measured
  cause of the *existing* `repoAClient` selftest failure: `grade.ts:50` treats a
  one-letter answer as an option letter before the text branch runs, so a
  one-character choice can never be selected by text. That bug is not this
  phase's to fix, but shipping into it would be.
- **D-E-4 — `shapeLabel` is not called, and the carry-forward instruction that
  said to call it was a trap, not merely vacuous.** This generator names no
  shape. What the instruction was really pointing at — copying `shapeLabel`'s
  output format — is the thing that breaks grading (§1). Recorded so the next
  reader does not "fix" the missing call.
- **D-E-5 — a call attributed to N components counts once for each**, matching
  how the D2 panel groups rows.
- **D-E-6 — `server.ts` is not touched.** Keeps the exact `routes` array pin and
  the `server.ts` 25/30 line pins green for free.

## 4. The generator

New `packages/quiz/src/generate/component-label.ts`:

```
export function componentLabel(g: EntityGraph, component: Component): string
```
Returns `component.name` when the name is unique in `g.components`; otherwise
`` `${name} (${file without its extension})` ``. Mirrors `shape-label.ts`'s
signature and minimal-disambiguation behaviour, and differs from it *only* by
dropping the extension — with the reason in a comment, naming `normalize.ts`.

New `packages/quiz/src/generate/client-mcq.ts`, structurally mirroring
`entity-mcq.ts`: private `Ctx { g, rnd }`, a local `mcq()` builder (the existing
one hardcodes `section: "entity"`), a `GENERATORS` array, and

```
export function generateClientMcq(g: EntityGraph, seed?: number): Question[]
```

One sub-generator, `busiestComponent`:

- **id** `client.busiest`, **generator** `"most-calls"`, **section** `"client"`,
  **kind** `"mcq"`, **gradeMode** `"choice"`.
- **prompt** — "Which component makes the most API calls?"
- **answer** `componentLabel(g, top)`; **distractors** the other components' labels.
- **subjects** `[top.name]` — the bare name, consistent with every other
  generator (`ds-mcq.ts` uses `[shape.name]`, not the label). A colliding name
  gives two components one shared subject; that is the right grouping for a
  weak-area signal, and it keeps `Quiz.tsx:126`'s rendered subject list readable.
- **rationale** — "`<label>` makes N API calls; the next highest is `<label>`
  with M." The count lives here, never in the graded field.
- **guards**, in order: fewer than 4 components → `[]`; top count 0 → `[]`; tie
  at the top → `[]`; any choice contains `.` (D-E-3a) or is one character
  (D-E-3b) → `[]`; `mcq()` returns `null` → `[]`.
- **determinism** — counts into a `Map`, sorted by count desc then key asc,
  before any use of `rnd`. Seeded `rng` only (rule 7).

Registered in `packages/quiz/src/bank.ts` — the single composition point — and
re-exported from `packages/quiz/src/index.ts`.

## 5. The fixture change

Two new components, **both named `Panel`**, one per existing directory:

| New file | Component | Calls |
|---|---|---|
| `src/components/admin/Panel.tsx` | `Panel` | 3 — `POST /api/admin/cards`, `GET /api/cards`, `GET /api/admin/stats` (unmatched) |
| `src/components/shop/Panel.tsx` | `Panel` | 1 — `GET /api/cards` |

Resulting: **4 components**; admin/Panel **3**, admin/Card **2**, shop/Card
**2**, shop/Panel **1** — top unique. **8 calls**; unattributed stays **1**;
`matches: null` becomes **2**.

Two deliberate properties:

- **The names are paired so every choice is file-disambiguated.** This is the
  regression gate for §1: had the fixture carried it in rev 1, the `normalize()`
  collapse would have failed a gate instead of surviving to review. It also
  avoids an answer-shape tell (with a pool of exactly 3, `sample(pool, 3)` always
  yields all four components, so a single uniquely-named top would be the only
  bare choice in the list).
- **The third admin/Panel call is intentionally unmatched**, rather than
  repeating a `(method, path)` pair. With only two routes and `server.ts`
  untouched (D-E-6), the alternative was two identical rows under one header,
  which muddies the fixture's "one row of every kind" doctrine and makes
  positional row assertions ambiguous.

New components must mirror `Card.tsx`'s structure so the attribution owner-walk
reaches them. Gate 1 is what proves it did — not inspection.

## 6. Carried-in debt from D2 (deferred to this phase by James)

- **Split the e2e client-call spec into two `it`s** (`e2e/psq.e2e.ts:443-489`):
  today a desktop-half failure means the browser half never runs and the message
  does not say which shell broke; the desktop `page` is also left unclosed on a
  failing path. Total moves **22 → 23**.
- **Assert `/shapes` does *not* carry `clientCalls`/`components`** — nothing does
  today, so a future re-projection would pass every gate. Guards D-D-12.

Both are separable; say the word and either drops.

## 7. Files touched

| # | Path | Change |
|---|---|---|
| 1 | `packages/quiz/src/generate/component-label.ts` | **new** |
| 2 | `packages/quiz/src/generate/client-mcq.ts` | **new** |
| 3 | `packages/quiz/src/bank.ts` | register the generator |
| 4 | `packages/quiz/src/index.ts` | export both new symbols |
| 5 | `test/component-label.test.ts` | **new** — mirrors `test/shape-label.test.ts` (unique / twin / three-way / real graph / case-sensitivity) |
| 6 | `test/client-mcq.test.ts` | **new** — unit tests on synthetic graphs: tie → none, <4 → none, dot-in-path → none, one-char label → none, determinism |
| 7 | `test/client-quiz.test.ts` | **new** — fixture gate **through `buildBank`** (see gate 7a) |
| 8 | `test/fixtures/mini-fullstack-react/src/components/admin/Panel.tsx` | **new** |
| 9 | `test/fixtures/mini-fullstack-react/src/components/shop/Panel.tsx` | **new** |
| 10 | `test/mini-fullstack-react.test.ts` | re-pin components (L57-70), distinct names (L73), calls (L77-122); refresh comments L71-72, L78 |
| 11 | `test/fixtures.ts` | update the `MINI_FULLSTACK_REACT` docstring (L78-95) — it currently describes 2 components and one row of each kind |
| 12 | `apps/server/test/api.test.ts` | re-pin `toHaveLength(2)` (L376) and distinct names (L377); refresh comment L374-375; add the `/shapes` negative assertion |
| 13 | `e2e/psq.e2e.ts` | re-pin L451 (3→5), L453-456 (order), L461/L485 (5→9), L467 (1→2); refresh comments L448-449, L458-459, L496; split into two `it`s |

**Unit tests live in root `test/`, not `packages/quiz/test/`** — root
`tsconfig.json` includes `test/**/*.ts` but not `packages/*/test/**`, so the
latter is typechecked by nothing. That is the same trap D2 recorded for
`apps/web/test`; `shape-label`'s own test already sits in root `test/`.

**Not re-pinned, verified unchanged:** `api.test.ts:358-364` (`both[0]` stays
byte-identical — `clientCalls` sorts by file then line, and `admin/Card.tsx` <
`admin/Panel.tsx`) and `e2e/psq.e2e.ts:487`.

**Not touched:** the fixture's `server.ts`, `apps/web/**`, `packages/schema`
(`Section` already has `client`), `apps/cli`, `apps/server/src`.

## 8. Gates

Every count re-derived from gate 1, never guessed.

1. **Probe, before any dependent edit** — after the fixture change alone: 4
   components; top = 3 unique; unattributed 1; `matches: null` 2; `warnings`
   `[]`. **If the new components do not appear, stop.**
2. `pnpm typecheck` — clean, all four projects.
3. `PSQ_NO_CORPUS=1 pnpm test` — baseline **250 | 58 (308)**; the new hermetic
   client tests must appear here, since this is the corpus-less gate.
4. `pnpm test` — baseline **308**, 0 failed.
5. `pnpm test:e2e` — baseline **22**, expect **23**, 0 failed.
6. **selftest.** On `mini-fullstack-react`: exit 0, and the question count must
   rise from **2** and include `client.busiest`. On the other roots: record
   counts. **`repoAClient` exits 1 today with exactly 1 finding** (a
   pre-existing `not-a-member` bug — a one-character choice swallowed by
   `grade.ts:50`'s option-letter shortcut, unrelated to this work). Pin that
   count at **1**; "exit 0 on six roots" is the wrong gate and never covered this
   repo.
7. **Negative controls** — each must fail, with the stated message:
   - (a) remove the `bank.ts` registration → `test/client-quiz.test.ts` fails.
     This is the only thing proving the single-composition-point rule was
     honoured, and it works **only because that test goes through `buildBank`**
     (which also needs a `SeededDb` from `materialize`). Calling
     `generateClientMcq` directly would make this control vacuous.
   - (b) make `componentLabel` keep the `.tsx` extension → selftest fails with
     `choices collide after normalization`. This is the §1 regression control;
     its positive half is that the same test passes with the extension stripped.

     > **CORRECTED 2026-09-08, during the M5c-ii build.** As written this
     > control is unreachable, and the plan contradicts itself: **D-E-3a's
     > no-dot guard fires first.** With the extension kept, every label holds a
     > `.`, the generator drops the question, and selftest never sees it — so
     > the measured failure is `test/client-quiz.test.ts` reporting
     > `expected [] to have a length of 1 but got +0`, the same message as
     > control (c), not a selftest finding.
     >
     > Both halves were measured. Extension kept, guard intact: 4 cases in
     > `client-quiz.test.ts` fail, `selftest(bank)` stays empty. Extension kept
     > **and** `ungradable()` stubbed to `false`: selftest reports exactly the
     > §1 pair —
     > `choices collide after normalization` **and**
     > `reference answer is graded wrong (chose Panel (src/components/shop/Panel.tsx), answer is Panel (src/components/admin/Panel.tsx))`.
     >
     > So §1's mechanism is real and reproduced; what the plan got wrong is
     > which gate catches it. The two-step form above is the control that was
     > actually run, and it is the stronger one: it proves the guard stands in
     > front of a live failure rather than in front of nothing.
     >
     > **AMENDED 2026-09-08, at implementation review.** The block above is
     > itself now stale in its *mechanism*, though not in its conclusion:
     > `ungradable()` and the no-dot guard it names **do not exist** in the
     > shipped code (see the supersession note under D-E-3a). The control still
     > drops the question and still needs the two-step form, but the drop is
     > caused by `choicesCollide()`. The deep half stubs `choicesCollide()`, not
     > `ungradable()`, and reproduces the same §1 pair verbatim. A third control
     > (b1) was added that did not exist at plan time: removing the guard
     > entirely fails exactly the two cases it exists for while the
     > non-colliding counter-case stays green — so the guard is pinned as
     > neither under- nor over-firing.
   - (c) make `componentLabel` always return the bare name → the generator emits
     **nothing** (the `new Set` dedupe at `entity-mcq.ts:39` collapses the two
     `Panel`s and the two `Cards`, leaving a pool of 1 < the floor), so the
     failure is `client-quiz.test.ts` reporting no question — **not** a selftest
     finding. Rev 1 predicted the wrong failure here.
   - (d) delete the tie guard → the synthetic tie unit test fails.
   - (e) point the answer at a non-top component → the fixture gate fails.
8. **Determinism** — seeds **1337** and **1338** (the precedent in
   `packages/quiz/test/quiz.test.ts:26`): same seed twice → `toEqual`; the two
   seeds → different choice order, with both orders recorded. Not "any two
   seeds": over seeds 1-40 the `sample`+`shuffle` pipeline yields only 21
   distinct orders for a 4-choice question, so an unnamed pair is flaky.
9. `git show --stat` — exactly the 13 paths in §7. The phase record commits
   **separately**, per the D2 convention (`cd54ac2` code, `c7d4128` record).

## 9. Risks, stated

- **Two `componentLabel` copies now deliberately disagree** (D-E-3), and nothing
  gates the divergence. The quiz-side comment naming `normalize.ts` is the only
  thing standing between a future reader and "helpfully" re-aligning them, which
  would silently reintroduce §1.
- **The live service will not serve these questions without a restart.** D2's
  "no restart needed" argument was about `apps/web/dist`, a static bundle read
  per request. This changes `packages/quiz` *source*, which pid 16538
  `tsx`-loaded at `Fri Sep 4 15:05:56`. Deploy remains James's call (D-C-8).
- **`grade.ts:50`'s option-letter shortcut is a live bug** in the bank
  (one confirmed casualty on `repoAClient`). D-E-3b sidesteps it; it is not
  fixed.
- **Weak hermetic bank floor.** The fixture's whole bank is 2 questions, because
  with 1 entity and 0 shapes most generators hit `MIN_CHOICES` and return `null`.
  Gate 7(a) is what stops a passing selftest there from being vacuous.
- **`README.md:25-38`'s milestone table has no M5c row** and nothing gates it.
  Cheap to fold in while the phase is open — say if you want it.

## 10. What changed from rev 1, and why

| Rev 1 said | Rev 2 says | Because |
|---|---|---|
| Label as `Name (file.tsx)`, mirroring `shapeLabel` | Extension stripped, plus a no-dot guard | Measured: `normalize()` collapses every such label to `tsx)`, making the question unfailable |
| "The generator cannot fire on any input in existence" | It fires on `repoAClient` today | Measured: 201 components, 50 calls, top 11 unique. Rev 1 read the committed *template*, not the live corpus config |
| Fixture growth is a precondition | Fixture growth is the hermetic control | Follows from the above; the reason changed, the work mostly did not |
| Gate: bare-name label → colliding-choices selftest finding | → generator emits nothing | Dedupe happens before the choice floor, so a duplicate-choice question can never reach selftest from an `mcq()`-built generator |
| Gate: "selftest exit 0 on all six roots" | Pin `repoAClient` at exactly 1 finding | It exits 1 today, pre-existing and unrelated |
| Unit tests in `packages/quiz/test/` | Root `test/` | `packages/*/test/**` is typechecked by nothing |
| 3 admin/Panel calls reusing existing routes | One of them unmatched | Avoids two identical rows under one header |
| D-E-1: a 4th fixture costs a harness entry | It costs neither | `MINI_SOLUTION_TIE` has no e2e constant and no harness entry |
