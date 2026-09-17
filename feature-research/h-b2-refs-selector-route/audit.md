# Phase H-b2 — `refsFor` and `GET /api/repos/:id/refs` — AUDIT

Plan: `plan.md` (rev 3, approved), followed. Branch `master`, from `5143fe2`,
tree clean at start (41 ahead of origin). **Not pushed.**

Commits, in logical units:

- `08d77d2` feat(graph): refsFor
- `b4a7ca4` feat(server): GET /api/repos/:id/refs
- `ef5a683` test(extract): G37 — the ICU tripwire

## Files changed

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

Messages below are verbatim from the default reporter.

| Gate | Mutant | Applied (code diff) | Failing assertion observed (exact vitest message/diff) | Reverted (clean check) |
|---|---|---|---|---|
| G24 | M24 drop the entity predicate | `filter((r) => r.entity === entity && (via === undefined \|\| r.via === via))` → `filter((r) => (via === undefined \|\| r.via === via))` | Reddens **6 of 6**. G24: `AssertionError: expected 20 to be 11 // Object.is equality` (diff `- 11 / + 20`, at `refs.test.ts:22:27`). G25: `expected [ { entity: 'Course', …(5) }, …(19) ] to deeply equal []` (diff lists all 20 rows as `+`). G26: `expected [ { entity: 'Course', …(5) }, …(19) ] to deeply equal []`. G27: `expected [ …(20) ] to deeply equal [ …(11) ]`. G28: `expected [ …(3) ] to deeply equal [ 'Services/EnrollmentService.cs:15' ]`. G29: `expected 20 to be 9 // Object.is equality` | yes — `git status --porcelain` clean |
| G25 | M25 case-fold both sides | `r.entity === entity` → `r.entity.toLowerCase() === entity.toLowerCase()` | Reddens **1 of 6**, G25 only: `AssertionError: expected [ { entity: 'Student', …(5) }, …(8) ] to deeply equal []` at `refs.test.ts:36:35` (the `refsFor(g, "student")` line) | yes — clean |
| G26 | **none by design** | — | G26 is documentation, not a gated claim: G25's negative half already exercises the unknown-name path, and the plan retires a distinct mutant for it. Observed incidentally red under M24 (`expected [ { entity: 'Course', …(5) }, …(19) ] to deeply equal []`), which is consistent with it having no claim of its own | n/a |
| G27 | M27 `.reverse()` | `…filter(…)` → `…filter(…).reverse()` | Reddens **1 of 6**, G27 only: `AssertionError: expected [ '_Stale/Student.cs:41', …(10) ] to deeply equal [ …(11) ]`, diff shows the pinned sequence reversed — `- "Controllers/CoursesController.cs:20" … + "_Stale/Student.cs:41", + "Services/EnrollmentService.cs:55", + "Services/EnrollmentService.cs:24", + "Services/EnrollmentService.cs:15", + "Data/RefsDbContext.cs:18", + "Controllers/CoursesController.cs:55"` (the `:47` pair is the fixed midpoint) at `refs.test.ts:61:38` | yes — clean |
| G28 | M28 ignore `opts.via` | `filter((r) => r.entity === entity && (via === undefined \|\| r.via === via))` → `filter((r) => r.entity === entity)` | Reddens **1 of 6**, G28 only: `AssertionError: expected [ …(11) ] to deeply equal [ 'Services/EnrollmentService.cs:15' ]` at `refs.test.ts:81:27`. G29 stays **green** — the discriminating half of the M28/M29 pair | yes — clean |
| G29 | M29 filter unconditionally | `(via === undefined \|\| r.via === via)` → `r.via === opts?.via` | Reddens **5 of 6** — G24 `expected +0 to be 11`, G25 `expected +0 to be 9`, G27 `expected [] to deeply equal [ …(11) ]`, G28 `expected 11 to be +0`, **G29** `expected [] to deeply equal [ 'dbSetName', 'entityName' ]` at `refs.test.ts:98:57`. G26 stays green. **Deviation from the plan's prediction, see below** | yes — clean |
| G30 | M30 return `{refs}` alone | body `{ entity, via, known, refs }` → `{ refs }` | Reddens **2 of 7** — G30: `AssertionError: expected [ 'refs' ] to deeply equal [ 'entity', 'known', 'refs', 'via' ]`; G33: `expected undefined to be true // Object.is equality` | yes — clean |
| G31 | M31 drop the `!repo` guard | the four-line `if (!repo) { fail(res, 404, …); return; }` deleted, lookup becomes `workspace.get(…)!` | Reddens **2 of 7** — G31: `expected 400 to be 404 // Object.is equality`; G35: `expected 400 to be 404 // Object.is equality`. (400, not 500: `handler()` turns the thrown `TypeError` into a 400, which is exactly the silent-downgrade this gate exists to catch) | yes — clean |
| G32 | M32 drop `entity` validation | the `typeof entity !== "string" \|\| entity.trim() === ""` guard deleted | Reddens **2 of 7** — G32: `expected 200 to be 400 // Object.is equality`; G36: `expected 200 to be 400 // Object.is equality` | yes — clean |
| G33 | M33 `known = refs.length > 0` | `known: repo.graph.entities.some((e) => e.name === entity)` → `known: refsFor(repo.graph, entity, …).length > 0` | Reddens **1 of 7**, G33 only: `AssertionError: expected false to be true // Object.is equality` — the `MINI_EFCORE` / `Student` case, 5 real entities and zero refs | yes — clean |
| G34 | M34 drop the `via` validation | the `RefVia.safeParse` block → `const via = rawVia === undefined ? null : (rawVia as RefVia)` | Reddens **2 of 7** — G34: `expected 200 to be 400 // Object.is equality` (`?via=bogus` answered 200 with an empty list); G36: `expected 200 to be 400` (the repeated-`via` half) | yes — clean |
| G35 | M35 validate before the repo lookup | the repo-lookup block moved below both validation blocks | Reddens **1 of 7**, G35 only: `AssertionError: expected 400 to be 404 // Object.is equality`. G31 and G32 both stay **green**, which is the measured proof that neither of them observes guard order | yes — clean |
| G36 | M36 `String(entity)` coercion | `const entity = req.query["entity"]; if (typeof entity !== "string" \|\| entity.trim() === "")` → `const entity = String(req.query["entity"]); if (entity.trim() === "")` | Reddens **2 of 7** — G36: `expected 200 to be 400 // Object.is equality` (`?entity=Course&entity=Student` looked up `"Course,Student"` and answered 200); G32: `expected 200 to be 400` (missing `entity` became the string `"undefined"`) | yes — clean |
| G37 | **none by design** | — | G37 asserts a property of the fixture **and** the platform together (that code-unit and `localeCompare` orderings of the ref files can be told apart), not a behaviour of production code, so there is no production mutant to apply. It **passed on arrival**, so G17 is not disarmed today. Control measured instead: filtering the `_Stale` rows out of the derivation reddens it — `AssertionError: expected [ …(10) ] to not deeply equal [ …(10) ]` / `Compared values have no visual difference.` at `entity-refs.test.ts:326:28`. Reverted, green again | n/a (test-side control reverted; `git status --porcelain` clean) |

### Deviation: M29 reddens G28 as well as G29

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

## Suite numbers

| Run | Before (at `5143fe2`) | After |
|---|---|---|
| `pnpm test` | **446 passed (446)**, 34 files | **460 passed (460)**, 34 files |
| `PSQ_NO_CORPUS=1 pnpm test` | **388 passed / 58 skipped (446)** | **402 passed / 58 skipped (460)** |
| `pnpm typecheck` | exit 0, four projects | exit 0, four projects |

+14 = 6 (G24-G29) + 7 (G30-G36) + 1 (G37). **Skipped held at exactly 58**, so
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
4. **`apps/server/package.json` still does not declare `zod`**, which the route
   now leans on indirectly through `RefVia`. Examined and left, as the plan
   directs — for the seventh time.
5. **D-Hb-10 remains deferred to H-e** with its measured design intact in
   `plan.md`'s "Deferred to H-e" section. Nothing in this phase touched
   `structure.ts`.
