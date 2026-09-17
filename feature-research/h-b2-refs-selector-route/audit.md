# Phase H-b2 — `refsFor` and `GET /api/repos/:id/refs` — AUDIT

Plan: `plan.md` (rev 3, approved), followed. Branch `master`, from `5143fe2`,
tree clean at start (41 ahead of origin). **Not pushed.**

Commits, in logical units:

- `08d77d2` feat(graph): refsFor
- `b4a7ca4` feat(server): GET /api/repos/:id/refs
- `ef5a683` test(extract): G37 — the ICU tripwire

## Files changed

**Review round 2 (this revision) touched two files, record only:**
`feature-research/h-b2-refs-selector-route/audit.md` and
`packages/graph/test/refs.test.ts` (the G29 comment re-worded, no assertion
changed). `refs.ts`, `app.ts` and every gate's assertions are untouched. See
"Review round 2" at the end.

**Review round 1 touched four files:**
`packages/graph/test/refs.test.ts`, `packages/extract/test/entity-refs.test.ts`
(the G37 block only), `apps/server/src/app.ts` (route comment + one readability
expression), `feature-research/h-b2-refs-selector-route/audit.md`. Nothing else.

The full phase list follows.

Production:

1. `packages/graph/src/refs.ts` — **new**. `refsFor(graph, entity, opts?)`.
2. `packages/graph/src/index.ts` — one line: `export { refsFor } from "./refs.js";`
   beside the `searchEntities` re-export. No `RefVia` passthrough.
3. `apps/server/src/app.ts` — the route, beside the other `:id`-scoped GETs;
   `refsFor` added to the `@psq/graph` import (`:7`), `RefVia` to the
   `@psq/schema` import (`:8`).

Gates:

4. `packages/graph/test/refs.test.ts` — **new**, G24-G29 (6 `it()`).
5. `apps/server/test/api.test.ts` — new `describe("entity refs")`, G30-G36
   (7 `it()`); `MINI_EFCORE_REFS` added to the fixtures import at `:11`.
6. `packages/extract/test/entity-refs.test.ts` — G37 only, one appended
   `describe`/`it()`. Nothing existing edited.

Docs:

7. `feature-research/h-b2-refs-selector-route/audit.md` (this file)
8. `feature-research/h-b2-refs-selector-route/plan.md` (pre-existing, untracked
   at phase start)

**Not touched**, as the plan requires: `structure.ts`, `detect.ts` (no
`EXTRACTOR_VERSION` bump), every file under `test/fixtures/`, the pinned 20-row
array / `DUP_LINE` / the two hardcoded `6`s / the `toBe(20)` in
`entity-refs.test.ts`, `rehydrate.test.ts`, `dotnet.ts`, `merge.ts`,
`apps/web/`, `apps/server/package.json`.

## What changed, per file

**`packages/graph/src/refs.ts`** — the whole selector is one filter:

```ts
const via = opts?.via;
return graph.entityRefs.filter((r) => r.entity === entity && (via === undefined || r.via === via));
```

Exact, case-sensitive match on `ref.entity` (D-Hb2-3); unknown name → `[]`;
order inherited from `graph.entityRefs`, never re-sorted; an omitted `opts.via`
means **both** vias. The "returns a copy" property is recorded in the file's
doc comment as ungated, per D-Hb2-2 — no mutant reaches it without also
breaking the entity filter.

**`apps/server/src/app.ts`** — `GET /api/repos/:id/refs`, guard order
repo-lookup-then-validation (404 beats 400), neither parameter coerced, `via`
validated by `RefVia.safeParse`, body
`{ entity, via: RefVia | null, known, refs }`. `known` is
`repo.graph.entities.some((e) => e.name === entity)` — computed independently
of `refs`, which is what G33/M33 exists to hold. D-Hb2-6's caveat (a
`dbSetName` ref is a mention, not a DbContext access) is in the route comment.

**Tests** — every graph is built with `extractDotnet(MINI_EFCORE_REFS)` /
`MINI_EFCORE` or opened through the API from those fixture paths; no
hand-written `EntityGraph` literal anywhere (`search.test.ts:7-10` convention).

## Reachability, measured against the unmodified tree before any code was written

| Claim | Measured |
|---|---|
| `Course` refs on `mini-efcore-refs` | **11**, vias `["entityName","dbSetName"]` |
| `Student` refs | **9**, vias `["dbSetName","entityName"]` |
| total refs | **20** |
| `MINI_EFCORE` | 5 entities (Advisor, Course, Department, Enrollment, Student), `entityRefs.length === 0` |
| code-unit vs `localeCompare` order of `Course`'s ref files | **differ** — code unit puts `_Stale/Student.cs` last, `localeCompare` puts it first |
| node / ICU | v24.19.0 / 78.3 |

All match the plan's stated figures.

## Mutant table

Every mutant was hand-applied to production code, the suite run with
`--reporter=default` **and** `--reporter=json` (rule 8), the **whole** failure
set recorded (rule 7), then reverted with `git checkout --` and
`git status --porcelain` confirmed to show nothing but the untracked
`feature-research/h-b2-refs-selector-route/` directory.

**Corrected in review round 1.** The graph-side rows M24-M29 originally recorded
failure sets scoped to `refs.test.ts` ("n of 6") while the server-side rows
M30-M36 recorded suite-wide sets — an inconsistency that read as rule-7
compliance and was not. All five graph-side mutants were **re-measured
suite-wide** (`pnpm test`, both reporters, full 460/35) and the rows below now
carry the whole failure set. Counts marked **suite-wide** are the re-measured
figures; the "n of 6" phrasing is gone.

**Round 2 follow-up on the same inconsistency.** The server-side rows M30-M36
kept a "Reddens **n of 7**" phrasing — the same file-scoped denominator style,
against the 7 `it()`s of the new `describe("entity refs")`. Those rows were
already measured suite-wide, and every mutant's whole failing set fell inside
that `describe` (only `api.test.ts` exercises `/api/repos/:id/refs`, so a route
mutant has nowhere else to land), which is why the numbers were never wrong. But
the denominator style was the misleading one, so the rows now read **"n
suite-wide"** like the graph-side rows. The numbers are unchanged.

**What the re-measurement exposes, and it is the point of rule 7:**
`api.test.ts`'s G30 and G34 re-assert `refsFor`'s behaviour through HTTP —
G30 pins `refs.length === 11`, `refs[0]` in full and the `via=dbSetName`
narrowing; G34's positive control pins `refs.length === 10` for
`via=entityName`. So **a `refsFor` regression is caught in two packages**, and
four of the five graph-side mutants cross the package boundary. That overlap is
load-bearing information for anyone later judging whether a gate here is
redundant: deleting a `refs.test.ts` assertion does not necessarily stop the
suite noticing, and deleting an `api.test.ts` one does not either.

Messages below are verbatim from the default reporter.

| Gate | Mutant | Applied (code diff) | Failing assertion observed (exact vitest message/diff) | Reverted (clean check) |
|---|---|---|---|---|
| G24 | M24 drop the entity predicate | `filter((r) => r.entity === entity && (via === undefined \|\| r.via === via))` → `filter((r) => (via === undefined \|\| r.via === via))` | Reddens **8 suite-wide** — all 6 in `refs.test.ts` plus **G30** (`expected 20 to be 11 // Object.is equality`) and **G34** (`expected 17 to be 10 // Object.is equality`, the `via=entityName` control) in `api.test.ts`. The six in `refs.test.ts`, in file order — G24: `AssertionError: expected 20 to be 11 // Object.is equality` (diff `- 11 / + 20`, at `refs.test.ts:22:27`). G25: `expected [ { entity: 'Course', …(5) }, …(19) ] to deeply equal []` (diff lists all 20 rows as `+`). G26: `expected [ { entity: 'Course', …(5) }, …(19) ] to deeply equal []`. G27: `expected [ …(20) ] to deeply equal [ …(11) ]`. G28: `expected [ …(3) ] to deeply equal [ 'Services/EnrollmentService.cs:15' ]`. G29: `expected 20 to be 9 // Object.is equality` | yes — `git status --porcelain` clean |
| G25 | M25 case-fold both sides | `r.entity === entity` → `r.entity.toLowerCase() === entity.toLowerCase()` | Reddens **1 suite-wide**, G25 only: `AssertionError: expected [ { entity: 'Student', …(5) }, …(8) ] to deeply equal []` at `refs.test.ts:36:35` (the `refsFor(g, "student")` line). The only graph-side mutant that does **not** cross into `api.test.ts` — no route gate sends a wrong-cased entity | yes — clean |
| G26 | **none by design** | — | G26 is documentation, not a gated claim: G25's negative half already exercises the unknown-name path, and the plan retires a distinct mutant for it. Observed incidentally red under M24 (`expected [ { entity: 'Course', …(5) }, …(19) ] to deeply equal []`), which is consistent with it having no claim of its own | n/a |
| G27 | M27 `.reverse()` | `…filter(…)` → `…filter(…).reverse()` | Reddens **2 suite-wide** — G27 and **G30** (`expected { entity: 'Course', …(5) } to deeply equal { entity: 'Course', …(5) }`, G30's `refs[0]` pin). G27: `AssertionError: expected [ '_Stale/Student.cs:41', …(10) ] to deeply equal [ …(11) ]`, diff shows the pinned sequence reversed — `- "Controllers/CoursesController.cs:20" … + "_Stale/Student.cs:41", + "Services/EnrollmentService.cs:55", + "Services/EnrollmentService.cs:24", + "Services/EnrollmentService.cs:15", + "Data/RefsDbContext.cs:18", + "Controllers/CoursesController.cs:55"` (the `:47` pair is the fixed midpoint) at `refs.test.ts:61:38` | yes — clean |
| G28 | M28 ignore `opts.via` | `filter((r) => r.entity === entity && (via === undefined \|\| r.via === via))` → `filter((r) => r.entity === entity)` | Reddens **3 suite-wide** — G28: `AssertionError: expected [ …(11) ] to deeply equal [ 'Services/EnrollmentService.cs:15' ]` at `refs.test.ts:81:27`; **G30**: `expected [ …(11) ] to deeply equal [ 'Services/EnrollmentService.cs:15' ]` (the route's own `via=dbSetName` narrowing); **G34**: `expected 11 to be 10 // Object.is equality` (the `via=entityName` control). G28 is the only test **in `refs.test.ts`** it reddens. G29 stays **green** — the discriminating half of the M28/M29 pair | yes — clean |
| G29 | M29 filter unconditionally | `(via === undefined \|\| r.via === via)` → `r.via === opts?.via` | Reddens **6 suite-wide** — G24 `expected +0 to be 11`, G25 `expected +0 to be 9`, G27 `expected [] to deeply equal [ …(11) ]`, G28 `expected 11 to be +0` (the partition control, `refs.test.ts:87:50`), **G29** `expected [] to deeply equal [ 'dbSetName', 'entityName' ]` at `refs.test.ts:118:57` (re-measured after this round's comment edit; the cite was `:98:57` in round 1 and `:111:57` mid-round), and **G30** in `api.test.ts` `expected +0 to be 11`. G26 and G34 stay green (G34's control passes a `via`). **Deviation from the plan's prediction, see below** | yes — clean |
| G30 | M30 return `{refs}` alone | body `{ entity, via, known, refs }` → `{ refs }` | Reddens **2 suite-wide** — G30: `AssertionError: expected [ 'refs' ] to deeply equal [ 'entity', 'known', 'refs', 'via' ]`; G33: `expected undefined to be true // Object.is equality` | yes — clean |
| G31 | M31 drop the `!repo` guard | the four-line `if (!repo) { fail(res, 404, …); return; }` deleted, lookup becomes `workspace.get(…)!` | Reddens **2 suite-wide** — G31: `expected 400 to be 404 // Object.is equality`; G35: `expected 400 to be 404 // Object.is equality`. (400, not 500: `handler()` turns the thrown `TypeError` into a 400, which is exactly the silent-downgrade this gate exists to catch) | yes — clean |
| G32 | M32 drop `entity` validation | the `typeof entity !== "string" \|\| entity.trim() === ""` guard deleted | Reddens **2 suite-wide** — G32: `expected 200 to be 400 // Object.is equality`; G36: `expected 200 to be 400 // Object.is equality` | yes — clean |
| G33 | M33 `known = refs.length > 0` | `known: repo.graph.entities.some((e) => e.name === entity)` → `known: refsFor(repo.graph, entity, …).length > 0` | Reddens **1 suite-wide**, G33 only: `AssertionError: expected false to be true // Object.is equality` — the `MINI_EFCORE` / `Student` case, 5 real entities and zero refs | yes — clean |
| G34 | M34 drop the `via` validation | the `RefVia.safeParse` block → `const via = rawVia === undefined ? null : (rawVia as RefVia)` | Reddens **2 suite-wide** — G34: `expected 200 to be 400 // Object.is equality` (`?via=bogus` answered 200 with an empty list); G36: `expected 200 to be 400` (the repeated-`via` half) | yes — clean |
| G35 | M35 validate before the repo lookup | the repo-lookup block moved below both validation blocks | Reddens **1 suite-wide**, G35 only: `AssertionError: expected 400 to be 404 // Object.is equality`. G31 and G32 both stay **green**, which is the measured proof that neither of them observes guard order | yes — clean |
| G36 | M36 `String(entity)` coercion | `const entity = req.query["entity"]; if (typeof entity !== "string" \|\| entity.trim() === "")` → `const entity = String(req.query["entity"]); if (entity.trim() === "")` | Reddens **2 suite-wide** — G36: `expected 200 to be 400 // Object.is equality` (`?entity=Course&entity=Student` looked up `"Course,Student"` and answered 200); G32: `expected 200 to be 400` (missing `entity` became the string `"undefined"`) | yes — clean |
| G37 | **none by design** | — | G37 asserts a property of the fixture **and** the platform together (that code-unit and `localeCompare` orderings of the ref files can be told apart), not a behaviour of production code, so there is no production mutant to apply. It **passed on arrival**, so G17 is not disarmed today. Control measured instead: filtering the `_Stale` rows out of the derivation reddens it. **Re-measured in review round 1 after widening the derivation to ALL refs (N6):** G37 still passes on arrival (`pnpm test` 460/460, 35 files), and the control still reddens — `AssertionError: expected [ …(18) ] to not deeply equal [ …(18) ]` / `Compared values have no visual difference.`, 18 rows now rather than 10 because the derivation is no longer narrowed to `Course`. Reverted, green again | n/a (test-side control reverted; `git status --porcelain` clean) |

### Deviation: M29 reddens G28 as well as G29 — and G30, for six in all

The plan predicted M29 would redden G29 and **not** G28. As written, G28's last
assertion is a partition control —
`entityName.length + dbSetName.length === refsFor(g, "Course").length` — whose
third call passes no `via`, so M29 empties it and G28 reddens too
(`expected 11 to be +0`).

I kept the control rather than deleting it to make the prediction come true:
removing a positive control to satisfy a predicted failure set is weakening a
gate. The claim the prediction existed to establish still holds and is measured
above — **the two mutants have different failure sets**, and specifically G29
reddens under M29 while staying green under M28. G28 reddens under both. This
is the only place the implementation's observed behaviour differs from the
plan's stated expectation; nothing about the design changed.

**Re-measured in review round 1: the set is SIX, not five** — the five in
`refs.test.ts` plus **G30** in `api.test.ts`, which asks the route for `Course`
with no `via` and gets `[]`. The original row was scoped to `refs.test.ts` and
so undercounted.

**`refs.test.ts` now carries this measured set in its own comment.** Round 1
found the G29 comment asserting the mutant "reddens here and NOWHERE else",
which this measurement refutes — the codebase's own recorded failure mode, an
unverified because-clause travelling with the code while the correction sat only
in an audit the next reader will not open. The comment now names the six and
says why G28's partition control stays.

### Correction to `plan.md:183-185` — G29 is documentation, not a gated claim

The plan promoted G29 from "positive control" to a gated claim on the belief
that M29 isolated it. **It does not, and no mutant does.** Any mutation of
"omitted `via` means both" empties every no-`via` lookup in the file at once, so
G24, G25, G27 and G28's partition control all go red with it. G28, by contrast,
*is* singled out within `refs.test.ts` by M28.

So **G29 is subsumed — documentation, in the same category as G26.** It is kept,
not deleted: the contract it states is real and a reader should find it written
down. It simply must not be counted as an independent gate. The approved plan is
**not** rewritten; this is the record of the correction.

Gate count, honestly stated: the plan's inventory (`plan.md:281-300`) lists
**14 gates, G24-G37, with G37 inside that 14**. Of those, **11 carry an
isolating or distinguishing production mutant** (G24, G25, G27, G28, G30-G36),
**2 (G26, G29) are documentation**, and **1 (G37) is the environmental
tripwire** whose control is a test-side derivation rather than a production
mutant. 11 + 2 + 1 = 14.

The round-1 wording of this paragraph said "12 ... plus G37", spending 15 from a
14-item list by counting G37 both inside the inventory and again as an addition.
Corrected here against the plan's own table.

## Suite numbers

| Run | Before (at `5143fe2`) | After |
|---|---|---|
| `pnpm test` | **446 passed (446)**, 34 files | **460 passed (460)**, **35 files** |
| `PSQ_NO_CORPUS=1 pnpm test` | **388 passed / 58 skipped (446)** | **402 passed / 58 skipped (460)** |
| `pnpm typecheck` | exit 0, four projects | exit 0, four projects |

+14 = 6 (G24-G29) + 7 (G30-G36) + 1 (G37), and **34 → 35 files** because
`packages/graph/test/refs.test.ts` is new — the round-1 correction to this row,
which had both counts at 34; a new test file makes equal before/after file
counts impossible. **Skipped held at exactly 58**, so
the gitignored private corpus is intact. **Every pre-existing test is unmoved**
— no existing test was edited, renamed or renumbered, and the per-file counts
moved only where tests were added (`api.test.ts` 33 → 40,
`entity-refs.test.ts` 20 → 21, `refs.test.ts` new at 6).

`pnpm test:e2e` was **not** run, per the plan.

## `mini-efcore-refs` is still at 20 refs

Confirmed, and confirmed by the suite rather than by inspection: G21
(`entity-refs.test.ts`) asserts `expect(refs.length).toBe(20)` and G14/G19
assert the two hardcoded `6`s, and all three pass unchanged in the final run.
No extractor code and no fixture file was touched this phase, so no stored
envelope is invalidated and no `EXTRACTOR_VERSION` bump was needed or made.

## Review round 1 — what changed, and what did not

Verdict was **Fix first — record only, not code**: `refs.ts` and the route were
confirmed correct, no gate needed rebuilding, and **no behaviour changed**. The
selector, the route's logic and every gate's assertions are as they shipped,
with two exceptions, both explicitly scoped by the review:

1. **N6 — G37 derives from ALL refs, not the `Course` subset**
   (`entity-refs.test.ts`). `refs.filter(r => r.entity === "Course").map(...)`
   → `refs.map(r => r.file)`. G17 sorts the **whole** ref array, so the whole
   array is what must stay discriminating; the narrowed derivation would have
   stayed green after an edit that removed only `_Stale/Student.cs:24` (a
   `Student` row) while taking half of G17's discriminating power with it.
   Measured both ways, in the G37 row above: passes widened, control still
   reddens.
2. **N8 — readability in `app.ts`.**
   `via === null ? undefined : { via }` → `{ via: via ?? undefined }`. The two
   forms are indistinguishable to `refsFor`, which reads `opts?.via`. No
   behaviour change, and G30/G34 — unchanged — pin both the filtered and the
   unfiltered result through HTTP.

Record-only fixes:

- **B1** — the refuted because-clause in `refs.test.ts`'s G29 comment, replaced
  with the re-measured six-test failure set and the reason G28's partition
  control stays. Re-measured here, not copied from the review.
- **B2** — all five graph-side mutant rows re-measured suite-wide; the
  `api.test.ts` overlap (G30/G34) named.
- **N3** — G29 relabelled documentation; `plan.md:183-185` corrected in this
  audit, the approved plan left as approved.
- **N4** — the after-file count 34 → **35**.
- **N5** — one paragraph in the route comment naming the **one** `/search`
  decision this route deliberately does not copy: `?q=` is a 200 with no hits,
  a blank `?entity=` is a 400. The plan specifies the 400 (`plan.md:140`); the
  comment previously claimed to copy `/search` wholesale and was silent about
  the exception.
- **N7** — open risk 4 no longer implies `RefVia` is the first runtime zod value
  `app.ts` pulls from `@psq/schema`.

**Explicitly not done**, per the review: `api.test.ts:246`'s `" "` loop entry
left alone (harmless), `plan.md` not rewritten, no gate deleted, no assertion
changed, nothing touched outside the four files named at the top.

One measurement note, recorded because it was observed rather than reasoned:
during M27's JSON run `api.test.ts > opening a repo > reopening replaces the old
copy instead of leaking a database` failed once. It does not read `refsFor`, it
did not fail in the same mutant's default-reporter run, and it did not reproduce
on a clean re-run of M27 under both reporters. Recorded as a **pre-existing
intermittent failure unrelated to this phase**, not as part of M27's failure set
— which is 2: G27 and G30.

**The failure message and mode were not captured.** The run was reverted before
the output was saved and the failure has not reproduced since, so there is no
record of whether it was a vitest timeout under load or a real assertion
failure, and none is reconstructed here from memory. What *is* checkable and was
re-checked: `api.test.ts:16-20` builds a fresh `Workspace` per test, the reopen
test opens `MINI_EFCORE` rather than the refs fixture, and it never reaches
`refsFor` — so the characterisation "unrelated to this phase" rests on those
three facts, not on the lost message. A later reader wanting the mode will have
to catch it again.

## Open risks

1. **`via` is still a mention rule** (D-Hb2-6). The route now makes refs easy to
   fetch by `via`, which makes over-reading `dbSetName` as "went through the
   DbContext" more likely, not less. The caveat lives in the route comment and
   in `refs.ts`; nothing enforces it.
2. **`entity` is matched untrimmed.** A blank or whitespace-only `entity` is a
   400, but `?entity=%20Student` is a 200 with `known: false` — exact match, as
   D-Hb2-3 specifies. If that reads as surprising later it is a product call,
   not a bug.
3. **`apps/web/src/lib/api.ts:126`'s hand-written `EntityGraph` is still four
   fields behind** and will not see `entityRefs`. Out of scope (H-a2), untouched.
4. **`apps/server/package.json` still does not declare `zod`.** Examined and
   left, as the plan directs — for the seventh time. **This phase does not
   change that risk.** The original wording ("which the route now leans on")
   implied `RefVia` was a first: it is not — `app.ts:338` already calls
   `Section.safeParse` on a runtime zod value from `@psq/schema` (`app.ts:344`
   after this round's comment edit, `:338` before it), and predates
   this phase. `RefVia` is one more caller of an undeclared transitive
   dependency, not a new exposure.
5. **D-Hb-10 remains deferred to H-e** with its measured design intact in
   `plan.md`'s "Deferred to H-e" section. Nothing in this phase touched
   `structure.ts`.

## Review round 2 — what changed, and what did not

Verdict was **Fix first — one line**, and the reviewer confirmed the code:
`refs.ts` byte-identical to round 1, the route and every gate's assertions
unchanged, N6's widened G37 still discriminating with its control red, and all
five re-measured mutant sets reproduced on the reviewer's machine. **Every
remaining defect was in the record.** Two files touched, no behaviour changed,
no assertion changed.

- **B1 (blocking) — the gate count did not add up.** The round-1 sentence spent
  12 + 2 + 1 = 15 from a 14-item list by counting G37 once inside the plan's
  inventory and again as an addition. Corrected against `plan.md:281-300`
  directly: **11 production mutants + 2 documentation + 1 environmental = 14**.
- **N1 — the stale `refs.test.ts:98:57` cite in the M29 row.** The round-1
  comment insertion had pushed that assertion down. Re-measured by re-applying
  M29 and running `pnpm test`: the failing set is still exactly six
  (`refs.test.ts:22:27`, `:38:42`, `:61:38`, `:87:50`, `:118:57`, and
  `api.test.ts:212:34`), and the G29 cite is now **`:118:57`** — moved twice,
  once by round 1's comment and once by round 2's. The cites above the
  insertion point (`:22:27`, `:36:35`, `:61:38`, `:81:27`, `:87`) were confirmed
  against the file rather than assumed; all still correct, and `:87` is
  `:87:50` in full.
- **N2 — the "no mutant reddens G29 alone" claim sat inside a `MEASURED`
  paragraph.** It is an argument from the shape of a two-line predicate, not an
  observation. The comment now splits `MEASURED` from `INFERRED, not measured`
  and says plainly that no counter-mutant was found and none was proven
  impossible. The claim is kept, not deleted.
- **N3 — the flake record had no failure mode.** Recorded that the message and
  mode were **not captured**, rather than reconstructing them; the three
  checkable facts behind "unrelated to this phase" were re-verified and named.
- **N4 — "n of 7" denominators.** Normalised to "n suite-wide", with one
  paragraph saying why the server-side numbers were suite-wide-equal all along.

Final numbers, re-run after every edit above: `pnpm test` **460 passed (460)**,
**35 files**; `PSQ_NO_CORPUS=1 pnpm test` **402 passed / 58 skipped (460)**;
`pnpm typecheck` **exit 0**.
