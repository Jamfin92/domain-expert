# Phase H-b1 — entity references, C# side, extraction half — AUDIT

Plan: `plan.md` (rev 2), followed. Branch `master`, from `8de5fce`, tree clean
at start. **Not pushed** — master stays ahead of origin.

## Files changed

Production:
1. `packages/schema/src/index.ts` — new `RefVia`, `EntityRef`; `entityRefs` on
   `EntityGraph` as `z.array(EntityRef).default([])`.
2. `packages/extract/src/csharp/entity-refs.ts` — **new**. The walker,
   `EntityRefTarget`, `EntityRefOptions`, `compareEntityRefs`.
3. `packages/extract/src/dotnet.ts` — import; `collectEntityRefs` call;
   `entityRefs` on both graph returns.
4. `packages/extract/src/detect.ts` — `entityRefs: []`; `EXTRACTOR_VERSION`
   1 → 2.
5. `packages/extract/src/node.ts` — `entityRefs: []`.
6. `packages/extract/src/merge.ts` — `entityRefs: dotnet.entityRefs`.

Fixture:
7. `test/fixtures/mini-efcore-refs/Data/RefsDbContext.cs` — **new**
8. `test/fixtures/mini-efcore-refs/Models/Student.cs` — **new**
9. `test/fixtures/mini-efcore-refs/Models/Course.cs` — **new**
10. `test/fixtures/mini-efcore-refs/Controllers/StudentsController.cs` — **new**
11. `test/fixtures/mini-efcore-refs/Controllers/CoursesController.cs` — **new**
12. `test/fixtures/mini-efcore-refs/Services/EnrollmentService.cs` — **new**
13. `test/fixtures/mini-efcore-refs/_Stale/Student.cs` — **new**
14. `test/fixtures.ts` — `MINI_EFCORE_REFS`

Gates:
15. `packages/extract/test/entity-refs.test.ts` — **new**, G1-G19, G21
16. `packages/extract/test/merge.test.ts` — G20 appended
17. `apps/server/test/rehydrate.test.ts` — G22/G23 as new `it()` blocks; two
    imports widened

Typed `EntityGraph` literals (`entityRefs: []`), all six enumerated by `tsc`:
18. `packages/extract/test/merge.test.ts` (same file as 16)
19. `packages/graph/test/layout3d.test.ts`
20. `test/client-mcq.test.ts`
21. `test/shape-label.test.ts`
22. `test/component-label.test.ts`
23. `apps/server/test/store.test.ts`

Docs:
24. `feature-research/h-entity-refs-csharp/audit.md` (this file)
25. `feature-research/h-entity-refs-csharp/progress.md`

Also committed, but **not written by me** — they were already on disk,
untracked, when this phase started, and the docs commit simply tracks them:
`feature-research/h-entity-refs-csharp/plan.md` and `plan-rev1-rejected.md`.
Neither was edited.

**Nothing else was touched.** No `zod` in `apps/server/package.json`. No TS
extractor, CLI or web change. `pnpm test:e2e` was never run.

Commits: `bc9a893`, `335fac1`, `b544419`, plus this file.

---

## 1. The mutant table

Every mutant was applied to the tree, run, its `failureMessages` captured, and
reverted; the harness re-ran `git status --porcelain` after each revert and
every one came back with the production tree clean. Gates run under
`PSQ_NO_CORPUS=1`.

Assertion texts are the vitest message, and where a behaviour rides on the
one whole-array `toEqual` the **diff line** is quoted too — the message alone
says only "to deeply equal" and never names the drifted field. That is H-a's
rule 4 in practice, and the JSON reporter turns out to **drop the diff
entirely**, so both reporters had to be run together.

Baseline for the walker gate file: 14 tests, all passing.

| Gate | Mutant | Applied | Failing assertion observed | Reverted |
|---|---|---|---|---|
| G1 | M1: walker returns `[]` | `return out.sort(...)` → `return []` | 13/14 failed. `expected [] to deeply equal [ { entity: 'Course', …(5) }, …(12) ]` | clean |
| G2 | M2: `method: ""` | | `expected [ … …(11) ] to deeply equal [ … …(12) ]`; diff `- "method": "Slug" / + "method": ""`; and G7 `expected [ '' ] to deeply equal [ 'SeedFirstCourse' ]` | clean |
| G3 | M3: `type: ""` | | diff `- "type": "CoursesController" / + "type": ""` ×13; G4 `expected 0 to be greater than 0` | clean |
| G4 | M4: skip types not named `*Controller` | | `expected 0 to be greater than 0` (EnrollmentService); array `…(8)` vs `…(12)` | clean |
| G6 | M6: also walk property/field declarations | | `expected [ { entity: 'Course', …(5) } ] to deeply equal []` (the nav property on `Models/Student.cs`); array grows to 16 | clean |
| G7 | M7: remove the D-Hb-5 exclusion | | `expected [ { entity: 'Course', …(5) }, …(1) ] to deeply equal []` (refs named `OnModelCreating`); G21 `expected [ { entity: 'Advisor', …(5) }, …(13) ] to deeply equal []` | clean |
| G8 | M8a: `token.line - 1` | | `expected [ 54, 55 ] to deeply equal [ 55, 56 ]` (G12) and `expected [ 22, 55 ] to deeply equal [ 23, 56 ]` (G13); 7/14 failed | clean |
| G8 | M8b: `method.line` | | `expected [ 48, 48 ] to deeply equal [ 55, 56 ]` — the two `Locals` refs collapse onto the method's own declaration line; 8/14 failed | clean |
| G9 | M9: emit `Entity.file` (the declaring file) | | 9/14 failed; diff `- "file": "Controllers/CoursesController.cs" / + "file": "Models/Course.cs"`; `expected [ { entity: 'Student', …(5) }, …(7) ] to deeply equal []` (G6: every ref now lands on a `Models/` file) | clean |
| G10 | M10: dedupe ignoring `line` | | diff loses the whole `"line": 32` object — two mentions on two lines become one ref; `expected 5 to be 6` | clean |
| G11 | M11: no dedupe at all | | diff gains a second `"line": 30` object — two mentions on one line become two refs; `expected [ 'dbSetName', 'entityName', …(1) ] to deeply equal [ 'dbSetName', 'entityName' ]` | clean |
| G12 | M12: case-insensitive equality | | `expected [ 51, 55, 56, 57 ] to deeply equal [ 55, 56 ]` — the local `student` on line 51 becomes a ref | clean |
| G13 | M13: drop the preceding-`.` requirement | | `expected [ 23, 53, 56, 57 ] to deeply equal [ 23, 56 ]` — the local `Students` on line 53 becomes a `dbSetName` ref | clean |
| G14 | M14: `.includes()` instead of `===` | | `expected [ { entity: 'Student', …(5) }, …(2) ] to deeply equal []` — **all three** of `StudentDto`, `"Student"` and `$"{Student}"` become refs; array grows to 19 | clean |
| G15 | M15: match any name in `byName` | | 9/14 failed; `CourseSlug` appears; `expected [ 55 ] to deeply equal [ 55, 56 ]` | clean |
| G16 | M16: always emit `"entityName"` | | `expected [ 'entityName' ] to deeply equal [ 'dbSetName', 'entityName' ]`; G13 `expected [] to deeply equal [ 23, 56 ]` | clean |
| G17 | M17a: swap the `file`/`line` keys | | array reorders: the `Services/…:15` row moves above `Data/…:18` | clean |
| G17 | M17b: `localeCompare` | | array reorders: `_Stale/Student.cs` moves to the front of the `Student` block | clean |
| G17 | M17c: drop the `via` key | | `expected [ 'entityName', 'dbSetName' ] to deeply equal [ 'dbSetName', 'entityName' ]` | clean |
| G17 | M17d: drop the `method` key | | `expected [ 'Zulu', 'Alpha' ] to deeply equal [ 'Alpha', 'Zulu' ]` | clean |
| G18 | M18: emit the DbSet property name as `entity` | | `expected false to be true` (`setNames.has(r.entity)`); `expected [ 'entityName' ] to deeply equal [ 'dbSetName', 'entityName' ]` | clean |
| G19 | M19: route matches through namespace-scope resolution | | `expected [] to deeply equal [ { entity: 'Student', …(5) } ]` — the `_Stale` ref disappears; `expected 12 to be 13`. In-scope refs unaffected: only that one row moves | clean |
| G20 | M20: `entityRefs: []` in the merge literal | | `expected [] to deeply equal [ { entity: 'Student', …(5) } ]` | clean |
| G21 | M21: remove the D-Hb-5 exclusion | | `expected [ { entity: 'Advisor', …(5) }, …(13) ] to deeply equal []` — `mini-efcore` yields 14 refs without it | clean |
| G22 | M22: remove `.default([])` | | `expected { state: 'done', loaded: +0, …(2) } to deeply equal { state: 'done', loaded: 1, …(2) }` — the repo goes `failed` | clean |
| G23 | M23: `EXTRACTOR_VERSION` back to 1 | | `expected 1 to be greater than 1` | clean |

Three extra key-deletion mutants were run to check the two sort keys the plan
does *not* single out. Both redden, so the comparator has no unreachable key:

| Key deleted | Failing assertion |
|---|---|
| `entity` | array reorders (Course/Student blocks interleave) |
| `file` | array reorders |
| `line` | `expected [ 56, 55 ] to deeply equal [ 55, 56 ]` |

### The two gates that did NOT redden first time

Reported under the plan's own rule rather than quietly fixed. Both are the
same defect, and it is **not** the one the plan warned about.

The plan's risk was "the fixture cannot produce an `entity+file+line` tie". The
fixture produced both required ties on the first attempt. **The ties were still
not enough.** The walker emits in source order and `Array.prototype.sort` is
stable, so a tie whose source order already equals its sorted order comes out
identical with the key and without it:

- **M17c (drop `via`) passed green.** `_db.Students.Add(new Student())` emits
  `Students` (dbSetName) before `Student` (entityName), which is already the
  comparator's order.
- **M17d (drop `method`) passed green.** Two methods on one line named `Left`
  then `Right` are already ascending.
- **M17b (`localeCompare`) passed green.** Every string in the fixture was
  ASCII with no case or punctuation divergence, so ICU and code-unit collation
  agreed on every pair.

Fixed in the fixture, not the comparator, at `b544419`: the tie is now written
**descending** in both places (`Student created = _db.Students.Add(...)`, and
`Zulu` before `Alpha`), and `Stale/` became `_Stale/` — `_` sorts after every
letter by code unit and before every letter under ICU, measured:
`"_Stale/Student.cs".localeCompare("Stale/Student.cs") === -1` while the
code-unit compare is `+1`. All three now redden.

**A tie is not a reachable sort key.** Recorded for the next phase.

---

## 2. The six measurement obligations

Every number below was produced by running something on this tree. None is
transcribed from the plan.

### Obligation 1 — ref counts, `via` split, controller yield

Command (scratch vitest file, deleted after the run — it names private-repo
paths and may not be committed):

```ts
const g = extractDotnet(repo.path);           // corpusRepo("repoA" | "repoB")
const byVia = ...; g.entityRefs.filter(r => r.via === ...)
const controllers = walk(repo.path, [".cs"])
  .filter(f => !/\/Migrations\//.test(f) && basename(f).endsWith("Controller.cs"));
```

| | repoA | repoB |
|---|---|---|
| `.cs` files, all | **101** | **39** |
| `.cs` files, non-Migrations (what extraction reads) | **84** | **28** |
| entities | **17** | **9** |
| **entityRefs** | **241** | **56** |
| `via: entityName` | **168** | **24** |
| `via: dbSetName` | **73** | **32** |
| `*Controller.cs` files | **10** | **3** |
| controllers with ≥ 1 ref | **6** | **1** |
| warnings | 0 | 0 |

**The plan's baseline is refuted on three of its four numbers.** Plan review
gave repoA as 232 refs, 161 `entityName` / 73 `dbSetName`, 5 of 10
controllers. Measured today: **241 / 168 / 73 / 6 of 10**. `dbSetName` is exact
at 73; `entityName` is +7 and the total +9; one more controller yields.

The plan's figures are also **internally inconsistent**: it states 232 refs and
a split of 161 + 73, which is 234 — the number it labels as the *with-the-fix*
count on the line above. So one of the two figures in that block was already
wrong before this phase ran.

I cannot distinguish "the live repo changed since 2026-09-14" from "plan review
measured differently" — the corpus repos are gitignored working copies, not
pinned. Both counts are reproducible on this tree at the commands above.
Nothing in the plan's *reasoning* turns on the difference: D-Hb-10 was demoted
on a +2/zero-controllers argument this measurement does not touch.

Two more plan figures did not reproduce: repoA's `.cs` count (plan: 109;
measured 101 total / 84 read) and repoB's (plan: 43; measured 39 / 28). The
controller counts, 10 and 3, reproduced exactly.

### Obligation 2 — `dbSetName` precision, hand-checked on a fixed sample

Sample: the **first 15** `dbSetName` refs of repoA's 73, in stored order, each
read back against its source line.

**As mentions of that entity — the clause D-Hb-14 actually delivers — 15 of 15
are true. False-positive rate 0/15 = 0%.** Consistent with plan review's 11/11.

But the sample surfaces something the plan does not record, and it is the more
useful half of this number. **The `.`-preceded rule matches a navigation
property exactly as readily as the DbSet**, because EF's convention gives them
the same name. Measured on repoA: **7 of the 16 DbSet names are also
navigation-property names on an entity** — 16, not 17: repoA has 17 entities
and one of them (the Identity-derived `User`) has `dbSetName: null`, so it has
no DbSet name to collide with. Corrected in review round 1; the overlap set
itself was right.

On **repoB the same overlap is 8 of 9** — `CreditLines`, `ExportHistory`,
`ImportHistory`, `InterestEntries`, `Payments`, `PayoffSimulations`,
`RefreshTokens`, `SavedColumnMappings`. Nearly every DbSet name in that repo is
also a navigation-property name, so the caveat below is not a repoA quirk; it
is the EF convention working as designed.

```
ApplicationDocuments  -> also LicenseApplication.ApplicationDocuments
Departments           -> also County.Departments
DocumentRequirements  -> also LicenseType.DocumentRequirements
LicenseApplications   -> also LicenseType.*, User.*
LicenseTypes          -> also Department.LicenseTypes
UserCounties          -> also County.*, User.*
UserLicenses          -> also LicenseType.*, User.*
```

**3 of the 15 sampled refs are navigation-property accesses, not DbSet
accesses** (`a.ApplicationDocuments`, `.Include(a => a.ApplicationDocuments)`,
`lt.DocumentRequirements`). Read as "a DbSet access", precision is 12/15 = 80%.
Read as "a mention of the entity", it is 15/15. The second is what psq claims.
Anyone who later narrows `via: "dbSetName"` to mean "went through the
DbContext" will be wrong about roughly a fifth of them.

### Obligation 3 — `entityName` precision, the D-Hb-13 cost

Criterion, the operational form of the plan's question: for each `entityName`
ref, resolve the matched name from the **referencing file's own** scope (its
namespace plus its usings), the way `dotnet.ts:resolveType` resolves it for the
context, and ask whether the winner is the entity's declaring file.

| | repoA | repoB |
|---|---|---|
| `entityName` refs | 168 | 24 |
| refs whose own file-scope resolves the name elsewhere | **0** | **0** |
| entity names with more than one declaration in the repo | **0** | **0** |
| **duplicate type names of any kind in the repo** | **0** | **0** |

**The measured cost of name-keying on the corpus is zero, because neither repo
declares any type name twice.** There is nothing for `resolveType` to
disambiguate and nothing for the walker to get wrong.

Two limits on that number, both real:

- It only sees types the repo declares in its own `.cs` files. A same-named
  type arriving from a NuGet package or a `global using` is invisible to this
  criterion, and the walker would report it.
- `resolveType`'s own doc comment says repoB has "a class under `Models/` and
  one under `Models/Entities/`" declaring the same name. **That is not true of
  repoB today** — 0 duplicate type names across its 28 read files. Either the
  repo was cleaned up or the comment was always about a different state. Not
  fixed here (out of this phase's files); recorded for whoever owns that
  comment.

So D-Hb-13 stays a stated imprecision with a gate (G19) and a measured cost of
**0 on today's corpus** — not "unmeasured", and not "harmless in general".

### Obligation 4 — extraction wall-clock, before and after

Five consecutive `extractDotnet` calls per condition, same process. "Before" is
the `collectEntityRefs` call removed from `dotnet.ts` entirely, so the token
walk does not run at all.

| | before (ms) | after (ms) |
|---|---|---|
| repoA (84 files, 17 entities) | 10, 9, 9, 8, 8 | 11, 9, 9, 9, 8 |
| repoB (28 files, 9 entities) | 3, 3, 3, 3, 2 | 3, 3, 3, 2, 2 |

**No measurable cost.** The difference is inside run-to-run noise. The walk is
a linear pass over tokens that lexing and structural parsing have already paid
for; the plan's worry ("touches every method in 109 files") does not show up.

### Obligation 5 — `mini-efcore-refs` fixture counts, pinned

| | measured |
|---|---|
| entities | **2** (`Course`, `Student`) |
| dbSetNames | `Courses`, `Students` |
| shapes | **0** |
| relations | **1** (`Student.CourseId->Course`) |
| warnings | **0** |
| **entityRefs** | **18** (13 before review round 1's three reachability additions) |

All six are now asserted in `entity-refs.test.ts` — in rev 2 only **five**
were: `relations` was claimed here and asserted nowhere (`grep -n relations
packages/extract/test/entity-refs.test.ts` was empty). Review round 1 caught
the overstatement; the assertion was added rather than the claim weakened.

`mini-efcore`'s own numbers **did not move**: 5 entities, 4 relations, 0
shapes, 0 warnings, and `entityRefs: []`. The plan flagged any movement there
as a finding about D-Hb-5; there was none.

### Obligation 6 — suite counts at every step

| Step | `pnpm test` | `PSQ_NO_CORPUS=1 pnpm test` |
|---|---|---|
| Baseline, before any edit | **421 passed (421)**, 33 files | **363 passed / 58 skipped (421)**, 30+3 files |
| After schema + wiring + version bump | — | 363 passed / 58 skipped (421) |
| Final, round 1 as reviewed | 440 passed (440) | 382 passed / 58 skipped (440) |
| **Final, after review round 1** | **444 passed (444)**, 34 files | **386 passed / 58 skipped (444)**, 31+3 files |

**Skipped held at 58 at every single run**, including all 31 mutant runs before
review and all 40 after. The private corpus config never went missing.

`pnpm typecheck` exits 0 across all four projects, final.

+23 tests: 18 in `entity-refs.test.ts`, 3 in `merge.test.ts` (G20), 2 in
`rehydrate.test.ts` (G22/G23).

---

## 3. Gates that could not be built

**One, found in review round 1: the `file` component of D-Hb-6's dedupe key.**
Deleting `ref.file` from the key leaves the whole hermetic suite green.
Collapsing on it needs two refs identical in entity, line, type, method and via
across two *different* files — i.e. two files declaring same-named types with
same-named methods mentioning the same entity at the same line number. That
needs a new fixture file, which is scope review round 1 did not open, so it is
recorded in the gate file and in Amendment 1 rather than built. The
comparator's `file` key is gated; only the dedupe component is not.

Every gate G1-G23 in the plan's table was built and every named mutant reddens
it.

G17's `via` and `method` keys were nearly the exception — see §1. The plan's
instruction was to delete them from the comparator rather than ship them
ungated. That was not necessary: the keys became observable once the fixture
wrote each tie in descending order, so both are gated and both stay.

Two things the plan listed as **recorded, not gated** stayed that way, and both
are genuinely unbuildable as gates here:

- **The `kind`-filter decision in D-Hb-3.** `KEYWORDS` is an exact lowercase
  set, so a `kind === "ident"` filter differs only for an entity literally
  named `record`/`get`/`set`/`where`/`global`/`partial`/`required`. No mutant
  could redden it without a fixture entity called `record`.
- **Constructor-body invisibility.** `parseCSharp` captures no constructor as a
  method, so there is no code path to mutate. The fixture's two contexts both
  have constructors; none contributes a ref, and that is visible in the pinned
  13-row array rather than asserted as a negative.

---

## 4. Where the plan was wrong

Each with the measurement.

1. **The repoA baseline (obligation 1).** 232 / 161 / 73 / 5-of-10 measured as
   **241 / 168 / 73 / 6-of-10**, and the plan's own split sums to 234 rather
   than the 232 it states one line above. Numbers only; no design decision in
   the plan rests on them.

2. **The `.cs` file counts.** "repoA (109 `.cs`, 10 controllers) and repoB (43
   `.cs`, 3)". Measured: repoA **101** total / **84** read, repoB **39** /
   **28**. Controller counts reproduced exactly.

3. **"The fixture **must** contain an `entity+file+line` tie so the `via` and
   `method` keys are reachable."** Measured false — a tie is necessary and not
   sufficient. Both ties existed and both keys were still dead, because a
   stable sort over an already-ascending tie is a no-op. §1 has the mutant
   evidence and the fix.

4. **`apps/web/src/lib/api.ts:126` "holds a hand-written duplicate
   `EntityGraph` interface … it will drift."** Read: it is not a duplicate and
   it has **already** drifted. It declares 8 of the schema's 11 pre-existing
   fields and omits `kind`, `shapes` and `routes`. `entityRefs` makes four
   omitted fields, not a first drift. Left alone — H-a2 owns it, and it is
   outside this plan's file list.

5. **`resolveType`'s doc comment about repoB's shadow copies** does not
   describe repoB today: 0 duplicate type names (obligation 3). Not in this
   phase's files; recorded, not fixed.

Everything else the plan measured held up, including the four facts it
corrected rev 1 on: string tokens do carry their delimiters (M14's three-way
red is the evidence), `KEYWORDS` is exact and lowercase, constructors are never
captured, and `store.test.ts:82` is inside the typecheck include —
`pnpm typecheck` enumerated exactly the **six** test literals the plan names
and no seventh.

---

## 5. Risks carried forward

- **The version bump re-extracts every stored repo on the next boot.** One
  time, user-visible as a slower first rehydrate. Gated by G23.
- **`via: "dbSetName"` does not mean "went through the DbContext", and this is
  the phase's largest soft spot.** EF names a navigation collection after the
  entity exactly as it names the DbSet, so the `.`-preceded rule cannot tell
  `db.Payments` from `creditLine.Payments`. Measured: **7 of repoA's 16** DbSet
  names and **8 of repoB's 9** are also navigation-property names, and 3 of a
  hand-checked 15-ref repoA sample are navigation accesses (~20%). The field is
  honest as a *match rule* and would be wrong as an *access kind*. On repoB,
  where the overlap is 8 of 9, anyone reading it as an access kind would be
  wrong far more often than on repoA.
- **Name-keying costs 0 on today's corpus and is not thereby safe.** Obligation
  3's criterion cannot see a same-named type from a package or a `global
  using`.
- **`entityRefs` is not surfaced anywhere a user can see it** except the raw
  `GET /api/repos/:id/graph`. `refsFor` and `GET .../refs` are H-b2.
- **`apps/server/package.json` still does not declare `zod`** — owed since
  G-b1, deliberately still owed, now examined a sixth time.
- **Not pushed.** master remains ahead of origin.

---

## 6. Review round 1 — what changed

Verdict was **Fix first** on two blocking items, both about `EntityRef.type`.
Every finding below was reproduced on this tree before anything was edited; all
eight did. Nothing was taken on the summary's word.

### B1 — the comparator was not total, and said it was

`compareEntityRefs` had five keys; `EntityRef` has six fields. `type` was
emitted and deduped on but never compared, so two refs differing only in
`type` tied completely and fell back to `Array.prototype.sort` stability.
The doc comment asserted "total over the emitted tuple" — a fresh unverified
because-clause, in the phase chartered to stop those.

Fixed by **inserting** `cmp(a.type, b.type)` between the `via` and `method`
keys, so the five approved keys keep their relative order and no pinned row
moves. D-Hb-7 amended in `plan.md`, Amendment 1.

The reviewer's suggested fixture edit — "a `Zulu()` on `CourseSlug` sharing
line 35" — **is not constructible as stated**: `CourseSlug`'s declaration
closes at line 11, twenty-four lines above `Zulu`. Two types can only share a
line by being written on one physical line. Built instead as a new pair,
`CourseAudit`/`CourseAdmin`, declared on one line at `CoursesController.cs:47`
and written descending.

### B2 — D-Hb-6's dedupe key was ungated, and not only on `type`

Reproduced: deleting `ref.type` from the key left the full hermetic suite green
at 382/58. Rather than gate only the component named, **all six components were
deleted in turn**. Two more were green:

| component | before | now |
|---|---|---|
| `entity` | **green** | red — `Both()` in `EnrollmentService`, two entities on one line |
| `file` | **green** | **still green — recorded, not gated** (§3) |
| `line` | red | red |
| `type` | **green** | red — the `CourseAudit`/`CourseAdmin` pair |
| `method` | red | red |
| `via` | red | red |

Deleting `type` from the key was **not** an option: two same-named methods on
two types on one line would collapse and lose a real fact.

### The added mutants

| Gate | Mutant | Failing assertion observed | Reverted |
|---|---|---|---|
| G17b (new) | B1: drop `cmp(a.type, b.type)` | `expected [ 'CourseAudit', 'CourseAdmin' ] to deeply equal [ 'CourseAdmin', 'CourseAudit' ]` | clean |
| D-Hb-6 `type` (new) | B2: drop `ref.type` from the dedupe key | `expected [ 'Sync' ] to deeply equal [ 'Sync', 'Sync' ]`; `expected 1 to be 2`; `expected 17 to be 18` | clean |
| D-Hb-6 `entity` (new) | drop `ref.entity` from the dedupe key | `expected [ 'Student' ] to deeply equal [ 'Course', 'Student' ]`; `expected 17 to be 18` | clean |
| D-Hb-6 `line` | drop `ref.line` | 4 failed | clean |
| D-Hb-6 `method` | drop `ref.method` | 3 failed | clean |
| D-Hb-6 `via` | drop `ref.via` | 6 failed | clean |
| D-Hb-6 `file` | drop `ref.file` | **0 failed — recorded, not gated** | clean |
| G7 second half (new) | N2: `decl.name === opts.contextDecl?.name` | `expected [] to deeply equal [ { entity: 'Course', …(5) } ]`; `expected 17 to be 18` | clean |
| comparator `type` | drop the key (same as B1) | see G17b | clean |

All 26 pre-review mutants were re-run against the changed comparator and
fixture. Every one still reddens; counts moved only because the fixture grew
from 13 refs to 18.

### Non-blocking, all reproduced

- **N1 — reproduced and fixed.** The `MINI_EFCORE_REFS` docblock had been
  inserted between the pre-existing primary-constructor docblock and its
  declaration, orphaning `MINI_EFCORE_PRIMARY_CTOR`. Moved below it; the
  H-b1 prose was also refreshed, since it named two ties where there are now
  three.
- **N2 — reproduced and gated**, rather than recorded. See above.
- **N3 — reproduced and recorded.** `prev.kind === "punct"` is inert: the
  lexer emits no bare `.` under any other kind (the `.` in `1.5` is part of the
  number token), and dropping the conjunct leaves the suite green. Kept with a
  comment putting it in D-Hb-3's "recorded, not gated" category.
- **N4 — reproduced and fixed by adding the assertion.** Obligation 5 claimed
  six pinned counts and `relations` was asserted nowhere. Five of six was the
  truth; it is six now.
- **N5 — reproduced, both halves.** Denominator corrected to 7 of **16**
  (repoA has one entity with `dbSetName: null`), and repoB measured at **8 of
  9** and carried into §5.
- **N6 — reproduced and relabelled.** `merge.test.ts`'s second G20 case was
  called "the positive control" while its own comment explained why it is not
  one; under M20 it stays green. Now labelled CHARACTERIZATION, as is the third
  case, which gates a path that would have to be *added* — rev 1's G9 mutant
  class.
- **N7 — recorded** in `progress.md`: G17's `localeCompare` gate is
  ICU-dependent by construction and self-invalidates if node's collation of
  `_` changes. Same property as H-a's H9c, which was accepted.

### The finding round 1 adds

**Rev 2 learned "a tie is not a reachable sort key" and then shipped a key with
no tie at all.** `type` was in the tuple and in the dedupe key, and the one
place it could have been compared said in a comment that it was. The mechanism
that caught it is the same one that caught G17: delete the thing and watch.
Applied to the comparator, rev 2 found three dead keys. It was never applied to
the **dedupe key**, and three of those six components were dead too.

**Probe every component of a composite, not the composite.** A key made of six
fields is six claims.
