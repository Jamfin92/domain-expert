# Phase H-b1 — entity references, C# side, extraction half — PLAN (rev 2)

Rev 1 was **rejected** by plan review. Rev 1 is kept at `plan-rev1-rejected.md`
with its defects listed at the bottom of this file. Every correction below was
**measured** before being written (H-a rule 3), and every measurement is
attributed.

Predecessor: `feature-research/h-entity-search/progress.md` (H-a, accepted
2026-09-14, tip `8de5fce`, tree clean, master **31 ahead** of origin).

## The spec, and what this phase honestly delivers

> search by entity partial match; select an entity; find the related methods
> and the lines that call it.

H-a shipped clauses 1-2. Clause 3 splits:

- **H-b1 (this phase)** — extraction. The graph learns, for every C# entity,
  the methods and lines that **mention** it. Visible immediately through the
  existing `GET /api/repos/:id/graph` (`app.ts:160-167`) — no new route needed.
- **H-b2 (next)** — the `refsFor` selector, `GET /api/repos/:id/refs`, and the
  expression-bodied-method parser fix (D-Hb-10, demoted on measurement — see
  below).

**"call" is not delivered, and the plan says so.** Plan review's B8 is
accepted: nothing in this design distinguishes a call site from a mention.
`Student s = null;`, `typeof(Student)`, `nameof(Student)` and an attribute
argument all become refs. **D-Hb-14** records the delivered clause as "the
lines that mention it". Narrowing to call sites needs argument-list and
receiver analysis and is not in H-b1 or H-b2; it is recorded as a possible
H-e. Rev 1 claimed the stronger clause while designing the weaker one.

## Why this must happen at extraction time

`MethodDecl.body` is a `Token[]` living on `FileParse` objects inside
`extractDotnet` and is garbage once it returns — the graph keeps no tokens. A
post-hoc `packages/graph` query is impossible. This forces the
`EXTRACTOR_VERSION` bump H-a predicted.

## Measured starting facts

Verified by plan review against the tree unless marked otherwise.

- `Entity.name` **is** the C# class name; `dbSetName` **is** the DbContext
  property name (`dotnet.ts:412`, sourced `:172-177`). Direct identity.
- Method bodies are consumed exactly once today: `dotnet.ts:191-192`,
  `decl.methods.find(m => m.name === "OnModelCreating")` →
  `entityConfigs(onModel.body)`. H-b1 is the second consumer, first over
  arbitrary methods. (`shapes.ts:49` also reads `decl.methods.length` — a
  count, not a body. Rev 1 called `dotnet.ts` the only consumer; that was
  scoped to one file and read as a stronger claim than it was.)
- `Token = {kind, text, start, line}` (`lex.ts:24-31`), `line` on every token;
  `FileParse.file` (`structure.ts:53`) is the only file identity, and it is
  **already repo-relative** (`dotnet.ts:270`, `repoRelative(repoRoot, f)`).
- `TokenKind = ident|keyword|number|string|char|punct` (`lex.ts:16-22`).
  Comments and `#` directives are dropped, never tokens (`lex.ts:105-108`).
- **String tokens carry their delimiters** — `push("string", src.slice(start,
  k), start)` with `start` at the prefix (`lex.ts:133,157,212`). Measured:
  `var a = "Student";` → `string:"Student"`. So a `text === "Student"` compare
  can never match a string literal. **This is structural, not implemented.**
- **`KEYWORDS` is an all-lowercase `Set`, matched exactly** (`lex.ts:33-46`,
  `:253`). Measured: `class Record {}` → `ident:Record`; `class record {}` →
  `keyword:record`. There is no case-sensitivity question. Rev 1 posed one.
- `>>` lexes as one punct token, breaking `matchBracket` on nested generics
  (`structure.ts:68-83`). The walker consumes bodies **produced by**
  `matchBracket` at `structure.ts:321` and calls it nowhere itself — immunity
  is **inherited, not intrinsic** (rev 1 overclaimed). `{`/`}` matching is
  unaffected by `>>`.
- **Constructors are never captured as methods at all.** Measured:
  `parseCSharp("public C(int x) { Foo(); }")` → `methods: []`. References in
  constructor bodies are therefore invisible. A coverage hole to record
  alongside `#if` and interpolation — **not** a design choice, as rev 1's
  D-Hb-4 implied.
- `EntityGraph` is a bare `z.object`, 11 required fields
  (`schema/src/index.ts:294-317`). Constructed by explicit field listing, no
  spreads, at **five production sites**: `detect.ts:113`, `dotnet.ts:292`,
  `dotnet.ts:626`, `node.ts:222`, `merge.ts:198`. (Rev 1's prose said four
  and then listed five.)
- Typed `EntityGraph` literals also exist in **six** test files — see "Files
  touched" item 16. Rev 1 listed four and missed
  `apps/server/test/store.test.ts:82`, which **is** inside the typecheck
  include.
- `z.array(X).default([])` confirmed against the installed **zod 3.25.76**:
  fills through the nested `StoredRepo` wrapper at runtime, and the `z.infer`
  **output** type makes the field required (a `@ts-expect-error` on omission
  was consumed under the repo's own `tsc`).
- `EXTRACTOR_VERSION = 1` (`detect.ts:60`), compared at `workspace.ts:265`;
  mismatch → full re-extraction. `digestOf` hashes only the **target repo's**
  files (`files.ts:118-134`), so nothing else notices an extractor change.
- A stored envelope missing a **required** field fails `StoredRepo.safeParse`
  (`store.ts:164-167`) → repo `failed`, kept, not loaded
  (`workspace.ts:212-219`).
- **`dotnet.ts:630-632` sorts with `localeCompare`**, immediately adjacent to
  where the new sort lands. D-Hb-7 forbids it. Do not copy the neighbour.
- `test/fixtures/mini-efcore/` — 7 `.cs` files, zero controllers, no
  expression-bodied *method*. **Confirmed it yields `entityRefs: []` under
  D-Hb-5**: its only non-`OnModelCreating` entity mentions are
  expression-bodied *properties* (`MiniDbContext.cs:16-17`) and nav
  properties, both out under D-Hb-4, and its constructor is not captured.
- `Models/Student.cs` is excluded by **namespace-scope resolution**
  (`dotnet.ts:218-221`), not by path — and it is the canonical same-name
  collision case. See D-Hb-13.
- **`packages/extract/src/node/refs.ts:78-79` documents name-keying as
  invalid**: "Index by declaration NODE, never by name: a name-keyed lookup
  invents edges between same-named locals in different files or scopes."
  D-Hb-3 is name-keyed. This is confronted in D-Hb-13, not hidden.
- Corpus C# ground truth exists only in repoA (109 `.cs`, 10 controllers) and
  repoB (43 `.cs`, 3). repoC/D/E have zero `.cs`.
- `apps/server/test/rehydrate.test.ts:288` is **case 3 of a six-case failure
  test** pinned to `{loaded:3, failed:3, missing:1}` at `:305-307` — not a
  general write-and-read-back harness, as rev 1 described it. G22/G23 must be
  **new `it()` blocks** or those counters move.
- `apps/web/src/lib/api.ts:126` holds a hand-written duplicate `EntityGraph`
  interface. Structurally independent (no typecheck break), but it will drift.
  Surfaces are H-a2; record it.

### Measurement that changed the plan

Plan review simulated the D-Hb-3 walker over repoA, with and without the
expression-bodied-method fix:

```
refs without the fix: 232
refs with    the fix: 234   (+2, both Services/FormTemplateAdminService.cs)
by via: { entityName: 161, dbSetName: 73 }
controllers with >=1 ref: 5 of 10
```

**Zero** added refs are in a controller; repoA's expression-bodied controller
methods are all `GetUserId` helpers referencing no entity. Rev 1's claim —
"the canonical terse controller action … invisible *and silent*" — is **false
at 0.85% and zero controller yield**. D-Hb-10 is therefore **demoted to
H-b2**, carrying its own before/after number. `dbSetName` precision on repoA
sampled **11/11** true positives.

## Design decisions

- **D-Hb-1** — a new top-level graph field `entityRefs: EntityRef[]`. `Entity`
  untouched.
- **D-Hb-2** — `EntityRef` mirrors the `Route`/`ClientCall` idiom:
  `{entity, file, line, type, method, via}`, `via` ∈
  `"entityName" | "dbSetName"`. `method` is **not** nullable — nothing outside
  a method body is emitted, so a nullable field would be unreachable code.
- **D-Hb-3** — two rules, exact token-**text** equality:
  `entityName` (text === `Entity.name`) and `dbSetName` (text ===
  `Entity.dbSetName`, **immediately preceded by a `.` punct token**). Never
  substring — a deliberate contrast with H-a's human-facing substring search.
  Matching reads `token.text` and applies **no `kind` filter**. That is
  **recorded, not gated**: with `KEYWORDS` measured as an exact lowercase set,
  a `kind === "ident"` filter would only differ for an entity literally named
  `record`/`get`/`set`/`init`/`where`/`global`/`partial`/`required`, which the
  fixture will not contain. Rev 1 built gate G17 on a case-sensitivity
  question that does not exist — the `isFramework`/H10 pattern exactly.
- **D-Hb-4** — only method bodies are scanned. Property and field
  declarations and base lists are out **by design** (relations already model
  them). **Constructor bodies are out by accident** — `parseCSharp` never
  captures constructors. Recorded as a coverage hole, gated by G6's control.
- **D-Hb-5** — `OnModelCreating` on the detected context is excluded; already
  consumed by `entityConfigs` and modelled as relations/keys/indexes.
  Supporting measurement: **no `OnModelCreating` anywhere is expression-bodied**
  (repoA `Data/AppDbContext.cs:30`, repoB `Data/DebtTrackerDbContext.cs:21`,
  all three .NET fixtures), so H-b2's D-Hb-10 cannot later change what
  `entityConfigs` sees.
- **D-Hb-6** — dedupe on `entity|file|line|type|method|via`.
- **D-Hb-7** — stored sorted, `entity → file → line → via → method`,
  **code-unit comparisons only, never `localeCompare`**. The fixture **must**
  contain an `entity+file+line` tie so the `via` and `method` keys are
  reachable; otherwise they are unreachable branches and must be deleted
  rather than written (the D-Ha-5.5 objection, applied to our own design).
- **D-Hb-12** — `entityRefs: z.array(EntityRef).default([])`: old envelopes
  parse and yield `[]`; the inferred **output** type is required so `tsc`
  enumerates every construction site. Paired with `EXTRACTOR_VERSION` 1→2 so
  old graphs re-extract rather than serving `[]` forever. Either half alone is
  a defect.
- **D-Hb-13 — the walker is name-keyed, and that is a stated imprecision.**
  It does not route through `resolveTypeInScope` (`dotnet.ts:210-229`), the
  function that exists only to defeat same-name-different-namespace
  collisions. So a mention of a same-named class in an unrelated namespace is
  reported as a ref to the entity. This repo's own `node/refs.ts:78-79` calls
  name-keying invalid. It is accepted here because the C# side has no symbol
  table and the alternative is H-c-scale work — but it is **gated (G19) so the
  behaviour is visible, and measured (obligation 3), never claimed to be
  precise.** `EntityRef` carries no `FactSource`, so the graph cannot label it.
- **D-Hb-14** — the delivered clause is "the lines that **mention** it".
  See the top of this file.

## Scope

**In:** the schema type; the walker; wiring through all five graph sites plus
merge; the version bump; the new fixture; gates G1-G23.

**Out, recorded:** `refsFor` + `GET /api/repos/:id/refs` + **D-Hb-10** (all
H-b2); the TS side (H-c); CLI/web surfaces (H-a2); a "controllers present but
zero refs" warning (H-d — needs its own third fixture); call-vs-mention
narrowing (possible H-e); `isFramework`; `apps/server/package.json` still does
not declare `zod` (owed since G-b1, now examined five times); **pushing** —
master is 31 ahead, James's standing call since phase E.

## Files touched

Production:
1. `packages/schema/src/index.ts` — `RefVia`, `EntityRef` (+ `z.infer`
   aliases); `entityRefs` on `EntityGraph`.
2. `packages/extract/src/csharp/entity-refs.ts` — **new**, the linear token
   walker. Named to avoid collision with the unrelated `src/node/refs.ts`.
3. `packages/extract/src/dotnet.ts` — walk `parse.types[].methods[]`, dedupe,
   sort (**not** with the `localeCompare` at `:630-632`), attach at `:292`
   and `:626`.
4. `packages/extract/src/node.ts` — `entityRefs: []` (`:222`).
5. `packages/extract/src/detect.ts` — `entityRefs: []` (`:113`);
   `EXTRACTOR_VERSION` 1 → 2 (`:60`).
6. `packages/extract/src/merge.ts` — thread `entityRefs` (`:198`).

Fixture and gates:
7. `test/fixtures/mini-efcore-refs/**` — **new**, self-contained.
8. `test/fixtures.ts` — export `MINI_EFCORE_REFS`.
9. `packages/extract/test/entity-refs.test.ts` — **new**, G1-G19, G21.
10. `packages/extract/test/merge.test.ts` — G20.
11. `apps/server/test/rehydrate.test.ts` — G22/G23 as **new `it()` blocks**,
    leaving the six-case counters at `:305-307` untouched.
12-16. `entityRefs: []` added to typed graph literals — `merge.test.ts:14`,
    `packages/graph/test/layout3d.test.ts:48`, `test/client-mcq.test.ts:33`,
    `test/shape-label.test.ts:33`, `test/component-label.test.ts:23`,
    **`apps/server/test/store.test.ts:82`**. Let `pnpm typecheck` enumerate
    these; do not hunt them by hand.

Docs: `feature-research/h-entity-refs-csharp/{plan,audit,progress}.md`.

## The fixture, `mini-efcore-refs`

Self-contained and namespace-consistent so `resolveTypeInScope` resolves.
Every negative gate below has a positive control **in the same graph**:

- `Data/RefsDbContext.cs` — `DbSet<Student> Students`, `DbSet<Course> Courses`;
  an `OnModelCreating` referencing both (feeds G7/G21); **one ordinary method
  referencing an entity** (the positive control for G7).
- `Models/Student.cs`, `Models/Course.cs` — entities; one carries a nav
  property typed `Course` (feeds G6).
- `Controllers/StudentsController.cs` — `Student` twice on one line and twice
  across two lines (G10/G11); `Student` inside a plain string **and** inside an
  interpolated string (G14's control); a `StudentDto` mention (G14); a local
  `student` (G12); a local named `Students` with no leading `.` (G13);
  **two different vias on one line** to make D-Hb-7's `via` key reachable (G17).
- `Controllers/CoursesController.cs` — a reference to a non-entity helper
  class (G15); a **second method on the same line-number-tie** to make the
  `method` sort key reachable (G17).
- `Services/EnrollmentService.cs` — a non-controller class with refs, proving
  the walker is not controller-scoped.
- `Stale/Student.cs` — a same-named class in an **out-of-scope namespace**,
  mentioned in a method there (feeds **G19**, D-Hb-13).

Entity/shape/warning counts for this fixture are **measured and pinned in the
audit**, never assumed.

## Gate table — walked from the spec

Rule 1: every plan-specified **behaviour** needs a named mutant, not every
gate. Behaviours may share one whole-object `toEqual` (rule 4); each still
owns a mutant, and each mutant must be demonstrated red.

### "find …" — the graph carries the answer

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G1 | `extractDotnet` populates `entityRefs` | whole-array `toEqual` on `mini-efcore-refs` | M1: walker returns `[]` | — (positive gate) |

### "… the related methods" — each result names a method

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G2 | ref carries the enclosing method name | in G1's `toEqual` | M2: emit `method: ""` | — |
| G3 | ref carries the enclosing type name | in G1's `toEqual` | M3: emit `type: ""` | — |
| G4 | the walker is not controller-scoped | `EnrollmentService` refs present | M4: skip types not named `*Controller` | controller refs still present |
| G5 | *(merged into G2/G3)* | — | — | — |
| G6 | a mention outside any method body emits nothing (nav property) | no ref on the nav-property line | M6: also walk property/field declarations | the same entity mentioned inside a method IS present |
| G7 | `OnModelCreating` on the context contributes nothing | no ref with `method: "OnModelCreating"` | M7: remove the D-Hb-5 exclusion | a different method on the **same** context class does contribute |

### "… and the lines" — each result names a line

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G8 | `line` is the 1-based line of the **matched token** | exact line numbers pinned to fixture source | M8a: `token.line - 1`; M8b: use `decl.line` (the method's line) | — |
| G9 | `file` is the **referencing** file | in G1's `toEqual` | M9: emit the entity's **declaring** file (`Entity.file`) | — |
| G10 | two mentions on **different** lines → two refs | ordered `toEqual` | M10: dedupe ignoring `line` | pairs with G11 |
| G11 | two mentions on the **same** line → one ref | ordered `toEqual` | M11: no dedupe at all | pairs with G10 — the two-line case must still yield two |

> G9's mutant is chosen because `parse.file` is already repo-relative
> (`dotnet.ts:270`); rev 1's "emit an absolute path" mutant had to *add* code
> and so gated no decision the implementation actually makes.

### "… that mention it" — the match is to *that* entity

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G12 | exact-text match, case-sensitive | local `student` yields no ref | M12: case-insensitive equality | `Student` in the same method does match |
| G13 | `dbSetName` requires a preceding `.` | local named `Students` yields no ref | M13: drop the `.` requirement | `_db.Students` in the same method does match |
| G14 | equality, not substring — which is **also** what keeps string literals out | `StudentDto` yields no ref; neither does `"Student"` nor `$"{Student}"` | M14: `.includes()` instead of `===` — reddens all three | exact `Student` in the same method does match |
| G15 | non-entity class names yield nothing | helper class yields no ref | M15: match any name in `byName` | an entity in the same method does match |
| G16 | `via` is `"entityName"` for a bare match | in G1's `toEqual` | M16: always emit `"entityName"`, even for `.`-preceded DbSet matches | G13's `_db.Students` carries `"dbSetName"` |
| G17 | order is deterministic, code-unit only, and the `via`/`method` keys are **reachable** | assert the **full ordered array**; fixture contains an `entity+file+line` tie | M17a: swap `file`/`line`; M17b: `localeCompare`; M17c: drop the `via` key | — |
| G18 | `ref.entity` is `Entity.name` and resolves in `graph.entities` | every ref's entity resolves | M18: emit the DbSet property name for `dbSetName` matches | — |
| G19 | **D-Hb-13** — a same-named class in an out-of-scope namespace IS reported (stated imprecision, made visible) | `Stale/Student.cs`'s mention appears as a `Student` ref | M19: route matches through `resolveTypeInScope` — the ref disappears | in-scope refs unaffected |

> Rev 1's G16 (string literals) and G17 (contextual keywords) are **deleted**.
> Measured: string tokens carry delimiters (`lex.ts:133,157,212`) and
> `KEYWORDS` is an exact lowercase set (`lex.ts:33-46,253`), so neither had a
> mutant that could redden it. String-literal immunity is now covered by M14,
> which genuinely reddens it; keyword-kind immunity is recorded in D-Hb-3.

> G17's `localeCompare` mutant is not hypothetical: `dotnet.ts:630-632` uses
> it four lines from where this sort lands.

### The answer must survive storage and the fullstack path

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G20 | `mergeGraphs` carries `entityRefs` from the .NET side | `merge.test.ts` unit, hand-built inputs (existing precedent at `:14`) | M20: drop the field from the merge literal at `:198` | — |
| G21 | a repo whose only mentions are in `OnModelCreating` yields `[]` | `mini-efcore` → `entityRefs: []` | M21: remove the D-Hb-5 exclusion | `mini-efcore-refs` is non-empty **in the same suite run** |
| G22 | an envelope written **without** `entityRefs`, at `extractor: 2`, with an **intact fingerprint**, loads and yields `[]` | new `it()`; repo is **`mini-efcore-refs`** | M22: remove `.default([])` → repo goes `failed` | the same repo **re-extracted** yields non-empty — proving the `[]` came from the default, not from a fresh extraction |
| G23 | an envelope at `extractor: 1` re-extracts | extraction call counter fires | M23: revert `EXTRACTOR_VERSION` to 1 | an envelope at `extractor: 2` does **not** re-extract |

> G22's pinning is the whole gate. Rev 1 left the fixture and `extractor`
> value unspecified; at `extractor: 1` the `[]` comes from re-extraction, and
> on `mini-efcore` a fresh extraction yields `[]` too (that is G21) — so the
> gate would have passed with `.default([])` deleted. That is H-a round 1's
> "negative gate with no positive control", reproduced.

**Recorded, not gated:** the `kind`-filter decision in D-Hb-3 (no reachable
difference); constructor-body invisibility (`parseCSharp` captures no
constructors); `#if` blocks dropped at `lex.ts:105-108`; interpolation holes
opaque inside one string token; `apps/web/src/lib/api.ts:126`'s duplicate
interface drifting.

## Measurement obligations (audit, not gates)

Numbers produced by running, never asserted from this plan:
1. `entityRefs` count for repoA and repoB; split by `via`; how many of repoA's
   10 controllers produce ≥1 ref. **Plan review's baseline to reproduce or
   refute: repoA = 232 refs, 161 `entityName` / 73 `dbSetName`, 5 of 10
   controllers.** A different number is a finding, not a typo to fix.
2. `dbSetName` precision — hand-check a fixed sample on repoA, report the
   false-positive rate as a number. (Plan review sampled 11/11 true.)
3. **`entityName` precision — the D-Hb-13 obligation.** How many repoA
   `entityName` matches resolve to a class in a namespace the entity's context
   does not import? Report as a number. This is the name-keying cost, and it
   has never been measured.
4. Extraction wall-clock on repoA before and after (the walker touches every
   method in 109 files).
5. Fixture counts for `mini-efcore-refs` — entities, shapes, warnings — pinned.
6. Suite counts at every step. Baseline **421 passed / 363+58 skipped**.
   **A skipped count below 58 means the private corpus config vanished** —
   stop; do not "fix" the number.

## Risks

- **The version bump re-extracts every stored repo on next boot.** One-time,
  user-visible. Call it out in `progress.md`.
- **Name-keying (D-Hb-13)** — both vias. `dbSetName` is mitigated by the `.`
  requirement and sampled clean; **`entityName` is not mitigated at all** and
  is 161 of repoA's 232 refs. Obligation 3 exists to put a number on it.
  Rev 1's risk list omitted this half entirely.
- **`entityRefs` required in the output type produces a wide typecheck diff.**
  Intended — `tsc` enumerates the sites.
- **`mini-efcore` assertions must not move.** If any do, that is a finding
  about D-Hb-5 or the fixture split, not a number to adjust.
- **G17 needs a real tie in the fixture.** If the fixture cannot produce one,
  the `via`/`method` sort keys are unreachable and must be **deleted from the
  comparator**, not written and left ungated.

## What rev 1 got wrong (kept so the next phase can see the pattern)

1. G16 and G17 were gates **no mutant could redden** — one because string
   tokens carry delimiters, one because `KEYWORDS` is an exact lowercase set.
   Both were "test ideas" that survived because nobody measured the mechanism.
2. G24 (now G22) was a **negative gate with no positive control**, pinned to
   neither fixture nor version — H-a round 1's defect, repeated.
3. **D-Hb-10's because-clause was false.** "The canonical terse controller
   action" is worth +2 refs and zero controllers on the only corpus repo with
   controllers. The phase was about to touch a shared parser for 0.85%.
4. The prescribed parser fix would have **shipped a truncation bug** — copying
   `structure.ts:337`'s undepth-tracked scan to `;` while citing the
   depth-tracking property path four lines below as precedent.
5. **"Files touched" was short one typechecked file** (`store.test.ts:82`),
   and said "4 production sites" above a list of five.
6. The spec word **"call" had no gate** — and no design decision either.
7. `rehydrate.test.ts:288` was **described as something it is not**.

Items 1, 2 and 3 are the same failure H-a's `progress.md` records: a table
built from test ideas rather than from the mechanism, and a correction that
carried no evidence. It recurred in the first plan written after that record
was filed.

---

# Amendment 1 — review round 1 (2026-09-16)

Rev 2 was approved and built. Review round 1 came back **Fix first** on two
blocking items, both about `EntityRef.type`. This amendment records the design
change; the measurements behind it are in `audit.md` §6.

## D-Hb-7 is amended: five sort keys become six

**As approved:** `entity → file → line → via → method`, described in the
implementation as "total over the emitted tuple".

**That description was false.** `type` is emitted (it is one of `EntityRef`'s
six fields) and is part of D-Hb-6's dedupe key, but it was not a comparator
key. Two refs differing only in `type` therefore survived dedupe, tied on all
five keys, and fell through to `Array.prototype.sort`'s stability — i.e. to
whatever order the walker happened to emit them in. Measured: deleting
`cmp(a.type, b.type)` from the comparator today reddens two assertions; before
this amendment there was nothing to delete.

**Amended to:** `entity → file → line → via → type → method`. `type` is
**inserted, not appended**, so the relative order of the five approved keys is
unchanged and no previously-pinned row moves. The comparator is now genuinely
total over the emitted tuple, and its key set is exactly D-Hb-6's dedupe key.

## D-Hb-6 gains gates it never had

The dedupe key was specified as `entity|file|line|type|method|via` and, under
rule 1, each component is a plan-specified behaviour needing a named mutant.
Rev 2 shipped none. Measured by deleting each component in turn:

Each row is that one component deleted from the key, suite re-run:

| component deleted | before round 1 | now |
|---|---|---|
| `entity` | green — ungated | red — gated in round 1 |
| `file` | green — ungated | red — gated in round 2 |
| `line` | red | red |
| `type` | green — ungated | red — gated in round 1 |
| `method` | red | red |
| `via` | red | red |

**All six are gated.** Round 1 wrote `file` off as needing a new fixture file.
**That was asserted, not measured, and review round 2 disproved it** by
building the gate in two files the phase already edits: a `Dup` class with a
`Sync()` method naming `Course`, declared at the *same line number* in both
`Controllers/CoursesController.cs` and `Services/EnrollmentService.cs`. The
pair ties on entity, line, type, method and via, so only `file` separates it;
deleting `ref.file` from the key drops the graph from 20 refs to 19.

That coincidence of line numbers is load-bearing and nothing in C# enforces
it, so the gate file also reads both source lines and asserts the declaration
is where it must be. A gate whose precondition can silently evaporate needs a
gate on the precondition.

## Fixture additions, all three for reachability only

- `Controllers/CoursesController.cs` — `CourseAudit`/`CourseAdmin`, two TYPES
  on one physical line with same-named methods. The only tie in the fixture on
  everything but `type`. Written descending, for the reason rev 2 already
  learned.
- `Services/EnrollmentService.cs` — `Both()`, two different entities on one
  physical line. The only tie on everything but `entity`.
- `Controllers/CoursesController.cs` **and** `Services/EnrollmentService.cs` —
  `Dup.Sync` at the same line number in both (added in review round 2). The
  only tie on everything but `file`.
- `_Stale/Student.cs` — a gutted class sharing the detected context's **name**
  with its own `OnModelCreating`, and no `DbContext` base. D-Hb-5 compares the
  declaration by object identity, and rev 2 asserted nothing that could tell
  identity from name: rewriting the comparison to `decl.name ===
  opts.contextDecl?.name` left the whole suite green. It now reddens.

## Unchanged

Every other decision, the scope cut, and the "Out, recorded" list stand as
approved. `apps/server/package.json` still does not declare `zod`. Nothing was
pushed.
