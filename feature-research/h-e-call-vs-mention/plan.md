# H-e — plan (2026-09-18, rev 2 after plan review)

**Status: APPROVED 2026-09-20. Implementation not started at time of writing.**

Two decisions taken at approval, both closing questions rev 2 left open:
1. **Ship the full change A** — depth tracking + fallback + the manufactured
   Gap-2 fixture case. The minimal alternative in §2 stays rejected. Do not
   re-litigate this.
2. **§6 = add the hermetic gate** (option (a)), now with its own mutant M9.

Written after `measurement.md` (same directory), which refuted the premise this
phase inherited. Read that first. Rev 2 folds in a plan review that found four
blocking defects in rev 1; they are fixed here and noted at the end.

Corpus repos are referred to by the config's neutral keys — no repo name, path or
source line appears here. **This repo is PUBLIC.**

> The directory name `h-e-call-vs-mention` is now a **misnomer**. There is no
> call-vs-mention narrowing in this plan; the axis does not cut where the false
> positives are. The name is kept so the pointers in the H-b2 record and the
> phase ladder still resolve.

---

## 1. What H-e ships

Two changes, both **extraction-time**, that must land together.

**A — D-Hb-10: capture expression-bodied method bodies.**
`structure.ts:336-341` pushes `body: []` for every `=>` method, so refs inside an
expression body are invisible to the walker. Replace the naive scan-to-first-`;`
with a depth-tracked scan **plus a terminator-not-found fallback**, and capture
the tokens.

**B — the receiver-position rule: drop bare-receiver refs.**
In `collectEntityRefs` (`entity-refs.ts:87-182`), discard a candidate ref whose
entity token satisfies `prev != "." && next == "."`. Measured: 14/14 matches
across repoA+repoB are the framework-property collision, 0 genuine refs touched.

**They are coupled.** A introduces 4 of the 14 false positives that B removes.
**B alone removes only 10 of 14** — the other 4 do not exist until A lands
(`measurement.md:47-48`: baseline 3+7, post-fix 7+7). A alone regresses ref
quality by adding 4 false positives with nothing to remove them.

### Why B cannot be a `refsFor` filter

`refsFor` (`packages/graph/src/refs.ts:29-36`) is a pure filter over the
precomputed `graph.entityRefs`. `EntityGraph` keeps **no tokens**, so a
receiver-position test is impossible downstream. The only site with token
adjacency is `collectEntityRefs`, which already reads `prev = body[i-1]` and has
`body[i+1]` in hand. So B is an extraction-time drop.

**Alternative considered and rejected:** adding an `EntityRef` field (e.g.
`receiverPosition: boolean`) for query-time filtering. It needs a
`packages/schema` change, widens the phase, and buys reversibility for refs that
are noise by measurement. Rejected — but note the consequence honestly: **dropped
refs leave no trace**, and nothing downstream can report what was discarded.

### Why B cannot touch `dbSetName` refs — by construction, not by luck

`via = "dbSetName"` is assigned at exactly **one** place, `entity-refs.ts:136`,
inside the guard at `:134` (`prev !== null && prev.kind === "punct" && prev.text === "."`).
No other path in `packages/extract/src`, `packages/graph/src` or `apps/server/src`
assigns it. The rule requires `prev != "."`. The two are **disjoint by
construction**, so B can only ever touch `via: "entityName"`. The measurement's
"0 of 101 `dbSetName` refs" is a consequence of the code, not a corpus
coincidence — record it that way in the doc comment.

### Known limitation, to be documented not fixed

The rule is purely syntactic. A **genuine static-member access on an entity type**
(`Student.Create(...)`) matches it and would be dropped. Measured occurrences in
repoA+repoB: **0**. That is "0", not "safe" — the same distinction the name-keying
note already draws. It goes in the `entity-refs.ts` doc comment as a stated
limitation. Do not add a fixture case that asserts the wrong answer.

### Where the drop goes in the loop — a real trap

The `continue` must land **before** `seen.add(key)` (`entity-refs.ts:173-174`).
Placed after, a receiver-position occurrence poisons the dedupe key and suppresses
a *later legitimate* ref on the same line. This is not a style point; it changes
output.

---

## 2. The parser fix, precisely

Today (`structure.ts:336-341`): scan forward for the first `;` with no depth
tracking, push `body: []`, resume at `i = k + 1`. On runoff past `to`, `k` lands
at `to`, `i = to + 1`, the outer loop exits — **silently, with no warning**,
unlike the unbalanced-brace branches at `:323` and `:350`.

The fix has a sibling already in the file: the expression-bodied **property**
branch at `:385-408` does the depth-tracked scan (`(`/`[`/`{` vs `)`/`]`/`}`,
break on `t === ";" && depth <= 0`). Mirror it. Do not invent a new idiom, and do
not refactor the property branch into a shared helper in this phase.

**The fallback is mandatory and is the part that matters.** Measured: on the
malformed input `class C { public int A() => F(1; public int B { get; set; } public void Z() {...} }`
the naive depth-tracked fix loses **a property and a method with `warnings: []`** —
the counter is wedged by the unbalanced `(`, the scan runs to `to`, and `i = k + 1`
lands past the class body. When the scan reaches `to` without a terminator at
depth ≤ 0:

1. push a warning in the existing `:323` form (`` `${file}:${declLine}: ...` ``),
2. fall back to `body: []`,
3. resume from the **first `;` ignoring depth** — the old behaviour — so the
   remaining members are still parsed.

### The minimal alternative, rejected on the record

There is a smaller version of A: capture `tokens.slice(start, k)` using the
**existing** first-`;` scan — no depth tracking, no fallback, no warning. It would
delete M2, M3, M6 and the Gap-2 fixture case outright.

**Rejected**, but the reason must be stated honestly rather than implied:
- Measured, depth tracking is **defensive only**. On every real input the shipped
  first-`;` terminator and the depth-tracked scan produce identical output (repoA
  247, repoB 56, fixture 20). It fixes **no observed corpus failure**.
- The fallback exists to undo wedging that depth tracking itself introduces
  (`measurement.md:78-82`: shipped 2/1, naive depth-tracked 1/0, depth-tracked +
  fallback 2/1 — i.e. back to today's behaviour).
- The case for it is the **nested statement-lambda shape**, which no corpus repo
  currently contains. So the Gap-2 fixture case is **manufactured for a shape the
  corpus does not have**. That is a legitimate reason to ship it — the walker will
  meet that shape eventually and silently drop refs — but it must not be recorded
  as fixing something measured.

**The gating class is broader than H-b2 recorded.** H-b2 wrote "exactly ONE
construct gates the depth tracking". The real class is *any expression-bodied
member whose expression holds a statement lambda or block literal containing a
`;`* — three diverging shapes were found. Cover more than one shape.

---

## 3. The two gate gaps, and how each closes

Both are the "passes by finding nothing" kind. Neither closes by asserting a
count that is already true.

**Gap 1 — the receiver rule has no positive control outside the private corpus.**
The hermetic fixture matches it **0 times** today. Close it by adding a fixture
case the rule actually catches: a bare `Student.<member>` receiver read. It must
produce a ref **without** the rule and none **with** it. **It must sit on its own
line**, sharing no line with another `Student` mention of the same
type/method/via — otherwise the dedupe key (`entity-refs.ts:172`, which excludes
token position) keeps the row, M4 never reddens, and the positive control is dead
on arrival.

**Gap 2 — nothing gates D-Hb-10 in either direction.** The suite is 464 green
both with and without it. Close it with a fixture case whose refs only appear
once the fix lands: an expression-bodied method whose expression holds a
statement lambda with its own `;` and an entity mention **after** it.

### Mutants — every gate names one; each conjunct of a composite gets its own

| # | mutant | must fail |
|---|---|---|
| M1 | revert the method `=>` branch to `body: []` | the new `Terse`-style ref vanishes → fixture array pins |
| M2 | delete the terminator-not-found fallback | malformed-input test loses a property + a method → `structure.test.ts` |
| M3 | keep the fallback, delete its warning push | `structure.test.ts` warning assertion |
| M4 | delete the receiver rule entirely | the Gap-1 fixture case reappears → fixture array pins |
| M5 | drop the `prev != "."` conjunct | kills the `dbSetName` ref at `Controllers/StudentsController.cs:23` |
| M6 | drop the `depth <= 0` conjunct | the nested-lambda fixture ref vanishes |
| M7 | drop the `next == "."` conjunct | fatally red — but rule 6 requires it in the table |
| M8 | revert `detect.ts:60` to `2` | `rehydrate.test.ts` version gate (see §5) |

**M5 already has a victim — do not manufacture one.** `Controllers/StudentsController.cs:23`
is `Student created = _db.Students.Add(new Student()).Entity;`, where the
`Students` token has `prev == "."` **and** `next == "."`. Dropping the `prev != "."`
conjunct kills that ref and reddens `entity-refs.test.ts:79`, `:99` (G17), `:233`
(G13), `:246`/`:285` (6→5), `:300` (20→19), plus `refs.test.ts` and `api.test.ts`.
**Forbidden: adding a new occurrence for this** — every extra fixture row widens
the pin churn in §4. Note the victim is a `dbSetName` ref, not a navigation read.

Record each mutant's **whole failure set, suite-wide**, not file-scoped. H-b2's
lesson: 4 of 5 graph-side mutants crossed into `api.test.ts` and the record said
"n of 6" because it counted within one file.

---

## 4. Fixture placement and the full blast radius

**Put both new cases at the end of `Services/EnrollmentService.cs`, below line 55.**

- That file is **exactly 55 lines**, and line 55 is the `Dup.Sync` anchor —
  identical in `Controllers/CoursesController.cs`, also exactly 55 lines.
  Appending at 56+ cannot move either. The cross-file source read at
  `entity-refs.test.ts:178-181` (`lines[DUP_LINE - 1]`, `DUP_LINE = 55` at `:24`)
  and the `file`-component gate at `:148-149` both depend on this.
- The comment block at lines **26-54** (29 lines) is **structural padding, not
  prose** — do not "tidy" it.
- The file-scoped `namespace Refs.Api.Services;` (line 4) plus the `using`s mean
  appended classes resolve without new imports.
- Keeping both cases out of the students controller leaves `.toBe(6)` at
  `entity-refs.test.ts:246` and `:285` untouched.

### Pins that WILL move — three test files, not one

**`packages/extract/test/entity-refs.test.ts`** — the ordered array (`:66-89`) and
the total (`:300`).

**`packages/graph/test/refs.test.ts`** — this file was missing from rev 1 and is
the reason the file count was wrong:
`:22` `refsFor(g,"Course").length).toBe(11)` → 12;
`:27` `g.entityRefs.length).toBe(20)`;
`:28`/`:38`/`:119`/`:120`/`:121` `Student … toBe(9)`;
`:61-73` an **11-row literal ordered list** of `Course` refs (including
`Services/EnrollmentService.cs:15`/`:24`/`:55`);
`:85` `entityName.length).toBe(10)` → 11.

**`apps/server/test/api.test.ts`** — `:212` `refs.length).toBe(11)` (G30) and
`:272` `refs.length).toBe(10)` (G34).

**Verify unmoved and say so explicitly:** `entity-refs.test.ts:32-38` (entities /
shapes / relations / warnings) — a new service class must not register as an
entity; and G37's locale-compare discrimination (`:304-337`), which stays valid
so long as the `_Stale/` rows remain and no new letter-named dir appears.

**Confirmed safe, no action:** `entity-refs.test.ts:297` (`MINI_EFCORE` has no
expression-bodied *methods*), and the other .NET fixtures
(`mini-efcore-primary-ctor`, `mini-fullstack-csharp`, `mini-efcore-empty-context`,
`mini-solution-tie`) — none contains an expression-bodied method, so A moves no
fixture but `mini-efcore-refs`.

**Parser tests go in `packages/extract/test/structure.test.ts`**, as inline
template-literal sources passed to `parseCSharp(src, "SomeFile.cs")` — hermetic,
no `corpusRepo`, no `skipIf`. Do **not** route parser tests through the fixture
directory.

---

## 5. EXTRACTOR_VERSION — and making the bump actually gated

Bump `packages/extract/src/detect.ts:60` from **2 to 3**. Both changes alter
extraction output, and stored envelopes re-extract only on a version difference
(`apps/server/src/workspace.ts:265`; written at `:431`, field declared in
`store.ts:26`).

**The bump is ungated as the suite stands.** `rehydrate.test.ts` reads the
constant **symbolically** — `:528` and `:582` are `toBe(EXTRACTOR_VERSION)`, which
is true at any value. That is "a declaration cannot be gated by a test that merely
reads it". Two literals in G23 (`:552-585`) must change so the test gates the
value rather than mirroring it:

- `:557` `toBeGreaterThan(1)` → `toBeGreaterThan(2)`
- `:568` `patch(state, staleId, { extractor: 1 })` → `{ extractor: 2 }`

The second is the behavioural half: it proves a **version-2** envelope re-extracts
under version 3, which is exactly what the bump buys. **M8** (revert `detect.ts:60`
to `2`) must then redden `:557`. Run it.

**Never** fold this into the six-case test at `:305-307`, pinned to
`{loaded:3, failed:3, missing:1}`.

## 6. The side effect — and the gate that does not exist

Once A lands, an expression-bodied `OnModelCreating` starts feeding
`entityConfigs` (`dotnet.ts:193`) instead of `[]`.

**H-b2's record claims this is "gated by one inline `fluent.test.ts` case". That
claim is false and was never measured.** `packages/extract/test/fluent.test.ts` is
a single `describe.skipIf(!repoA || !repoB)` block (`:27`) with four corpus tests
(`:33`, `:50`, `:58`, `:68`), all reading corpus context files with **block-bodied**
`OnModelCreating`. No hermetic expression-bodied `OnModelCreating` test exists
anywhere in the repo. Under `PSQ_NO_CORPUS=1` the file does not run at all. So
"confirm `fluent.test.ts` still passes" would have been a gate that passes by
finding nothing.

**DECIDED at approval (2026-09-20): add the hermetic gate.** Write an inline case
in `fluent.test.ts` with an expression-bodied `OnModelCreating` and assert what
`entityConfigs` now contains — hermetic, no `corpusRepo`, no `skipIf`, so it runs
under `PSQ_NO_CORPUS=1`. It needs a mutant like every other gate: **M9** — revert
A (the method `=>` branch to `body: []`) and this case must redden, because
`entityConfigs` falls back to `[]`. If M9 does not redden, the case is asserting
something already true and is not a gate.

Recording the capability as ungated was the rejected alternative. What is
forbidden either way is repeating the inherited claim.

---

## 7. Numbers — predicted here, to be measured by the implementer

Derived from `measurement.md`. **These are predictions. Re-measure and record
actuals.**

| | baseline | after A | after A+B | predicted net |
|---|---|---|---|---|
| repoA | 241 | 247 | **240** | −1 |
| repoB | 56 | 56 | **49** | −7 |
| fixture | 20 | 20 + new cases | − Gap-1 case | (measure) |

repoA nets **one below its own baseline** — A adds 6, B removes 7 (the 4 new false
positives plus 3 that predate the fix). B removes 14 across A+B, 4.6% of the
post-A total of 303, entirely within `via: "entityName"`.

**240 and 49 are upper bounds on the removal, not exact predictions.**
`collectEntityRefs` dedupes on `entity|file|line|type|method|via`
(`entity-refs.ts:172`) — **token position is not in the key**. A matching
occurrence that shares a line with a non-matching occurrence of the same tuple
yields *no* net ref loss. If the actuals come in above 240/49, check the dedupe
before calling it a defect.

Report a **ref-level diff (`+n/−n`), not just totals** — H-b1's figure was wrong
because totals hid it. Entities, relations, shapes must be unmoved.

**On corpus warnings:** only repoA pins `warnings: []`
(`packages/extract/test/dotnet.test.ts:114-116`). repoB and repoC do **not** —
check theirs by hand. A adds a new warning branch, so this is the one place a new
warning could hide.

---

## 8. Verification

- `pnpm test` — currently **464 (36 files)**. Record the new count.
- `PSQ_NO_CORPUS=1 pnpm test` — green baseline is **406 passed / 58 skipped**.
  Skipped must be exactly 58; below 58 means the private corpus config vanished:
  **stop, do not "fix" it**.
  **A pre-existing red is possible** — 1 failure in 12 clean-tree runs was seen
  during plan review (message not captured). If a run is red, **capture the
  message before re-running**. Do not re-run it away, and do not attribute it to
  this phase without the message.
- `pnpm typecheck`.
- Three-point corpus measurement (baseline / A / A+B) per §7.
- All **nine** mutants (M1-M9), each with its suite-wide failure set.
- `node`/`pnpm` are not on the default PATH — use `zsh -lc`.
- Use `--reporter=default` alongside the JSON reporter; the JSON one drops the diff.
- **Do not run `pnpm test:e2e`.** It runs `build:web` against an `emptyOutDir: true`
  target and empties the `apps/web/dist` the live server serves. This phase touches
  no web or server source, so it is pure risk.

## 9. Out of scope

No `refsFor` signature change, no new `RefVia` value, no `packages/schema` change,
no web client change. No refactor of the property branch into a shared helper. No
push — master is already 4 ahead of `origin/master` and pushing is a separate call.
Never commit corpus source, corpus paths, or absolute home paths.

---

## Files touched — 10

1. `packages/extract/src/csharp/structure.ts` — depth-tracked scan + fallback + warning at the method `=>` branch (`:336-341`)
2. `packages/extract/src/csharp/entity-refs.ts` — receiver-position rule, placed before `seen.add` (`:173-174`), + doc comment
3. `packages/extract/src/detect.ts` — `EXTRACTOR_VERSION` 2 → 3 (`:60`)
4. `packages/extract/test/structure.test.ts` — inline hermetic parser gates (depth tracking, fallback, warning)
5. `packages/extract/test/entity-refs.test.ts` — ordered array (`:66-89`), total (`:300`); new ref-level gates
6. `packages/graph/test/refs.test.ts` — counts at `:22`, `:27`, `:28`/`:38`/`:119-121`, `:85`; literal list `:61-73`
7. `apps/server/test/api.test.ts` — G30 `:212`, G34 `:272`
8. `apps/server/test/rehydrate.test.ts` — G23 literals `:557`, `:568`
9. `test/fixtures/mini-efcore-refs/Services/EnrollmentService.cs` — append both cases at 56+; line 55 must not move
10. `packages/extract/test/fluent.test.ts` — hermetic expression-bodied `OnModelCreating` case (§6, mandatory)

If the work needs an eleventh file, stop and say so.

---

## Rev 2 changelog

Plan review found four blocking defects in rev 1, all fixed above:
- **B1** Files touched listed 8; `refs.test.ts` and `api.test.ts` also pin fixture
  counts. The implementer would have hit rev 1's own "ninth file, stop" tripwire.
- **B2** §1 said B alone "leaves 10 of the 14 in place" — inverted. It *removes*
  those 10; A creates the other 4.
- **B3** §6 repeated H-b2's unmeasured claim that `fluent.test.ts` gates the
  `entityConfigs` capability. It does not — the file is entirely corpus-gated.
- **B4** The version bump had no mutant and G23 reads the constant symbolically.
Also folded in: the existing M5 victim (no new fixture row), the `seen.add`
ordering trap, the dedupe caveat on §7's numbers, M7, the repoA-only `warnings: []`
pin, the clean-tree flake, the minimal-alternative rejection, and four loose cites.
