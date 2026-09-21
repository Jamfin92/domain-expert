# H-e — implementation audit (2026-09-20)

Built against `plan.md` rev 2 (APPROVED 2026-09-20) in this directory, with both
approval decisions taken as written: the **full** change A (depth tracking +
terminator-not-found fallback + the manufactured Gap-2 fixture case), and §6
option **(a)** — the hermetic `fluent.test.ts` gate with its own mutant M9.

Corpus repos are named only by the config's neutral keys. No repo name, path or
source line appears here. **This repo is PUBLIC.**

Throughout: **MEASURED** means a command was run and its output read.
**INFERRED** means it was not. Nothing below is marked measured that was not.

Not committed, not pushed, as instructed.

---

## Files changed — 10, exactly the plan's list

1. `packages/extract/src/csharp/structure.ts`
2. `packages/extract/src/csharp/entity-refs.ts`
3. `packages/extract/src/detect.ts`
4. `packages/extract/test/structure.test.ts`
5. `packages/extract/test/entity-refs.test.ts`
6. `packages/extract/test/fluent.test.ts`
7. `packages/graph/test/refs.test.ts`
8. `apps/server/test/api.test.ts`
9. `apps/server/test/rehydrate.test.ts`
10. `test/fixtures/mini-efcore-refs/Services/EnrollmentService.cs`

No eleventh file was needed. `git status` shows exactly these ten modified, plus
the untracked `plan.md` that was already there.

---

## What changed, per file

### `packages/extract/src/csharp/structure.ts` — change A

The method `=>` branch (was `:336-341`) no longer pushes `body: []`. It now runs
the depth-tracked scan the expression-bodied **property** branch below it
already uses — `(`/`[`/`{` vs `)`/`]`/`}`, break on `";" && depth <= 0` — and
captures `tokens.slice(start, scan)` as the body. Deliberately duplicated rather
than extracted into a shared helper; the plan forbids that refactor here.

When the scan reaches `to` without a terminator at depth ≤ 0, the fallback fires:

1. `warnings.push(\`${file}:${declLine}: expression body for method ${memberName} not terminated\`)`
   — the `:323` form;
2. `body: []`;
3. resume from the first `;` **ignoring depth** — the pre-H-e behaviour.

The doc comment states, as measured rather than asserted, that depth tracking is
**defensive only** (identical output to the old first-`;` terminator on every
real input) and that the fallback is the part that prevents a real failure.

### `packages/extract/src/csharp/entity-refs.ts` — change B

A two-conjunct drop placed immediately after the
`if (via === null || entity === undefined) continue;` guard — i.e. **above**
`seen.add(key)`, which the plan flags as a real trap: below it a
receiver-position occurrence would poison the dedupe key and suppress a later
legitimate ref on the same line.

```
const next = i + 1 < body.length ? body[i + 1]! : null;
const bareReceiver =
  !(prev !== null && prev.text === ".") && next !== null && next.text === ".";
if (bareReceiver) continue;
```

Exactly two conjuncts, because each conjunct needs its own mutant (M5, M7). No
`kind === "punct"` conjunct was added — that would be a third, ungated one.

The doc comment records four things and distinguishes them: the 14/14 measurement;
that `dbSetName` immunity is **by construction** (the only `via = "dbSetName"`
assignment sits inside a guard requiring `prev.text === "."`, and this rule
requires `prev != "."` — disjoint), not a corpus coincidence; the **stated
limitation** that a genuine static-member access such as `Student.Create(...)`
would be dropped, with measured occurrences of **0** — "0", not "safe"; and that
the drop leaves **no trace** downstream, the honest consequence of rejecting an
`EntityRef` schema field.

### `packages/extract/src/detect.ts`

`EXTRACTOR_VERSION` 2 → 3.

### `packages/extract/test/structure.test.ts`

Two new hermetic describes, inline template-literal sources through
`parseCSharp(src, "T.cs")` — no `corpusRepo`, no `skipIf`, so they run under
`PSQ_NO_CORPUS=1`. Not routed through the fixture directory. Listed here as
shipped, rounds 2 and 3 folded in:

- base case (a plain expression body is captured at all);
- a well-formed body stays warning-free (the positive-direction half of the
  malformed case below);
- **three diverging shapes**, per §2's correction that the gating class is not
  one construct: a statement-lambda argument with its own `;`; statement lambdas
  nested two deep; a `;`-bearing lambda inside an object initializer;
- **the exact member list after such a method** — the local-function source.
  Round 1 wrote a weaker version of this with a false because-clause, round 2
  deleted it, round 3 restored it on a source that genuinely discriminates. It
  is M11's only victim. See Round 2 BLOCKING 1 and Round 3 BLOCKING;
- **a local function inside the lambda stays inside the enclosing body** — the
  latent misattribution change A fixes. Added in round 3; see Round 3;
- the malformed input verbatim from `measurement.md`, asserting 2 methods / 1
  property / the unterminated body being `[]` (M2), and separately the warning
  text (M3).

### `packages/extract/test/entity-refs.test.ts`

- Four named constants as shipped — `TERSE_LINE`, `RECEIVER_LINE`, `PAIR_LINE`
  and `COLLIDING_MEMBER_LINE` — the last two added in rounds 2 and 3. Values are
  deliberately not repeated here; read them from the file. Each carries a comment
  saying whether it is load-bearing and why: `RECEIVER_LINE`'s *aloneness* is,
  `PAIR_LINE`'s *two mentions in order* are, `COLLIDING_MEMBER_LINE`'s
  *declaration* is, and none of the values is load-bearing the way `DUP_LINE` is.
- Rows inserted into the ordered array pin, and the `refs.length` total in G21
  raised to match. Both moved again in round 2 when the M10 case landed; the
  shipped figures are in the Round 2 section and are not restated here.
- **G38** — the receiver rule's Gap-1 positive control, with a source read-back
  so a failure names the cause, a `Student`-is-matchable control in the same run,
  and a second `it` pinning the M5 victim at `StudentsController.cs:23`. Round 2
  reshaped the case it guards to the property-collision shape and added a
  structural check on the line's *aloneness*; round 3 added the read-back of
  `COLLIDING_MEMBER_LINE`, without which the gate survived the removal of its
  own premise.
- **G39** — D-Hb-10's Gap-2 control, with a source control asserting the line
  really is an expression body and the `;` really precedes `Course`, so a later
  "simplification" of the fixture line into a block body cannot quietly disarm M6.
- **G40** — added in round 2: the `seen.add` ordering, M10's only named victim,
  with its own structural control. See Round 2.

### `packages/extract/test/fluent.test.ts` — §6, option (a)

A hermetic `describe` **outside** the file's corpus-gated block, with an
expression-bodied `OnModelCreating` asserted through `entityConfigs`, plus a
block-bodied control proving the two body forms now read identically. Its comment
states plainly that the inherited claim — that this file already gated the
capability — was false and unmeasured, and says not to repeat it.

### `packages/graph/test/refs.test.ts`

`Course` 11 → 12 (`:22`), `entityRefs` 20 → 21 (`:27`), one row added to G27's
literal list, `entityName` 10 → 11 (`:85`), and the header comment corrected.
**The `Student … toBe(9)` pins did NOT move** — see deviations.

### `apps/server/test/api.test.ts`

G30 `refs.length` 11 → 12; G34 `ok.body.refs.length` 10 → 11. Nothing else.

### `apps/server/test/rehydrate.test.ts`

G23's two literals, which are the whole point of §5: `toBeGreaterThan(1)` →
`toBeGreaterThan(2)` and `patch(state, staleId, { extractor: 1 })` →
`{ extractor: 2 }`. The describe/it names and comment now say *previous
extractor* rather than *extractor 1*, and the comment records why the two
`toBe(EXTRACTOR_VERSION)` assertions further down are **not** gates (they read
the constant symbolically and are true at any value) and that both literals must
be raised again on the next bump. The six-case test pinned to
`{loaded:3, failed:3, missing:1}` was not touched.

### `test/fixtures/mini-efcore-refs/Services/EnrollmentService.cs`

Appended at line 56+. **Line 55 did not move** — verified by the suite (the
cross-file source read and the `file`-component gate both pass) and by eye.
The 26-54 comment block was not touched.

- `Receiver.Read` at line 71: `_ = Student.Empty;`, alone on its line. `prev` is
  `=`, `next` is `.` — the rule's only positive control outside the private corpus.
- `Terse.Roster` at line 87: `=> Pick(() => { int n = 0; _ = n; }, typeof(Course));`
  — `typeof(Course)` deliberately, not `Course.Something`, which would itself be
  a bare receiver and would be eaten by change B.

---

## Measurements

Every number below was produced by running something. Method is named each time.

### Corpus, three points

A throwaway script in the session scratchpad (never in the repo) called
`extractDotnet` directly on each configured corpus repo and on the hermetic
fixture, at each of the three tree states, dumping every ref as a
`entity|file|line|type|method|via` row to JSON. The diffs below are **multiset
diffs over those rows**, not subtractions of totals.

| | baseline | after A | after A+B | predicted A+B |
|---|---|---|---|---|
| repoA | 241 | 247 | **240** | 240 |
| repoB | 56 | 56 | **49** | 49 |
| repoC | 0 | 0 | 0 | — |
| fixture (before new cases) | 20 | 20 | 20 | — |
| fixture (after new cases) | — | — | **21** | — |

Ref-level diffs, which is what §7 asks for instead of totals:

| | baseline → A | A → A+B | baseline → A+B |
|---|---|---|---|
| repoA | **+6 / −0** | **+0 / −7** | **+2 / −3** |
| repoB | +0 / −0 | **+0 / −7** | +0 / −7 |
| fixture | +0 / −0 | +0 / −0 | +0 / −0 |

Redacted shape of the moved rows:

- **baseline → A, repoA, +6**: 4 rows on one entity + 2 rows on another, all
  `via: entityName`. This reproduces `measurement.md`'s "4 false, 2 genuine" split
  exactly.
- **A → A+B, −14 total (7 + 7)**: every removed row is `via: entityName` and
  every one names the **same single entity** in both repos — the framework-property
  collision. **0** `dbSetName` rows removed, in either repo.

Net: repoA **−1** against its own baseline, repoB **−7**. Both land on the plan's
predictions to the ref, so §7's dedupe caveat never had to be invoked. The
prediction being an upper bound was not tested by this data.

**Unmoved, and stated explicitly as §7 requires** — measured at all three points:
repoA entities 17 / relations 20 / shapes 36; repoB 9 / 8 / 15; fixture 2 / 1 / 0.
`warnings.length` is **0** at all three points for repoA, repoB and repoC. The new
warning branch in change A therefore **never fires on the corpus** — checked by
hand for repoB and repoC, which (unlike repoA at `dotnet.test.ts:114-116`) pin
nothing. repoC yields an empty .NET graph entirely; it is inert here, not a control.

### Suites

| run | before | after |
|---|---|---|
| `pnpm test` | 464 passed, 36 files | **477 passed, 36 files** |
| `PSQ_NO_CORPUS=1 pnpm test` | 406 passed / 58 skipped, 3 skipped files | **419 passed / 58 skipped, 2 skipped files** |
| `pnpm typecheck` | — | exit **0** |

Skipped is **exactly 58** — the private corpus config is intact and nothing was
"fixed". Skipped *files* went 3 → 2 because `fluent.test.ts` now carries a
hermetic describe and no longer skips whole; the skipped **test** count is
unchanged, which is the number the plan pins.

`pnpm test:e2e` was **not run**, per §8.

### The clean-tree flake — captured, and compared by measurement

The plan warned of a pre-existing red (1 in 12 clean-tree runs, message not
captured) and forbade attributing it to this phase without evidence. It appeared
on the first post-change hermetic run. **Messages captured, three distinct ones,
all in `apps/server/test/`:**

1. `api.test.ts > opening a repo > closes a repo and forgets its sessions` —
   `expected 401 to be 200` at `api.test.ts:74` (a `DELETE /api/repos/:id`).
2. `api.test.ts > taking a quiz > tracks score, progress and weak areas` —
   `TypeError: Cannot read properties of undefined (reading 'index')` at `:364`.
3. `auth.test.ts > with a token configured > refuses a comma-joined value …` —
   `Test timed out in 5000ms`.

Attribution was **measured, not argued**. The ten changed files were swapped for
their `HEAD` contents (byte-for-byte, from `git show HEAD:<path>`; restored
afterwards and verified identical to the pre-swap copies with `diff`), and the
hermetic suite was run **106 times on each tree**:

| tree | reds | runs |
|---|---|---|
| clean (`HEAD`) | 2 | 106 |
| with H-e | 4 | 106 |

Clean-tree reds were `api.test.ts > taking a quiz > grades an answer …` and
`auth.test.ts > with a token configured > refuses the wrong token`.

**Conclusion, stated to the limit of what the data supports (corrected in round
2, where the first draft over-claimed):** a flake of this kind exists on the
**clean tree**, in `apps/server/test/`, independent of this phase — that much is
measured. Between the two arms there is **no detectable increase**: 4/106 vs
2/106 is Fisher p≈0.7. That is *not* the same as "this phase did not introduce
it", and three limits have to be said out loud:

- at n=106 per arm, an added flake of ~2% would be invisible;
- the two arms did not run the same test population (406 vs 419 tests), so they
  are not strictly like-for-like;
- **no individual failing test reproduced across arms.** All six reds were
  distinct. "The same two files" is therefore a *file-level* observation, not a
  per-failure one, and should not be read as "the same flake".

The swap-and-restore method is sound and the comparison is worth having. The
inference it supports is "no detectable increase", and nothing stronger.

One loose end, recorded rather than resolved: failure (1) is a **401**, and the
only `401` **response** in the server's `src` is `app.ts:93`, inside a gate that
`createApp` mounts **only** when `options.token` is non-empty — which
`api.test.ts`'s `beforeEach` never passes. I could not explain how that response
is produced. It is out of this phase's scope and outside its Files-touched list,
so it was not chased further; flagging it as an unexplained pre-existing defect
worth its own phase. (`401` also appears in `apps/web/src/lib/api.ts:201,225`,
but those are client-side handling of a response, not a source of one.)

---

## Mutants — all nine, each failure set suite-wide

`pnpm test` (corpus **on**) for M1-M8, so the sets cross packages as §3 demands.
Each mutant was applied, run, and reverted from a byte-for-byte backup; the tree
was verified identical to its pre-mutant state at the end.

### M1 — revert the method `=>` branch to `body: []` — **14 failed**
- `entity-refs.test.ts` — the whole ordered array; G21; **G39**
- `structure.test.ts` — base case; shape 1; shape 2; shape 3
- `fluent.test.ts` — both hermetic cases
- `refs.test.ts` — G24; G27; G28
- `api.test.ts` — G30; G34

### M2 — delete the terminator-not-found fallback — **2 failed**
- `structure.test.ts` — "keeps parsing the members that follow" (**the measured
  victim: 1 method / 0 properties instead of 2 / 1**); "and says so"

### M3 — keep the fallback, delete its warning push — **1 failed**
- `structure.test.ts` — "and says so, rather than dropping the body silently"

M2 and M3 are cleanly discriminated: M3's set is a strict subset of M2's, and the
member-survival assertion is what separates them.

### M4 — delete the receiver rule entirely — **6 failed**
- `entity-refs.test.ts` — the whole ordered array; G21; **G38**
- `refs.test.ts` — G24; G25; G29

The Gap-1 case reappears as a 22nd row. **The positive control is alive**, which
is the thing `measurement.md` said was impossible before this fixture case existed.

### M5 — drop the `prev != "."` conjunct — **10 failed**
- `entity-refs.test.ts` — the ordered array; the `via`-key tie; G13; G14; G19;
  G21; **G38's second `it`** (the `dbSetName` victim)
- `refs.test.ts` — G24; G25; G29

No new fixture row was added for M5; the victim at `StudentsController.cs:23` was
already there, as §3 requires.

### M6 — drop the `depth <= 0` conjunct — **13 failed**
- `entity-refs.test.ts` — the ordered array; G21; **G39**
- `structure.test.ts` — shape 1; shape 2; shape 3; **both** fallback tests
- `refs.test.ts` — G24; G27; G28
- `api.test.ts` — G30; G34

The two fallback tests redden here too, which was not predicted but is correct: a
depth-less scan finds the malformed input's inner `;`, so the fallback path is
never entered and its warning never pushed.

### M7 — drop the `next == "."` conjunct — **23 failed**
- `entity-refs.test.ts` — the ordered array; the `via`, `method` and `type` tie
  gates; all three D-Hb-6 dedupe-key gates; G7 (both); G12; G14; G15; G19; G21;
  G37; G39
- `refs.test.ts` — G24; G25; G27; G28; G29
- `api.test.ts` — G30; G34

Fatally red, as the plan predicted. Listed because rule 6 requires every conjunct
to name a mutant, not because the mutation is plausible.

### M8 — revert `detect.ts` to `2` — **1 failed**
- `rehydrate.test.ts` — G23

**The bump is now gated.** Before §5's two literal changes this mutant reddened
nothing, because G23 read `EXTRACTOR_VERSION` symbolically.

### M9 — revert change A, run under `PSQ_NO_CORPUS=1` — **14 failed**
Same source mutation as M1; run hermetically on purpose, because §6's entire
point is that the `entityConfigs` capability must be gated **without** the corpus.
- `fluent.test.ts` — **both hermetic cases redden with the corpus switched off**
- plus the same 12 others as M1

M9 is therefore a real gate, not a case asserting something already true.

---

## Deviations from the plan, and disagreements with its predictions

1. **§4 said the `Student … toBe(9)` pins in `refs.test.ts` (`:28`/`:38`/`:119-121`)
   would move. They did not, and were left alone.** The Gap-1 fixture case is a
   `Student` ref that change B removes at extraction, so `Student` stays at 9 while
   `Course` goes 11 → 12. This is the plan's own design working; §4's pin list was
   over-inclusive, not wrong about the mechanism.

2. **§3's M5 prediction named `api.test.ts` among the victims. It is not one.**
   M5 kills a `Student`/`dbSetName` ref; `api.test.ts`'s G30 and G34 both pin
   **`Course`** counts, which M5 does not move. Measured: M5's set contains no
   `api.test.ts` row. The rest of §3's M5 prediction (the `entity-refs.test.ts`
   rows and `refs.test.ts`) held.

3. **M6 reddens the two fallback tests as well as the three shape tests.** Not
   predicted; explained above; correct behaviour, not a defect.

4. **`measurement.md`'s malformed-input table shows `warnings: []` for
   "depth-tracked + fallback". The shipped code pushes a warning there**, so that
   cell is now `1`. This is not a contradiction — the plan (§2, step 1) mandates
   the warning and M3 gates it; the measurement was taken of a fallback without
   one. Recorded so nobody reads the old table as a pin.

5. **Skipped test *files* went 3 → 2** under `PSQ_NO_CORPUS=1`. Expected and
   required by §6: `fluent.test.ts` now has a hermetic case, so the file no longer
   skips whole. The skipped **test** count — the number §8 pins — is still 58.

Nothing else departed from the plan. No `refsFor` signature change, no new
`RefVia`, no `packages/schema` change, no web or server source change, no
shared-helper refactor of the property branch, no eleventh file.

---

## What is gated, and what is not

**Gated, each by a named mutant with a measured failure set:** body capture
(M1/M9), the fallback's member survival (M2), its warning (M3), the receiver rule
as a whole (M4), each of its two conjuncts (M5, M7), depth tracking (M6), the
version bump (M8), the expression-bodied `OnModelCreating` capability
hermetically (M9), the `seen.add` ordering (**M10**, added in round 2), and the
success-path resume (**M11**, added in round 3).

**Not gated, and deliberately so:**

- **The rule's stated limitations, both directions.** *Over-reach:* a genuine
  `Student.Create(...)` static-member access is dropped. Measured occurrences in
  the corpus: **0**. Round 1 claimed "no fixture case asserts the wrong answer
  for it" — **that claim was false when written**; the Gap-1 case was exactly
  such a case, and round 2 reshaped it. It is true now. *Under-reach:* `?.` and
  `!.` escape the rule entirely (measured against the lexer, round 2), so the
  corpus phenomenon written `User?.FindFirstValue(...)` would survive it.
  Neither direction is gated; both are in the doc comment.
- **What was dropped.** Rejecting the `EntityRef` field means the discarded refs
  leave **no trace** and no consumer can report them. There is no gate that could
  exist for this; it is a consequence of the design decision, recorded.
- **The repoB / repoC `warnings: []` claim.** Only repoA pins it
  (`dotnet.test.ts:114-116`). repoB's and repoC's zero was measured by hand today
  and is **not** held by any test — a future warning branch could move it unseen.
- **The corpus numbers themselves.** 240 / 49 are measurements in this audit, not
  assertions in the suite; nothing reddens if a future change moves them.

**Inferred, not measured, and flagged as such:**

- That the Gap-2 shape "will be met eventually" by real repos. No corpus repo
  contains it today (measured); the fixture case is **manufactured**, exactly as
  §2 insists it be recorded.
- That the unexplained 401 in the pre-existing flake is unrelated to this phase.
  The *flake* being pre-existing is measured (106 runs per tree). The *mechanism*
  of that particular 401 is unexplained, and I am not claiming to understand it.

---

# Round 2 — after review

Review returned "fix first" with two blocking items, both record-level, plus six
cheap fold-ins and one gap to close or ledger. All are addressed below. The same
ten files were touched; no eleventh. Still not committed, not pushed.

Everything in this section was **re-measured after editing**, including the
numbers round 1 had already measured.

## BLOCKING 1 — a false "Measured:" claim on a test that gated nothing

**The reviewer is right, and I confirmed it independently rather than taking it
on report.** The comment claimed that with the `depth <= 0` conjunct removed,
the lambda's trailing `}` is read as the class's closing brace and the following
members are swallowed.

**Measured (round 2):** I ran six sources through `parseCSharp` on the shipped
tree and again with M6 applied — the round-1 test's source, plus a nested `if`
block, a two-statement lambda, a lambda followed straight by `)`, an object
initializer, and lambdas nested two deep. **All six give identical member lists
in both trees**: `methods ["M","Z"]`, `properties ["After"]`, `warnings []`.
Only the captured body truncates. The test passed under shipped, M1, M2, M6 and
pre-H-e code alike. It gated nothing.

~~**Option (a) is not merely unwritten, it is unreachable**~~ — **FALSE. See
Round 3, BLOCKING.** The argument below rules out member *loss* only, and a
member-list assertion reddens on member *gain* just as well. Struck, not
deleted, because the narrow half of it is true and was re-measured in round 3:

> a stray `}` at member scope is skipped wholesale (`structure.ts:253`), and the
> member loop's bound `to` comes from an independent balanced match at the type
> level, so leftover closers cannot end a class early. The only way to **lose** a
> following member is to resume past `to`, which requires the scan to reach `to`
> — and a depth-less scan always stops at the first `;`, which in a well-formed
> class is inside it. That is precisely the malformed-input path, which M2
> already gates.

**Round 2 took option (b) and deleted the test. Round 3 reversed that and
restored it**, with a source round 2 never tried. Saying so here rather than
dropping it quietly. Alongside the restored test, `structure.test.ts` carries a
comment recording the false clause and the measurement that refuted it, and
stating the one claim that survived: no input makes the depth-less scan **lose**
a following member, but member **gain** is reachable — and gain is what the
restored test pins. The prose that repeated the clause earlier in this audit is
struck through and cross-referenced here.

~~**Coverage cost: none, verified.**~~ **FALSE — see Round 3.** M6 did still
redden 13 tests without it, which is what round 2 checked; but "M6 is still
gated" is not "nothing was lost". The deleted test appeared in no mutant's
failure set **because no mutant existed for the thing it could have gated** —
the success-path resume. M11, written in round 3, reddens that test and nothing
else in the suite.

## BLOCKING 2 — the Gap-1 fixture pinned the wrong answer

Round 1 wrote the case as `_ = Student.Empty;` — a static-member access on the
entity **type**. That is exactly the shape `plan.md:71-75` records as a
*tolerated limitation* under the line "Do not add a fixture case that asserts
the wrong answer", and which my own doc comment calls a limitation rather than
intended behaviour. The tree contradicted itself, and the case did not model the
measured phenomenon (`measurement.md:47-49`: a framework **property** collision,
not a type-static access).

**Fixed.** `Receiver` now declares `public string Student { get; set; } = "";`
and `Read` is `_ = Student.Length;` — a property whose name collides with an
entity's, read off a receiver, which is the phenomenon the corpus actually
shows. The corpus version inherits that property from a framework base; the
fixture declares it locally. The walker cannot tell the two apart — it has no
symbol table, which is why the rule is syntactic in the first place. Property
declarations are not walked, so the declaration contributes nothing and the row
still appears only when rule B is deleted.

**M4 re-verified after the change: still reddens, 6 tests**, G38 among them by
name. The positive control survived the reshape.

The doc-comment limitation and the fixture now agree, and the ledger entry in
this audit that asserted the opposite has been corrected in place.

## M10 — the `seen.add` ordering gap, closed

`plan.md:77-82` calls the `continue`'s placement "not a style point; it changes
output", and round 1 shipped it with **no mutant at all**: moving the `continue`
below `seen.add` left the whole suite green. It was cheap to close, so it was
closed rather than ledgered.

`Receiver.Pair` carries two `Student` `entityName` mentions on **one line** in
one method — `Student.Length` (bare receiver, dropped) then `Student other` (a
genuine type mention, kept). They share the entire dedupe key
`entity|file|line|type|method|via`, which excludes token position. Correct
placement yields **1** ref; the bug yields **0**. **G40** pins it, with a
structural control asserting the line really carries both mentions in that
order, so a later tidy-up that split them cannot leave the gate silently green.

**M10 (move the `continue` below `seen.add`) — 6 failed:**
- `entity-refs.test.ts` — the whole ordered array; G21; **G40**
- `refs.test.ts` — G24; G25; G29

### Pin churn from M10's case

The new row is a `Student` ref, so — unlike round 1's Gap-1 case, which rule B
removes — it **does** move the `Student` counts that round 1's deviation #1 said
had stayed put:

- `entity-refs.test.ts`: one row added to the ordered array; `refs.length` 21 → **22**
- `refs.test.ts`: `entityRefs.length` 21 → **22**; `refsFor(g,"Student").length`
  9 → **10** in four places; G25's title "finds nine" → "finds ten"; header
  comment corrected
- `api.test.ts`: **unchanged** — G30/G34 pin `Course`, which M10's case does not touch
- `refs.test.ts` G27: **unchanged in length** (a `Course` list), but its one
  `EnrollmentService` entry moved to the new `Terse` line

## The other fold-ins

- **`entity-refs.ts` — `?.` and `!.` added to the enumerated limitations.**
  Verified against the lexer myself rather than quoted: `Student?.Name` lexes as
  `ident:Student`, `punct:?.`, `ident:Name`; `Student!.Name` as `ident:Student`,
  `punct:!`, `punct:.`, `ident:Name`. `next.text === "."` is false in both, so
  both escape the rule, and `User?.FindFirstValue(...)` — the exact corpus
  phenomenon — would survive it. Recorded as an **under-reach** hole beside the
  existing over-reach one, not fixed: fixing it unmeasured is what the rules here
  forbid.
- **G38's aloneness is now structurally gated.** `toContain` did not gate it; a
  second `Student` on that line would have disarmed M4 silently. G38 now also
  asserts the line contains exactly **one** `Student`, matching the protection
  G39 already had.
- **`entity-refs.ts` — the "4.6%" denominator is named**: 14 of the 303 refs the
  two repos produce with D-Hb-10 and without the rule; 4.8% against the 289 that
  remain after it.
- **The flake claim is softened** to "no detectable increase", with its three
  limits stated, including that **no individual failing test reproduced across
  arms** — so "the same two files" is a file-level claim only.
- **The 401 note** now says "the only 401 **response** in the server's `src`",
  and notes `apps/web/src/lib/api.ts:201,225` as client-side handling.

## The two "verify unmoved and say so" items the plan required and round 1 omitted

Both were required by `plan.md:215-218`. Round 1 verified neither explicitly.
Both are **unmoved**, and here is how that was checked:

1. **The fixture-shape pin** (`entity-refs.test.ts`, entities / shapes /
   relations / `warnings: []`). `git diff HEAD` over that file produces **no
   added or removed line** matching `graph.entities`, `graph.shapes`,
   `graph.relations` or `graph.warnings` — the assertions are byte-identical to
   `HEAD`. They also pass, and the independent corpus script reports the fixture
   at entities 2 / relations 1 / shapes 0 / warnings 0, unchanged from baseline.
   The two new classes did **not** register as entities.
2. **G37's locale-compare discrimination.** `git diff HEAD` produces no added or
   removed line touching `localeCompare`, `byCodeUnit`, `byLocale` or
   `toContain(STALE)`. Its two preconditions hold: the `_Stale/` rows are still
   in the ref dump, and `git status` shows **no new file or directory** under
   `test/fixtures/` — only the one modified `.cs` file — so no new letter-named
   directory was introduced. G37 passes.

## Round 2 numbers — all re-measured after the edits

| run | round 1 | round 2 |
|---|---|---|
| `pnpm test` | 477 passed | **477 passed** (36 files) |
| `PSQ_NO_CORPUS=1 pnpm test` | 419 / 58 skipped | **419 passed / 58 skipped** |
| `pnpm typecheck` | exit 0 | exit **0** |

The total is 477 in both rounds **because one test was deleted and one (G40)
added** — not because nothing changed. Skipped is still exactly **58**.

**Corpus, re-measured after the fixture and comment edits rather than assumed
unaffected:** repoA **240**, repoB **49**, repoC 0 — identical to round 1, with
entities / relations / shapes / warnings all unmoved (17/20/36/0 and 9/8/15/0).
Fixture-only edits did not reach the corpus, as expected, and that is now
measured rather than inferred.

**Fixture: 21 → 22 refs.** `Receiver.Read` yields **0** (the control);
`Receiver.Pair` yields exactly **1** (M10's victim); `Terse.Roster` moved to
line 112 as the file grew.

## All ten mutants, re-run against the round-2 tree

M1-M8 and M10 under `pnpm test`; M9 under `PSQ_NO_CORPUS=1`, since its whole
point is hermetic gating.

| mutant | failed | changed since round 1 |
|---|---|---|
| M1 revert `=>` branch to `body: []` | 14 | — |
| M2 delete the fallback | 2 | — |
| M3 delete the fallback's warning | 1 | — |
| M4 delete the receiver rule | 6 | same size; survived the Gap-1 reshape |
| M5 drop `prev != "."` | 10 | — |
| M6 drop `depth <= 0` | 13 | unchanged — the deleted test was never in this set |
| M7 drop `next == "."` | 24 | **23 → 24**, now also reddens G40 |
| M8 revert `EXTRACTOR_VERSION` | 1 | — |
| M9 revert change A, hermetic | 14 | — |
| **M10 `continue` below `seen.add`** | **6** | **new — the gap round 1 left open** |

Full per-mutant failure sets are unchanged from round 1 except where noted; the
two changes are M7 gaining G40 and every `refs.test.ts` G25 row now reading
"finds ten".

## Deviations and corrections, round 2

1. **Round 1's deviation #1 is now partly superseded.** It said the
   `refsFor(g,"Student").length` pins do not move. That was true of round 1's
   fixture; M10's case is a surviving `Student` ref, so they move 9 → 10. The
   original observation was correct for the tree it described; it no longer
   describes the shipped tree.
2. **Round 1's Gap-1 fixture case asserted the wrong answer** (BLOCKING 2), and
   round 1's ledger claimed the opposite in so many words. Both are corrected,
   and the false ledger sentence is marked as false rather than silently edited.
3. **Round 1's `structure.test.ts` "member AFTER is still parsed" test carried a
   false because-clause and gated nothing** (BLOCKING 1). Deleted; the refutation
   is recorded in the file.
4. **One pin was missed on the first round-2 edit pass** and caught by the suite,
   not by review: `refs.test.ts` G27's literal list still named the old `Terse`
   line (87) after the fixture grew to 112. Recorded because a fix pass that
   introduces a failure it then fixes is exactly the kind of thing that
   disappears from a record otherwise.

## Ledger — what remains ungated, after round 2

- **The rule's over-reach** (`Student.Create(...)` dropped). Measured corpus
  occurrences: 0. No fixture asserts either answer for it — deliberately.
- **The rule's under-reach** (`?.` and `!.` escape it). Measured against the
  lexer. Not gated, not fixed.
- **What was dropped leaves no trace.** A consequence of rejecting the
  `EntityRef` field; no gate could exist for it.
- **repoB / repoC `warnings: []`.** Only repoA pins it; the others were checked
  by hand twice and are held by nothing.
- **The corpus numbers themselves.** Measurements in this audit, not assertions
  in the suite.
- **The pre-existing `apps/server` flake**, including the unexplained 401. Out of
  scope, flagged, not attributed to this phase — and not cleared of it either.

`seen.add` ordering has **left** this ledger: it is gated by M10.

---

# Round 3 — after review

One blocking item, four fold-ins. Same ten files; no eleventh. Not committed,
not pushed. Everything re-measured after editing.

## BLOCKING — round 2's deletion justification was a false universal

Round 2 was asked to remove a false because-clause. It removed one and
**introduced another in the same edit** — this is the third time rule 10 has
landed in this phase, and the second time the carrier was a correction.

### What I measured, independently, before changing anything

**The local-function shape, four trees.** `Local` is a local function inside the
statement lambda — legal C# 7+:

```
class C { public object M() => A(() => { Local(); void Local() { c(); } }, Tail);
          public int After { get; set; } public void Z() { Body; } }
```

| tree | methods | props |
|---|---|---|
| shipped (round 2) | `["M","Z"]` | `["After"]` |
| M6 (depth-less) | `["M","Local","Z"]` | `["After"]` |
| pre-H-e (`HEAD`) | `["M","Local","Z"]` | `["After"]` |
| M11 (`i = to`) | `["M"]` | `[]` |

**The 150-shape sweep, run by me rather than cited.** 30 expression bodies × 5
trailing-member arrangements, through shipped, M6 and real pre-H-e:

| comparison | identical | **lost** a member | **gained** one |
|---|---|---|---|
| shipped vs M6 | 140 | **0** | **10** |
| shipped vs pre-H-e | 140 | **0** | **10** |

So round 2's *narrow* premise survives — **0 of 150 lose a member** — and its
*conclusion* does not. The 10 gains are expressions 22 and 23 of the sweep (the
two local-function shapes) across all five trailing arrangements. **A
member-list assertion reddens on gain exactly as well as on loss**, so option
(a) was reachable all along and "unreachable" / "no input can do better" /
"coverage cost: none" were all false.

That I labelled the replacement "read off the code rather than measured" makes
it honest about its own provenance and no less wrong. An unmeasured
because-clause is a defect here even when it is flagged as unmeasured.

### One correction to the instruction, measured

The round-3 message predicted the restored assertion reddens "under M6 **and**
under M1/pre-H-e". Measured: **under M6 yes, under real pre-H-e yes, under M1
no.** M1 as this phase implements it blanks the captured body but leaves the
depth-tracked scan and the resume point intact, so the member list is unchanged;
it is not equivalent to pre-H-e code. Recorded rather than repeated, and the
distinction is written into the test comment.

### The coverage hole was real, and is now closed

`Terse.Roster` is the only expression-bodied method in any hermetic C# fixture,
and the member after it (`Pick`) contributes no refs — so breaking the resume
moved nothing anywhere. **M11** (`structure.ts` success path, `i = scan + 1` →
`i = to`) reddens **exactly one test in the entire suite**: the restored one.
Before round 3 it would have reddened nothing at all. That is the measurement
that shows the deletion cost real coverage, not the argument about it.

### What is in the tree now

Two tests, both in `structure.test.ts`:

1. **the restored member-list gate** — the local-function source above, pinned
   with `toEqual(["M","Z"])` and `["After"]`, with all four tree outcomes and
   the M1 correction in its comment;
2. **the latent-bug gate** (fold-in below).

Plus a corrected note replacing round 2's deletion note: what is true (0/150
lose), what round 2 wrongly concluded from it, and why gain is the reachable
direction.

## Fold-in — the latent bug change A silently fixes

Nothing in `plan.md`, `measurement.md` or rounds 1-2 records this. **Measured
against `HEAD`:** under the pre-H-e reader a local function inside a statement
lambda was emitted as a **class method with a real body** —
`Local body: ["Course","c","=","null","!",";"]` — so every ref inside it was
attributed to `type: "C", method: "Local"`, **a member the type does not have**.
After change A the lambda, local function and all, stays inside `M`'s body.

So on this shape depth tracking is **not defensive, it is corrective**. That is
a genuine exception to the "defensive only" finding recorded in round 1 and in
`structure.ts`'s doc comment, and it is now stated next to it. It is consistent
with the corpus diff being `+6/−0`: no corpus repo contains the shape, which is
why the corpus could not show it.

Gated by the second new test, which pins `methods ["M"]` and that `M`'s body
contains `Course`. It reddens under M1, M6 and M9.

## Fold-in — gating the declaration that makes B2's fix a fix

G38 protected the line's content and its aloneness but not the **collision** it
depends on. Delete `public string Student { get; set; } = "";`
(`EnrollmentService.cs:83`) and `Read`'s `Student.Length` reverts to exactly the
round-1 situation — a bare entity-named receiver with no colliding member, i.e.
the documented limitation's wrong answer — while G38 stayed green.

G38 now reads line 83 back and asserts the declaration is there, via a named
`COLLIDING_MEMBER_LINE` constant. A gate that survives the removal of its own
premise is not a gate.

## Fold-ins — record hygiene

- `audit.md` flake heading changed from "attributed by measurement" to
  "compared by measurement" — the last sentence of the old over-claim.
- The "Gated, each by a named mutant" ledger now lists **M10** and **M11**.
- Round 2's "unreachable" and "coverage cost: none" passages are **struck in
  place and marked FALSE**, with the surviving narrow claim quoted beneath, so
  the record shows the correction rather than a clean sentence that was never
  wrong.

## Round 3 numbers — all re-measured

| run | round 2 | round 3 |
|---|---|---|
| `pnpm test` | 477 | **479 passed** (36 files) |
| `PSQ_NO_CORPUS=1 pnpm test` | 419 / 58 | **421 passed / 58 skipped** |
| `pnpm typecheck` | 0 | **0** |

+2 tests: the restored member-list gate and the latent-bug gate. Skipped is
still exactly **58**.

**Corpus, re-measured rather than assumed unaffected by test-and-fixture-only
edits:** repoA **240**, repoB **49**, repoC 0, fixture **22** — identical to
round 2, entities / relations / shapes / warnings all unmoved.

## All eleven mutants, re-run against the round-3 tree

| mutant | failed | change |
|---|---|---|
| M1 revert `=>` branch to `body: []` | **15** | 14 → 15 (gains the latent-bug test; does **not** redden the member-list test) |
| M2 delete the fallback | 2 | — |
| M3 delete the fallback's warning | 1 | — |
| M4 delete the receiver rule | 6 | unchanged after the G38 read-back |
| M5 drop `prev != "."` | 10 | — |
| M6 drop `depth <= 0` | **15** | 13 → 15 (gains both new tests) |
| M7 drop `next == "."` | 24 | — |
| M8 revert `EXTRACTOR_VERSION` | 1 | — |
| M9 revert change A, hermetic | **15** | 14 → 15 (gains the latent-bug test) |
| M10 `continue` below `seen.add` | 6 | — |
| **M11 `i = scan + 1` → `i = to`** | **1** | **new — reddens the restored test and nothing else** |

M11's failure set, in full, is one row:
`packages/extract/test/structure.test.ts > D-Hb-10: expression-bodied method
bodies are captured > and the member list after such a method is EXACTLY right`.

## Deviations and corrections, round 3

1. **Round 2's BLOCKING-1 conclusion was false** and is struck in place. The
   narrow premise (no member loss) is re-measured and stands at 0/150.
2. **The instruction's "M1/pre-H-e" equivalence is wrong**; M1 does not redden
   the restored test. Measured, and written into the test.
3. **Round 2's "coverage cost: none" was unfalsifiable as stated** — the deleted
   test was absent from every mutant set because no mutant existed for what it
   gated. M11 now exists and reddens only it.
4. **A splice error during the edit** left `structure.test.ts` with an unclosed
   `describe`; esbuild caught it before any test ran. Recorded for the same
   reason as round 2's missed pin: a self-inflicted failure that a later reader
   cannot see in the final diff.

## Ledger — what remains ungated, after round 3

Unchanged from round 2 except that **the success-path resume has left it**
(gated by M11) and **the latent local-function misattribution has left it**
(gated by the second new test). Still ungated:

- the rule's **over-reach** (`Student.Create(...)` dropped; 0 corpus occurrences);
- the rule's **under-reach** (`?.` and `!.` escape it; measured against the lexer);
- **what was dropped leaves no trace** — a consequence of rejecting the
  `EntityRef` field;
- **repoB / repoC `warnings: []`** — checked by hand three times now, held by
  nothing;
- **the corpus numbers themselves** — measurements here, not assertions in the suite;
- **the pre-existing `apps/server` flake**, including the unexplained 401.

On the reviewer's own disclosure: its corpus-on suite went red once in 14 runs
with the message uncaptured. That is consistent with the flake this audit
measured at 4/106 and 2/106, but **an uncaptured red proves nothing about which
flake it was**, and I am not counting it as confirmation. No red occurred in any
round-3 run of mine; had one occurred I would have captured it before re-running.
