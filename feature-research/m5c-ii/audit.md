# Phase E — M5c-ii: the comparative client-call generator — AUDIT

Branch `m5c-ii-client-generator`, branched from `master` = `c7d4128`.
Code commit **`f9f5089`**, amended to **`7dbc101`** after review, **not
pushed**. The phase record commits separately
(D2 convention). Plan: `feature-research/m5c-ii/plan.md` (rev 2), followed
verbatim except for one line corrected in place — see §5.

---

## Files changed

Exactly the 13 paths in plan §7, and nothing else.

| # | Path | New / modified |
|---|---|---|
| 1 | `packages/quiz/src/generate/component-label.ts` | new |
| 2 | `packages/quiz/src/generate/client-mcq.ts` | new |
| 3 | `packages/quiz/src/bank.ts` | modified |
| 4 | `packages/quiz/src/index.ts` | modified |
| 5 | `test/component-label.test.ts` | new |
| 6 | `test/client-mcq.test.ts` | new |
| 7 | `test/client-quiz.test.ts` | new |
| 8 | `test/fixtures/mini-fullstack-react/src/components/admin/Panel.tsx` | new |
| 9 | `test/fixtures/mini-fullstack-react/src/components/shop/Panel.tsx` | new |
| 10 | `test/mini-fullstack-react.test.ts` | modified |
| 11 | `test/fixtures.ts` | modified |
| 12 | `apps/server/test/api.test.ts` | modified |
| 13 | `e2e/psq.e2e.ts` | modified |

`feature-research/m5c-ii/plan.md` and this file are **untracked and
uncommitted** — deliberately outside the code commit.

Not touched, as the plan requires: the fixture's `server.ts` (D-E-6 —
`git show` carries no diff line for it, so the routes 25/30 pins are
untouched for free), `apps/web/**`, `packages/schema`, `apps/cli`,
`apps/server/src`.

---

## 1. Gate 1 — the probe, before any dependent edit

Run against the grown fixture with the generator not yet written. Every
downstream number in this audit is derived from this output.

```
warnings: []
components: 4
  src/components/admin/Card.tsx#Card    Card   src/components/admin/Card.tsx   line 11
  src/components/admin/Panel.tsx#Panel  Panel  src/components/admin/Panel.tsx  line 11
  src/components/shop/Card.tsx#Card     Card   src/components/shop/Card.tsx    line 11
  src/components/shop/Panel.tsx#Panel   Panel  src/components/shop/Panel.tsx   line 6
clientCalls: 8
per-component counts:
  src/components/admin/Panel.tsx#Panel  3
  src/components/admin/Card.tsx#Card    2
  src/components/shop/Card.tsx#Card     2
  src/components/shop/Panel.tsx#Panel   1
unattributed: 1
matches null: 2
distinct names: 2
routes: POST /api/admin/cards (server.ts:25), GET /api/cards (server.ts:30)
```

**Every prediction in plan §8.1 reproduced exactly**: 4 components; top count
3, strictly unique; unattributed 1; `matches: null` 2; `warnings` `[]`. Both
new components appear in `g.components`, so the attribution owner-walk reached
them — nothing was worked around.

Numbers derived from it and used below:

- component call rows in the panel = 8 calls, one of which (`save-card.ts`)
  carries two keys → **9 rows**;
- panel headers = 4 components with calls + 1 unattributed bucket → **5**;
- `no matching route` rows → **2**;
- `g.components.length` **4**, distinct names **2**;
- `both[0]` (matched ∧ attributed, sorted by file then line) is still
  `src/components/admin/Card.tsx`, so `api.test.ts`'s positional
  `toMatchObject` pin did not need re-pinning — as the plan predicted.

`src/components/shop/Panel.tsx` declares its component at line **6**, not 11:
its docstring is four lines shorter than the others'. Pinned as measured.

---

## 2. What changed, per file

### `packages/quiz/src/generate/component-label.ts` (new)

`componentLabel(g, component)` — the bare `name` when unique in
`g.components`, else `` `${name} (${file with its last extension dropped})` ``.
Mirrors `shape-label.ts`'s signature, loop and case-sensitivity.

The docstring states the reason the two copies differ, at the mechanism, and
names `normalize.ts:20-24`, `grade.ts:53` and `selftest`. Every clause in it is
measured (§5, control b-deep), not inferred. It also says explicitly: *do not
re-align the two copies*, and why `shapeLabel`'s identical-looking format is
safe (prompts are never normalized).

The extension regex is `/\.[^./]*$/` — anchored and excluding `/`, so it can
never eat a directory separator.

Its closing paragraph originally pointed at a no-dot guard in `client-mcq.ts`;
after review it points at `choicesCollide()` and explains that a dot is not the
only way two labels reduce to one string (§5, B1).

### `packages/quiz/src/generate/client-mcq.ts` (new)

Structure mirrors `entity-mcq.ts` / `ds-mcq.ts`: private `Ctx { g, rnd }`, a
local `mcq()` builder (needed because the existing ones hardcode their
section), a `GENERATORS` array, and `generateClientMcq(g, seed?)`.

One sub-generator, `busiestComponent`, exactly as specified: id
`client.busiest`, generator `"most-calls"`, section `"client"`, kind `"mcq"`,
gradeMode `"choice"`, prompt "Which component makes the most API calls?",
answer `componentLabel(g, top)`, distractors the other components' labels,
subjects `[top.component.name]` (the bare name), rationale carrying both
counts.

Guards, in order: `components.length < 4` → `[]`; top count 0 → `[]`; tie at
the top → `[]`; the **answer** unselectable → `[]`; unselectable distractors
filtered out of the pool; `mcq()` null (pool below `MIN_CHOICES`) → `[]`; the
**final choice list** colliding under `normalize()` → `[]`.

Determinism (rule 7): counts are accumulated into a `Map` and the ranking is
sorted by count descending then **key** ascending — a total order, since two
components can share a name but never a key — all before the first touch of
`rnd`. Seeded `rng` only; no `Math.random` anywhere in the file.

The last guard reads the sampled list rather than the candidate pool, because
that list is what `selftest.ts:84-85` sees. This is the post-review shape; §5
records what it replaced and why.

### `packages/quiz/src/bank.ts`, `index.ts`

`...generateClientMcq(g, seed)` added to the single composition point;
`generateClientMcq` and `componentLabel` exported. No other change.

### `test/fixtures/mini-fullstack-react/src/components/{admin,shop}/Panel.tsx` (new)

`admin/Panel` — 3 calls: `POST /api/admin/cards`, `GET /api/cards`, and
`GET /api/admin/stats`, the last deliberately unmatched. `shop/Panel` — 1
call, `GET /api/cards`. Both mirror `Card.tsx`'s structure (exported
PascalCase function, JSX return, `fetch` inside a nested arrow function); gate
1 is what proves the owner-walk reached them.

### `test/component-label.test.ts` (new, 6 cases)

Mirrors `test/shape-label.test.ts`: unique name, twin, three-way, real graph,
case sensitivity — the last of these now carrying an explicit note that its
two labels DO collide under `normalize()`, that `shapeLabel`'s reason for
tolerating them (prompts are never normalized) does not carry over into choice
text, and that the hazard is caught downstream by `choicesCollide()` rather
than here. The note is pinned by an assertion, not left as prose.

Plus one case this phase needs and `shape-label`'s does not:
`survives normalize(), which the web copy's format does not` — asserting the
quiz labels give 2 distinct normalized strings while the web format gives
`["tsx)", "tsx)"]`, i.e. 1. The web format is spelled out inline rather than
imported, because `apps/web` is not a dependency of this package and must not
become one.

### `test/client-mcq.test.ts` (new, 11 cases)

Synthetic graphs, one per guard: emits-one (the positive control), tie,
fewer-than-four, nothing-calls-anything, two dotted paths colliding, **one
dotted path NOT colliding (still asks)**, **two names differing only in case**,
one-character **answer**, one-character **distractor (still asks)**, pool
emptied below the floor, determinism. The negative cases that could pass
vacuously carry their own positive control beside them.

### `test/client-quiz.test.ts` (new, 4 cases)

**Goes through `buildBank`**, with a `SeededDb` from `materialize(g, {seed:
1337})` — not `generateClientMcq` directly. That is the point: it is the only
thing in the suite that fails when the `bank.ts` registration is removed
(control a, proven). It pins the choice set, the answer, the subjects, the
exact rationale string, that no choice carries a digit, that the whole
hermetic bank selftests clean, and that `sections: ["client"]` filters to it.

### `test/mini-fullstack-react.test.ts` (modified)

Re-pinned: the full 4-entry `g.components` array; distinct names `1 → 2`, plus
an explicit `toHaveLength(4)`; the full 8-entry `clientCalls` array with the
four new rows in their sorted positions; and a new per-component count
assertion (3/2/2/1) inside the same case, which is the pin `client.busiest`
actually depends on.

Two case names changed, because the fixture falsified them, and **both
cross-references were chased**:

- `"keeps two same-named components apart by key"` → `"keeps same-named
  components apart by key"`. Its comment claimed the two are indistinguishable
  by name; rewritten to state the stronger property that now holds — every
  component shares its name with exactly one other, so both label rules always
  take their disambiguating branch.
- `"holds one row of every kind the panel renders"` → `"holds at least one row
  of every kind…"`. The fixture now holds two unmatched rows and two
  matched-and-attributed ones.

The warnings case's comment at `:37` referenced that case **by name** (a D2
decision, so it would not go stale on a line edit) and called `save-card.ts`
"the fourth call" — it is now the eighth. Both were corrected: the reference
now reads "the `src/lib/save-card.ts` call's two-key `components` pin in
\"holds at least one row of every kind the panel renders\"".

The two surviving because-clauses in that comment were re-checked against gate
1's output rather than inherited: no tsconfig (still true — the new files add
none), and two routes differing in both method and path (still true —
`server.ts` is untouched and the probe printed the same two routes).

### `test/fixtures.ts` (modified)

The `MINI_FULLSTACK_REACT` docstring described 2 components and "one row of
every kind". Rewritten: at-least-one of every kind, four components in two
same-named pairs, why both label branches now have their only hermetic
control, the 3/2/2/1 counts, and that this is the only hermetic input on which
`client.busiest` fires.

### `apps/server/test/api.test.ts` (modified)

`toHaveLength(2)` → `4`; the distinct-name count is replaced (post-review, N3)
by a pin on the sorted name list, `["Card", "Card", "Panel", "Panel"]` —
`toHaveLength(4)` plus two-distinct-names is also satisfied by three `Card`s
and one `Panel`, which would leave a uniquely-named component and falsify the
comment above it. Comment rewritten, and it now says why the stronger pin. Plus the
carried-in D2 debt: a new case, `"keeps the client fields off /shapes, so the
panel has one source"`, asserting `/shapes` carries neither `clientCalls` nor
`components`, with a positive control on `routes` first so it cannot pass by
finding an empty body.

### `e2e/psq.e2e.ts` (modified)

Re-pinned: headers `3 → 5` with all five labels in key order; rows `5 → 9`
(both the desktop and the browser assertion); `no matching route` `1 → 2`.
Comments rewritten to say four components in two pairs, and nine rows over
eight calls.

Carried-in D2 debt, both halves: the spec is split into
`"renders component -> call -> matched route, and opens a call in the
editor"` and `"renders the same panel without the desktop bridge, as plain
text"`, and `page.close()` moved into `finally` in both so a failing
assertion no longer leaks the page. The browser case keeps its `toBe(9)` poll
ahead of `toBe(0)` — still a proper positive control.

One more stale comment fixed while open: the hosted-shape docstring said "the
19 tests above". It is **21** (15 + 6), counted; it was already stale before
this phase (D2 took the suite to 22).

---

## 3. Gate results

| Gate | Baseline | Result |
|---|---|---|
| 1. probe, before dependent edits | — | 4 components; top 3 unique; unattributed 1; `matches: null` 2; `warnings` `[]` — **all as predicted** |
| 2. `pnpm typecheck` | clean | clean, all four projects |
| 3. `PSQ_NO_CORPUS=1 pnpm test` | 250 \| 58 (308) | **272 \| 58 (330)**, 0 failed |
| 4. `pnpm test` | 308 | **330**, 0 failed |
| 5. `pnpm test:e2e` | 22 | **23**, 0 failed |
| 6. selftest, 6 corpus roots + fixture | see below | see below |
| 7. negative controls (a)–(e) | — | all five fail; (b) with a different message — §5 |
| 7b. post-review control: collision check stubbed | — | 2 unit cases fail; selftest reports the collision — §4 |
| 8. determinism, seeds 1337 / 1338 | — | identical for a repeated seed, different order across seeds |
| 9. `git show --stat` | — | **exactly the 13 paths** |

The +22 in gate 3 is accounted for exactly: 6 + 11 + 4 = 21 new unit cases,
plus 1 new `api.test.ts` case. `test/mini-fullstack-react.test.ts` stays at 6
cases (assertions grew, the case count did not). The pre-review figure was
**268 | 58 (326)**; review added 4 unit cases to `test/client-mcq.test.ts`.

### Gate 6 — selftest, via `pnpm psq selftest --repo <path>`

| Root | Exit | Questions | Findings |
|---|---|---|---|
| repoA | 0 | 213 | 0 |
| repoB | 0 | 107 | 0 |
| repoC | 0 | 2 | 0 |
| repoD | 0 | 136 | 0 |
| repoE | 0 | 56 | 0 |
| repoAClient | **1** | 89 | **1** |
| mini-fullstack-react | 0 | **3** (was 2) | 0 |

`repoAClient`'s single finding is the pre-existing one the plan pins:
`not-a-member` … `reference answer is graded wrong (chose "X", answer is X)` —
`grade.ts:52` reading a one-character choice as an option letter before the
text branch at `:53`. Unrelated to this work, out of scope, **not fixed**.

**That pin is seed-dependent, and the plan does not say so.** "Exactly 1
finding on `repoAClient`" is a property of the CLI's *default* seed, not of the
graph. `psq selftest` passes `seed = undefined` (`apps/cli/src/index.ts:81,96`),
so generators fall back to `hashSeed(g.repo)`; at that seed the offending
one-character choice is sampled into the `not-a-member` question and the
finding appears. At seed 1337 it is not sampled and the same repo selftests
clean. Read the pin as "1 finding at the CLI default seed", never as a property
of the repo. (Defect in plan §8.6, not in the build — see §5.)

`client.busiest` is present on `mini-fullstack-react` (the bank went 2 → 3 and
`psq questions` lists `most-calls 1`) and on `repoAClient` at **both** seeds
(4 choices, 4 distinct after `normalize()`, so the new collision guard does not
suppress it there), and on neither of the five .NET roots, which carry no
components.

### The harness-vs-CLI divergence, now measured

An ad-hoc harness written first reported `repoAClient` at **0** findings where
the CLI reports 1. The pre-review audit attributed that to "an extraction-path
difference, not a grading one" and labelled it unexplained. **That clause was
itself an inference, and it was false.** Measured (aggregates only):

```
extract vs extractNode identical JSON: true
extract      seed=undefined (CLI shape): questions=89 findings=1
extract      seed=1337:                  questions=89 findings=0
extractNode  seed=undefined:             questions=89 findings=1
extractNode  seed=1337 (the ad-hoc harness): questions=89 findings=0
```

Both extractors return **byte-identical graphs**, so the extraction path is not
the variable at all. The entire divergence is **the seed**. Confirmed one level
below the finding count, at the sampled choice itself — the `not-a-member`
question's choice lengths on that root:

```
seed=undefined : [1, 8, 9, 11]    <- the one-character choice is drawn
seed=1337      : [5, 13, 8, 11]   <- it is not
```

So the mechanism is not merely consistent with the counts; it is visible in the
choice list. Recorded as **measured**, replacing an inferred and wrong clause.

### A pre-existing asymmetry this uncovered, out of scope

The server always seeds 1337 (`apps/server/src/workspace.ts:137-139`,
`opts.seed ?? 1337`); the CLI leaves the seed undefined
(`apps/cli/src/index.ts:81,96`). The two therefore compose **different
distractor sets for the same repo**, and it follows that **a green
`psq selftest` does not imply the served bank is green** — nor the reverse: on
`repoAClient` the served bank (seed 1337) is clean while the CLI's is not.

**The seam is narrower than that pair of line references suggests, and the
narrowing supports the diagnosis rather than weakening it.** The CLI already
seeds `materialize` with `seed ?? 1337` (`apps/cli/src/index.ts:95`), the same
value the server uses, and only passes the raw `seed` on to `buildBank` at
`:96`. So the **data** seed is identical in both shells and only the
**question** seed diverges — which is precisely the sampling difference the
choice-length probe above pins the divergence on. Had the seeded rows differed
too, the finding would have had a second candidate cause; they do not.

Attributed to the seed, not to `buildBank`, which is a pure function of
`(graph, seeded, seed, sections)` and was measured identical under both
extractors. Pre-existing, untouched by this phase, and **not fixed** — recorded
so the phase record carries it.

### Gate 8 — determinism

Through `buildBank`, on `mini-fullstack-react`. Answer identical under both
seeds; only its position moves.

```
seed 1337: ["Panel (src/components/shop/Panel)",
            "Panel (src/components/admin/Panel)",
            "Card (src/components/shop/Card)",
            "Card (src/components/admin/Card)"]   answerIndex 1
seed 1337 again: byte-identical to the above (JSON compare true)
seed 1338: ["Card (src/components/shop/Card)",
            "Panel (src/components/admin/Panel)",
            "Card (src/components/admin/Card)",
            "Panel (src/components/shop/Panel)"]  answerIndex 1
orders differ: true
```

---

## 4. Negative controls, with the message each actually produced

Every control was applied to the working tree, run, and reverted; the tree was
verified clean of all `CONTROL` markers afterwards and gates 2–4 re-run green
(330 / 272 | 58) before the commit. **All five were re-run after the B1 fix**;
the numbers below are the post-fix ones.

**(a) remove the `bank.ts` registration.** `test/client-quiz.test.ts` fails,
all 4 cases:

```
expected [] to have a length of 1 but got +0        (client-quiz.test.ts:32)
expected true to be false                            (client-quiz.test.ts:65)
```

This is the only proof the single-composition-point rule was honoured, and it
works only because that test goes through `buildBank`.

**(b) `componentLabel` keeps the `.tsx` extension.** Fails — but **not with
the message the plan predicts**. See §5. Re-derived after the B1 fix, because
that fix changed what the second step demonstrates:

- guard intact: 4 cases in `client-quiz.test.ts` fail, the first with
  `expected [] to have a length of 1 but got +0`. The question is dropped by
  `choicesCollide()` now (all four labels reduce to `tsx)`), where before the
  fix it was dropped by the no-dot rule. Same outcome, and now for the actual
  invariant rather than a proxy for it.
- `choicesCollide()` also stubbed to `false`: selftest reports exactly the §1
  pair —

```
choices collide after normalization
reference answer is graded wrong (chose Panel (src/components/shop/Panel.tsx),
                                  answer is Panel (src/components/admin/Panel.tsx))
```

**(b1) post-review control — `choicesCollide()` stubbed, guard removed
entirely.** Two unit cases fail, and they are the two inputs the guard exists
for:

```
generateClientMcq > asks nothing when two dotted paths reduce to the same string
generateClientMcq > asks nothing when two names differ only in case
  expected [ { id: 'client.busiest', …(9) } ] to deeply equal []
```

The reviewer's case was reproduced directly against `selftest`, with the guard
stubbed, on the `Api`/`API` graph:

```
emitted: 1 [ 'API', 'Api', 'Charlie', 'Bravo' ]
SELFTEST FINDING: choices collide after normalization
SELFTEST FINDING: reference answer is graded wrong (chose API, answer is Api)
```

The second finding is one the review did not quote and is worth keeping: the
question does not merely get flagged, it **mis-grades** — the reference answer
`Api` is scored as `API`, exactly the §1 failure reached without a single dot.

**(c) `componentLabel` always returns the bare name.** The generator emits
nothing, and the failure is `client-quiz.test.ts` reporting no question — **not
a selftest finding**, exactly as rev 2 predicts:

```
expected [] to have a length of 1 but got +0
```

The `selftest(bank, …)` assertion in the third case still **passed**; that
case failed on the following line, `expect(bank.some(q => q.id ===
"client.busiest")).toBe(true)`. That is the plan's point reproduced literally.

**(d) delete the tie guard.** Exactly one of the 11 cases fails, and it is the
synthetic tie:

```
generateClientMcq > asks nothing when the top is tied
expected [ { id: 'client.busiest', …(9) } ] to deeply equal []
```

**(e) point the answer at the runner-up.** The fixture gate fails:

```
client-quiz.test.ts > names the busiest component…
expected [ …(3) ] to have a length of 4 but got 3
```

plus **7** of the 11 synthetic cases — 8 failures in all (1 `client-quiz` +
7 `client-mcq`: emits-one, two-dotted, one-dotted-still-asks, case-differ,
one-char-answer, one-char-distractor, determinism). (The message changed with
the B1 fix: the
runner-up's label is now also in the distractor list, and `mcq()`'s dedupe
drops it to three choices before the answer text is ever compared. Before the
fix the same control failed on the answer text itself,
`expected 'Card (src/components/admin/Card)' to be 'Panel (…)'`. Either way
the fixture gate is what catches it.)

---

## 5. Deviations from the plan

**Two, both plan defects rather than implementation choices. The first was
corrected in place in `plan.md` with a dated block, per the `plan-d2.md:208`
precedent; the second was found in review and is recorded below.**

### First plan defect: gate 7(b) predicted the wrong failure

*Read this subsection as history — it describes the build as it stood at
`f9f5089`. The guard it discusses was replaced in review, and the shipped shape
is in the next subsection; nothing described here exists in `7dbc101`.*

Plan gate 7(b) predicted that keeping the `.tsx` extension would make
**selftest** fail with `choices collide after normalization`. It could not:
**D-E-3a's no-dot guard, which the same plan specified, fired first.** With the
extension kept every label held a `.`, the generator dropped the question, and
selftest never saw it — so the observed failure was `client-quiz.test.ts`
reporting no question, the same message as control (c).

The plan was internally inconsistent there, and benignly so: what it got wrong
was *which gate catches the regression*, not whether §1's mechanism is real.
Both were measured (§4b). The two-step control that was actually run is the
stronger one — it shows a guard standing in front of a live, reproduced failure
rather than in front of nothing.

**As shipped, the outcome is unchanged but the cause is not.** `ungradable()`
and its no-dot rule no longer exist; control (b) now drops the question via
`choicesCollide()`, and the second step stubs *that* rather than the dot rule.
§4(b) records the re-derived run.

### Second plan defect, found in review: D-E-3a specified a proxy

D-E-3a specifies "drop the question if any choice still contains a `.`". That
is neither necessary nor sufficient for the invariant plan §1 is about, which
is the one `selftest.ts:84-85` enforces: no two choices normalize alike.

- **Not sufficient.** `normalize()` lowercases (`normalize.ts:15`) while
  `componentLabel` compares names with `===`, and `refs.ts:69` admits any
  `/^[A-Z][A-Za-z0-9]*$/` name. So `Api` and `API` are two distinct, uniquely
  named components, both labelled **bare**, no dot anywhere — and they collide.
  Measured above (§4 b1): the generator shipped the question and selftest then
  reported it broken and mis-graded. Rule 1 says drop it.
- **Not necessary.** Measured, and this qualifies the review's own wording:

```
["Card (src/v1.2/Card)", "Card (src/v2/Card)", "Bravo", "Charlie"]
  -> ["2/card)", "card (src/v2/card)", "bravo", "charlie"]   collides: false
["Card (src/a/v1.2/Card)", "Card (src/b/v1.2/Card)", "Bravo", "Charlie"]
  -> ["2/card)", "2/card)", "bravo", "charlie"]              collides: true
```

  The review states the collision check "subsumes the dot rule (the dotted case
  collides too)". True where two labels share the dotted tail — the kept-
  extension case, and two components under one dotted directory. **Not true of
  a single dotted directory among clean labels**, which reduces to something no
  sibling shares and grades correctly. The old no-dot rule dropped that
  question for nothing. So the new check is not merely equivalent-plus-more; it
  is also *less* trigger-happy, and my original unit test asserted a drop that
  rule 1 never required. That test was rebuilt into the colliding variant, and
  the non-colliding counter-case is now pinned as a question that **still gets
  asked**.

Fix applied: `ungradable()` split into `unselectable()` (one character only,
D-E-3b, a real and separate failure mode) and `choicesCollide()` (the invariant
itself, on the final choice list). The dot check is gone rather than
accumulated beside the new one.

### N2, folded into the same edit

The pre-review code applied the guard to the whole candidate pool
(`[answer, ...distractors].some(ungradable)`), so one odd component could
silence the generator on a 200-component graph. Now: an unselectable **answer**
drops the question; unselectable **distractors** are filtered out of the pool,
and the question goes only if the survivors fall below `MIN_CHOICES`. Three
unit cases pin the three outcomes.

This also retires a claim the pre-review audit made in this section — that the
stricter candidate-pool check "coincided on every known input" because
`repoAClient` has 0 dotted labels. True as far as it went, but it was an
argument for a guard that should not have existed.

No other deviation. Everything else in §§4-8 was implemented as written.

---

## 6. Open risks and threads

- **The two `componentLabel` copies deliberately disagree, and nothing gates
  the divergence.** Unchanged from plan §9. The mitigation shipped is the
  comment in `component-label.ts` naming `normalize.ts` and saying "do not
  re-align", plus the `survives normalize()` case in
  `test/component-label.test.ts`, which fails if the quiz copy is aligned to
  the web one. That case is a real gate; nothing gates the reverse direction
  (the web copy being aligned to the quiz one), which would silently change
  the e2e-pinned panel labels — those e2e pins are that direction's gate.
- **`grade.ts:52`'s option-letter shortcut is still a live bug** — a single
  letter is read as an option letter before the text branch at `:53` — with one
  confirmed casualty on `repoAClient`. Sidestepped by D-E-3b, not fixed. Out
  of scope, as instructed.
- **The live service will not serve these questions without a restart.** This
  changes `packages/quiz` *source*, which pid 16538 `tsx`-loaded on Sep 4 —
  not `apps/web/dist`, which D2's "no restart needed" argument was about.
  `com.psq.server` was **not** touched. Deploy remains James's call (D-C-8).
  Note `pnpm test:e2e` rebuilt `apps/web/dist` as it always does; no web
  source changed, so the bundle is equivalent.
- **The ad-hoc-vs-CLI selftest divergence on `repoAClient` is CLOSED.** Cause
  measured, not inferred: **the seed**, not the extraction path (§3). The two
  extractors return byte-identical graphs; `psq selftest` seeds `undefined` and
  the ad-hoc harness seeded 1337, and the one-character choice is sampled only
  at the former.
- **Open, pre-existing, out of scope: the CLI and the server seed differently**
  (`apps/cli/src/index.ts:81,96` vs `apps/server/src/workspace.ts:137-139`), so
  they compose different distractor sets for one repo and a green
  `psq selftest` does not imply a green served bank. Measured; see §3.
- **On a repo holding a case twin, whether `client.busiest` exists at all is
  seed-dependent** (reviewer's N7; recorded, not changed). `choicesCollide()`
  runs on the **sampled** list, so both twins landing among the four choices
  depends on the draw. Measured on a synthetic 8-component graph with the twins
  among the distractors: over seeds 1–40, **32 emitted, 8 dropped**
  (1, 13, 16, 17, 19, 21, 26, 32).

  **Not a rule-7 breach**: the same seed gives the same output — verified for
  all 40 — and every question that does ship is collision-free. The alternative
  (resample, or drop on the candidate pool) costs real complexity for a case no
  known input hits — see the 0/354 table above.

  It does compose with the seed finding below, though: because the CLI leaves
  the question seed undefined and the server uses 1337, on such a repo **the
  two shells could disagree about whether the question exists at all**, not
  merely about its distractors. Measured on the same graph, both shells emit —
  with different choice sets — so this is a reachable divergence, not one
  observed today.
- **Open: the plan's "exactly 1 finding" pin is seed-dependent** and should be
  written as such in the phase record. At seed 1337 that root selftests clean.
- **All three guard paths are covered only synthetically — not just the case
  one.** Measured across every root that yields components:

  | Root | Components | Case twins | Dotted paths | One-char names |
  |---|---|---|---|---|
  | `mini-fullstack-csharp` | 1 | 0 | 0 | 0 |
  | `mini-fullstack-react` | 4 | 0 | 0 | 0 |
  | `mini-react` | 15 | 0 | 0 | 0 |
  | corpus root | 133 | 0 | 0 | 0 |
  | corpus root | 201 | 0 | 0 | 0 |
  | **total** | **354** | **0** | **0** | **0** |

  (The other six roots yield 0 components.) So `choicesCollide()`'s two inputs
  and `unselectable()`'s one are all exercised by the unit cases in
  `test/client-mcq.test.ts` and by nothing else.

  **This should not be "fixed", and the reason matters more than the fact.**
  `unselectable()` and `choicesCollide()` are pure functions of a list of
  strings: a hermetic fixture would drive the identical code path with no added
  fidelity. That is what separates them from the attribution owner-walk, which
  genuinely needed real extraction and got gate 1 for it. Worse, the obvious
  move is actively harmful — adding a case twin to `mini-fullstack-react` would
  make `choicesCollide()` fire and **suppress `client.busiest` on the only
  hermetic root where it fires at all**, destroying the coverage the fixture was
  grown for in this very phase. If a real-extraction case is ever wanted, the
  cheap form is a fourth fixture, on the `MINI_SOLUTION_TIE` precedent: no e2e
  constant, no harness entry (plan D-E-1).
- **`README.md:25-38` still has no M5c row.** Plan §9 offered to fold it in;
  no instruction came, and it is outside the 13 paths, so it was left alone.
- The `.psq` / drift-site id collisions, no Dockerfile, no CI, and the corpus
  config being the only copy of the ground truth all carry forward unchanged.

## 7. Left undone, deliberately

- **Not pushed.** `m5c-ii-client-generator` is local; James authorises pushes.
- **No phase record.** `progress.md` for this phase is the orchestrator's to
  write, and commits separately from the code.
- `com.psq.server` not restarted, kickstarted or otherwise touched.
