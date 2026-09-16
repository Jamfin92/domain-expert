# Phase H-b — entity references, C# side — PLAN (rev 1)

Predecessor: `feature-research/h-entity-search/progress.md` (H-a, accepted
2026-09-14, tip `8de5fce`, tree clean, master **31 ahead** of origin).

## The spec

H's requirement, in full:

> search by entity partial match; select an entity; find the related methods
> and the lines that call it.

H-a shipped clauses 1 and 2. **H-b owns clause 3, C# only.** The gate table
below is derived by walking that clause, not by listing test ideas — the one
process change H-a paid three review rounds for.

## Why this must happen at extraction time (not as a graph query)

`MethodDecl.body` is a `Token[]` that lives on the `FileParse` objects inside
`extractDotnet` and **is garbage after that function returns** — the graph
keeps no token data. So a post-hoc `packages/graph` query is impossible; the
references must be computed during extraction and stored on the graph. This
forces the `EXTRACTOR_VERSION` bump H-a predicted.

## Measured starting facts (all verified this session, cited)

- `Entity.name` **is** the C# class name; `dbSetName` **is** the DbContext
  property name (`dotnet.ts:412`, sourced `dotnet.ts:172-177`). Direct
  identity, no bridge. This is what makes the C# half cheap.
- Method bodies are consumed in the .NET path **exactly once today**:
  `dotnet.ts:191-192`, `decl.methods.find(m => m.name === "OnModelCreating")`
  → `entityConfigs(onModel.body)`. That is the precedent idiom. H-b is the
  **second** consumer and the first over arbitrary methods.
- `grep '\.methods' dotnet.ts` → one match. Controllers are parsed into
  `FileParse`/`TypeDecl` (including full body tokens) and **never read**.
- `Token = {kind, text, start, line}` (`lex.ts:24-31`); `line` is carried on
  every token. `FileParse.file` (`structure.ts:53`) is the only file identity.
  `(file, token.line)` is therefore recoverable for any body token.
- **Expression-bodied methods yield `body: []`** (`structure.ts:336-341`); the
  RHS is walked with `k++` and discarded, retained nowhere. Expression-bodied
  *properties* by contrast capture into `initializer` (`structure.ts:384-408`).
  The asymmetry looks like an oversight, not a design choice.
- `TokenKind = ident | keyword | number | string | char | punct`
  (`lex.ts:16-22`). Comments and `#` directives are dropped, never tokens.
- **String literals are ONE opaque token, interpolation holes included**
  (`lex.ts:178-211`). `$"{user.Name}"` exposes no inner tokens. So "no match
  inside a string" is structural, not something we implement — but it is still
  a plan-specified behaviour and still gets a mutant.
- `.` is its own `punct` token; `>>` lexes as a single 2-char punct, which
  breaks `matchBracket` on nested generics (`structure.ts:68-83` compares
  `t === ">"`). **The walker is therefore a linear scan and calls
  `matchBracket` nowhere** — immune by construction.
- `EntityGraph` is a bare `z.object` (`schema/src/index.ts:294`), 11 required
  fields, no optionals. Built by **explicit field listing at 4 production
  sites**: `detect.ts:112-127`, `dotnet.ts:292`, `dotnet.ts:626`,
  `node.ts:222`, plus `merge.ts:197-209`. **No spreads anywhere** — a new
  field is silently dropped unless threaded through each.
- `EXTRACTOR_VERSION = 1` (`detect.ts:60`), compared at `workspace.ts:265`;
  a mismatch sets `reExtract = true` → full re-extraction, not an error.
- `digestOf` hashes only the **target repo's** files (`files.ts:118-134`) —
  it will never notice that psq's own extractor changed. Only the version bump
  will.
- A stored envelope missing a **required** field fails `StoredRepo.safeParse`
  (`store.ts:164-167`) → repo marked `failed`, file kept, not loaded
  (`workspace.ts:212-219`). An **optional/defaulted** one parses.
- `test/fixtures/mini-efcore/` is 7 `.cs` files, **zero controllers**, and
  **no expression-bodied method** (only two expression-bodied properties and
  17 lambda arrows). It cannot gate this feature as-is.
- Sibling fixtures `mini-efcore-empty-context` and `mini-efcore-primary-ctor`
  already exist — adding a sibling is the established idiom.
- `Models/Student.cs` is excluded by **namespace-scope resolution**
  (`dotnet.ts:218-221`), not by path. Any new fixture must respect that.
- Corpus C# ground truth exists only in **repoA (109 `.cs`, 10 controllers)**
  and **repoB (43 `.cs`, 3 controllers)**. repoC/D/E have zero `.cs`.
- `apps/server/test/rehydrate.test.ts` already writes a stored envelope and
  reads it back through a second `Workspace` (pattern at line 288) — the
  envelope gates below are buildable on existing machinery.
- Route precedent `app.ts:182-194`: repo lookup → 404 first, then param
  validation → 400 (D-Ha-10). Responses are **not** zod-validated on the way
  out.

## Design decisions

- **D-Hb-1 — a new top-level graph field `entityRefs: EntityRef[]`.** Not a
  field on `Entity` (keeps `Entity` untouched, as H-a kept `EntityGraph`
  untouched) and not a separate store.
- **D-Hb-2 — `EntityRef` mirrors the `Route`/`ClientCall` idiom**, a flat
  `{file, line}` plus identifying fields:
  `{entity, file, line, type, method, via}` where `via` is
  `"entityName" | "dbSetName"`. `type`/`method` are the enclosing class and
  method names. `method` is **not** nullable — see D-Hb-4, nothing outside a
  method body is ever emitted, so a nullable field would be unreachable code
  (H-a's D-Ha-5.5 lesson: do not write branches the design cannot reach).
- **D-Hb-3 — two match rules, both exact-token-text equality:**
  - `via: "entityName"` — a token whose **text** equals `Entity.name`.
  - `via: "dbSetName"` — a token whose text equals `Entity.dbSetName`
    (when non-null) **immediately preceded by a `.` punct token**.
  Matching is on `text`, deliberately **not** gated on `kind === "ident"`
  (see M-1 below). Exact equality, never substring — a deliberate contrast
  with H-a's substring search, because that layer is a human-facing search
  and this one is a code reference.
- **D-Hb-4 — only method bodies are scanned.** Property declarations, field
  declarations, constructor signatures and base lists are out. A navigation
  property `public Student Student {get;set;}` is a *schema* fact the graph
  already models via `relations`; re-reporting it as a "reference" would
  double-count the thing H-a already answers.
- **D-Hb-5 — `OnModelCreating` on the detected DbContext is excluded.** Its
  body is already consumed by `entityConfigs` and modelled as `relations`/
  `indexes`/`keys`. Including it would attach a ref to every entity in every
  repo — pure noise against the motivating question ("related *operations*").
  Gated both ways (G7 + G22).
- **D-Hb-6 — dedupe on the whole tuple** `entity|file|line|type|method|via`.
  Two references on one line collapse; two on different lines do not. "the
  lines that call it" is a set of lines, not a count of mentions.
- **D-Hb-7 — a deterministic, explicitly not-total order**, stored sorted:
  `entity → file → line → via → method`. **Code-unit comparisons only, never
  `localeCompare`** (D-Ha-5 carried forward verbatim). Not claimed total.
- **D-Hb-8 — the response reports what was scanned** (`vias: [...REF_VIAS]`),
  derived not hardcoded, mirroring D-Ha-8.
- **D-Hb-9 — unknown entity is a 404; known entity with no references is a
  200 with `refs: []`.** "I have never heard of this entity" and "this entity
  is referenced nowhere" are different answers. Conflating them is precisely
  the .NET-route blind spot this project keeps re-learning: silence reading as
  "nothing here" rather than "I did not look".
- **D-Hb-10 — fix the expression-bodied method blind spot**
  (`structure.ts:336-341`), gated independently (G19/G20) so it can be
  reverted alone. `=> _context.Users.Find(id)` is the canonical terse
  controller action; shipping H-b without this means the highest-yield shape
  is invisible *and silent*. The fix captures the tokens between `=>` and `;`
  into `body`, leaving `name`/`line`/`modifiers` unchanged.
- **D-Hb-11 — a new sibling fixture `mini-efcore-refs`**, not an extension of
  `mini-efcore`. Adding controllers to `mini-efcore` would move its shape and
  warning counts and disturb H-a's assertions. `mini-efcore` instead becomes a
  **negative gate with a positive control** (G22).
- **D-Hb-12 — `entityRefs` is `z.array(EntityRef).default([])`.** Defaulted,
  so old stored envelopes parse and yield `[]` instead of failing the repo;
  **required in the inferred output type**, so `tsc --noEmit` enumerates every
  construction site rather than letting one drop silently. Paired with the
  `EXTRACTOR_VERSION` 1→2 bump so old graphs re-extract rather than serving
  `[]` forever. Both halves are needed; either alone is a defect.

## Scope

**In:** schema type; the walker; the `structure.ts` fix; wiring through all
graph construction + merge sites; version bump; a `refsFor` selector;
`GET /api/repos/:id/refs`; the new fixture; the gates below.

**Out, recorded deliberately:**
- **The TypeScript side — H-c.** Untouched.
- **CLI and web surfaces — H-a2.** Including the `repoArg()` trap H-a found.
- **A "controllers present but zero refs" warning.** This is the right lesson
  from the .NET route blind spot, but a meaningful gate needs its own third
  fixture (a controller referencing nothing, in a repo with no other refs).
  **Deferred to H-d with that reason**, not forgotten.
- **`isFramework`** — still dead, still the literal `false` at both sites.
- **`apps/server/package.json` still does not declare `zod`** — owed since
  G-b1, examined and accepted four times now. Not tidied without asking.
- **Pushing.** master is 31 ahead; James's standing call since phase E.

## Files touched

Production:
1. `packages/schema/src/index.ts` — `RefVia`, `EntityRef` (+ `z.infer`
   aliases, matching the existing idiom); add `entityRefs` to `EntityGraph`.
2. `packages/extract/src/csharp/structure.ts` — capture expression-bodied
   method bodies (~336-341).
3. `packages/extract/src/csharp/entity-refs.ts` — **new**, the linear token
   walker. Named to avoid confusion with the unrelated TS-side
   `packages/extract/src/refs.ts`.
4. `packages/extract/src/dotnet.ts` — walk all `parse.types[].methods[]`,
   dedupe, sort, attach at both graph constructions (`:292`, `:626`).
5. `packages/extract/src/node.ts` — `entityRefs: []` (`:222`).
6. `packages/extract/src/detect.ts` — `entityRefs: []` in the `"none"` graph;
   `EXTRACTOR_VERSION` 1 → 2 (`:60`).
7. `packages/extract/src/merge.ts` — thread `entityRefs` (`:197-209`).
8. `packages/graph/src/refs.ts` — **new**, `refsFor`, `REF_VIAS`.
9. `packages/graph/src/index.ts` — re-export.
10. `apps/server/src/app.ts` — `GET /api/repos/:id/refs`.

Fixtures and gates:
11. `test/fixtures/mini-efcore-refs/**` — **new** self-contained fixture.
12. `test/fixtures.ts` — export `MINI_EFCORE_REFS`.
13. `packages/extract/test/entity-refs.test.ts` — **new**.
14. `packages/extract/test/structure.test.ts` — G19/G20.
15. `packages/extract/test/merge.test.ts` — G23 + `entityRefs: []` on literals.
16. `packages/graph/test/refs.test.ts` — **new**.
17. `apps/server/test/api.test.ts` — route gates; 8th entry in the 404 loop.
18. `apps/server/test/rehydrate.test.ts` — G24/G25.
19. `packages/graph/test/layout3d.test.ts`, `test/client-mcq.test.ts`,
    `test/component-label.test.ts`, `test/shape-label.test.ts` — add
    `entityRefs: []` to hand-built graph literals (typecheck enumerates these;
    do not hunt them by hand).

Docs: `feature-research/h-entity-refs-csharp/{plan,audit,progress}.md`.

## The fixture, `mini-efcore-refs`

Self-contained, namespace-consistent (so `resolveTypeInScope` resolves), and
built so that **every gate below has a positive control in the same graph**:

- `Data/RefsDbContext.cs` — context, `DbSet<Student> Students`,
  `DbSet<Course> Courses`, an `OnModelCreating` that references both
  (feeds G7/G22), and one ordinary method that references an entity
  (the positive control for G7).
- `Models/Student.cs`, `Models/Course.cs` — entities. One carries a
  navigation property typed `Course` (feeds G6).
- `Controllers/StudentsController.cs` — a block-bodied action referencing
  `Student` twice on one line and twice across two lines (G10/G11); an
  action with `Student` inside a plain string and inside an interpolated
  string (G16); a `StudentDto` mention (G14); a local variable `student`
  (G12) and a local named `Students` with no leading `.` (G13).
- `Controllers/CoursesController.cs` — an **expression-bodied** action
  `=> _db.Courses.Find(id)` (G19), and a reference to a non-entity helper
  class (G15).
- `Services/EnrollmentService.cs` — a non-controller class with refs, proving
  the walker is not controller-scoped.

Entity/shape/warning counts for this fixture are **measured and pinned in the
audit**, never assumed.

## Gate table — walked from the spec

Rule 1 from H-a: **every plan-specified behaviour needs a named mutant**, not
every gate. Several behaviours share one whole-object `toEqual` (rule 4);
each still owns its own mutant, and each mutant must be demonstrated red.

### "find …" — there is a query

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G1 | `extractDotnet` populates `entityRefs` | whole-array `toEqual` on the `mini-efcore-refs` graph | M1: walker returns `[]` | — (positive gate) |
| G2 | `refsFor(g, name)` returns only that entity's refs, in stored order | ordered `toEqual` | M2: ignore the entity filter | a second entity's refs exist in the same graph and are absent from the result |
| G3 | unknown entity name → `[]` | `toEqual([])` | M3: fall back to all refs | a known name returns non-empty in the same test |

### "… the related methods" — each result names a method

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G4 | ref carries the enclosing method name | in G1's `toEqual` | M4: emit `method: ""` | — |
| G5 | ref carries the enclosing type name | in G1's `toEqual` | M5: emit `type: ""` | — |
| G6 | a reference outside any method body emits nothing (nav property) | no ref whose line is the nav-property line | M6: also walk property/field declarations | the same entity referenced inside a method IS present |
| G7 | `OnModelCreating` on the context contributes nothing | no ref with `method: "OnModelCreating"` | M7: remove the D-Hb-5 exclusion | a different method on the **same** context class does contribute |

### "… and the lines" — each result names a line

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G8 | `line` is the 1-based line of the **matched token** | exact line numbers pinned to fixture source (precedent: `node.test.ts:196-204`) | M8a: `token.line - 1`; M8b: use `decl.line` (the method's line) instead | — |
| G9 | `file` is repo-relative, matching `Entity.file` | in G1's `toEqual` | M9: emit the absolute path | — |
| G10 | two refs on **different** lines in one method → two refs | ordered `toEqual` | M10: dedupe ignoring `line` | pairs with G11 |
| G11 | two refs on the **same** line → one ref | ordered `toEqual` | M11: no dedupe at all | pairs with G10 — the two-line case must still yield two |

### "… that call it" — the reference is real, and is to *that* entity

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G12 | exact-text match, case-sensitive | local `student` yields no ref | M12: case-insensitive equality | `Student` in the same method does match |
| G13 | `dbSetName` requires a preceding `.` | local named `Students` yields no ref | M13: drop the `.` requirement | `_db.Students` in the same method does match |
| G14 | equality, not substring | `StudentDto` yields no ref | M14: `.includes()` | exact `Student` in the same method does match |
| G15 | non-entity class names yield nothing | helper class yields no ref | M15: match any name in `byName` | an entity in the same method does match |
| G16 | a name inside a string literal yields nothing — **plain and interpolated** | no ref on either string line | M16: also scan `kind === "string"` token text | the same name as a bare identifier in the same method does match |
| G17 | matching is on token **text**, not `kind` | an entity whose name collides with a contextual keyword is still found | M17: restrict to `kind === "ident"` | an ordinary entity matches in the same graph |
| G18 | `ref.entity` is `Entity.name`, always present in `graph.entities` | every ref's entity resolves | M18: emit the DbSet property name for `dbSetName` matches | — |

> **G17 is conditional and must be MEASURED first.** `KEYWORDS` membership is
> tested against a `bare` form at `lex.ts:253`; whether that comparison is
> case-sensitive decides whether a class named `Record` lexes as `keyword`.
> **Measure it, then either build G17 or delete it and record the
> measurement.** Do not assert either way from this plan — H-a rule 3.

### "… it" — the answer is trustworthy

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G19 | expression-bodied methods are scanned | `=> _db.Courses.Find(id)` yields a ref | M19: restore `body: []` | — |
| G20 | the fix does not move `name`/`line`/`modifiers` for those methods | existing hermetic `structure.test.ts` assertions plus a new one | M20: set `line` to the `;` line | existing structure tests still pass |
| G21 | deterministic order, code-unit only | assert the **full ordered array**, never membership | M21a: swap the `file`/`line` keys; M21b: use `localeCompare` | — |
| G22 | a repo whose only refs are in `OnModelCreating` yields `[]` | `mini-efcore` → `entityRefs: []` | M22: remove the exclusion | `mini-efcore-refs` is non-empty **in the same suite run** |

> G21's mutant is chosen from H-a's H9d finding: a min/max swap left the whole
> suite green because only membership was asserted. Membership assertions do
> not gate order.

### The answer must survive storage and the fullstack path

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G23 | `mergeGraphs` carries `entityRefs` from the .NET side | `merge.test.ts` unit, hand-built inputs (existing precedent at `merge.test.ts:14`) | M23: drop the field from the merge literal | — |
| G24 | an envelope written **without** `entityRefs` loads and yields `[]` | second `Workspace` reads it back (`rehydrate.test.ts` pattern) | M24: remove `.default([])` | a current-shape envelope also loads |
| G25 | an envelope with `extractor: 1` re-extracts | extraction call counter fires | M25: revert `EXTRACTOR_VERSION` to 1 | an envelope at version 2 does **not** re-extract |

### The surface

| # | Behaviour | Gate | Named mutant | Positive control |
|---|---|---|---|---|
| G26 | `GET /api/repos/:id/refs?entity=Student` returns `{entity, vias, refs}` | whole-payload `toEqual` | M26: return refs unsorted | — |
| G27 | unknown repo → 404 **before** `entity` validation | `refs` as the 8th entry in the parameterised 404 loop, requested with **no** `entity` param | M27: validate `entity` first (→400) | the other 7 loop entries still 404 |
| G28 | missing or repeated `?entity=` → 400 | status + body | M28: accept `undefined` | a valid `entity` returns 200 |
| G29 | entity absent from `graph.entities` → 404; entity present with no refs → 200 `[]` | both statuses asserted | M29: return 200 `[]` for unknown entities | the zero-ref entity's 200 is the control |

**Recorded, not gated** — `vias` being derived from `REF_VIAS` rather than a
hardcoded literal. Exactly H-a's D-Ha-8 situation: with only two vias, drift is
caught incidentally, not by design. A real gate needs a third via to exist.
Recorded here rather than faked.

## Measurement obligations (audit, not gates)

Numbers, produced by running, never asserted from this plan:
1. `entityRefs` count for repoA and repoB; refs per controller; **how many of
   repoA's 10 controllers produce ≥1 ref** and how many produce none.
2. **Precision sample** — hand-check a fixed sample of `dbSetName` matches on
   repoA and report the false-positive rate as a number.
3. **Before/after the D-Hb-10 fix** — ref delta on repoA. If the delta is
   zero, say so; that would make the fix unjustified and it should then be
   pulled out of this phase.
4. The G17 `KEYWORDS` case-sensitivity measurement.
5. Suite counts at every step. Baseline **421 passed / 363+58 skipped**.
   **A skipped count below 58 means the private corpus config vanished** —
   stop, do not "fix" the number.
6. Extraction wall-clock on repoA before and after (the walker touches every
   method in 109 files).

## Risks

- **The version bump re-extracts every stored repo on next boot.** One-time,
  user-visible latency. Intended; call it out in `progress.md`.
- **`dbSetName` false positives** — any object with a property of the same
  name matches. Mitigated by the `.` requirement, quantified by obligation 2,
  not claimed to be zero.
- **`entityRefs` required in the output type produces a wide typecheck diff.**
  Intended: `tsc` enumerates the sites so none is missed silently.
- **`mini-efcore` assertions must not move.** If any do, that is a finding
  about D-Hb-5 or D-Hb-11, not a number to adjust.
- **Interpolated strings hide real references.** `$"{user.Name}"` is one
  opaque token. This is a genuine coverage hole, recorded, not fixable at this
  layer.
- **`#if` blocks are dropped by the lexer** (`lex.ts:105-108`), so references
  inside conditional compilation are invisible. Recorded.

## Open questions for James

1. **Size.** 29 gates across 7 production files. Keep whole, or split the
   route (G26-G29) into H-b2? Recommendation: keep whole — the route is ~30
   lines mirroring `app.ts:182-194`, and without it the phase ships no answer.
2. **D-Hb-5** — excluding `OnModelCreating`. Agree?
3. **D-Hb-9** — 404 for an unknown entity vs 200 `[]` for an unreferenced one.
4. **D-Hb-10** — fixing `structure.ts` inside this phase, or as its own phase?
5. Still not pushing (31 ahead), and `zod` still undeclared — confirm both
   stay untouched.
