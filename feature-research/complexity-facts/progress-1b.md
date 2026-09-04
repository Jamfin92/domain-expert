# Phase 1b-i — PROGRESS

**Status: reviewed "Ship", post-review fix applied, 2026-09-03. Uncommitted —
the work sits in the working tree on branch `m5b-component-attribution`, on top
of Phase 1's own uncommitted work, on top of HEAD `a064d80`. James commits.**

Plan: `plan-phase1b.md` (Revision 2). Audit: `audit-1b.md`.
Phase 1's record: `progress.md`.

Plan Revision 1 was reviewed **before** implementation and returned *Fix first* —
six blocking issues, one of which falsified the measurement its central decision
rested on. Revision 2 is that re-plan. The implementation was then reviewed
again and returned **Ship**, with the reviewer re-deriving every gate from the
commands rather than reading the audit back.

---

## What shipped

**A React + .NET repo now yields both halves in one graph.**
`detectProvider` returns `"fullstack"` when both stacks are present, and
`extract()` runs both readers and merges them.

**The merge is two-rooted.** `extractDotnet(root)` + `extractNode(nodeRootFor(root))`,
with every node-side path re-prefixed by `relative(root, nodeRoot)`.
`nodeRootFor` picks the root itself when it has a `tsconfig.json`, else the
single directory below it that has one, else the root with a warning naming the
candidates. Root selection is confined to the fullstack path, so **every
single-stack extraction is byte-identical to before** — which is what keeps
corpus repoD (no root tsconfig, four nested) off this change.

**`provider` is now `z.enum([...])`**, not `z.string()`. That is what makes
`pnpm typecheck` a real control: deleting a consumer arm fails to compile
(`detect.ts(51,44): error TS2366`, observed).

### Measured, on `~/Developer/northwind-fullstack`

| | before | after |
|---|---|---|
| provider | `efcore` | **`fullstack`** |
| entities / relations | 8 / 8 | 8 / 8 |
| shapes | 10 | **43** |
| clientCalls / components | 0 / 0 | **5 / 77** |
| attributions intact | — | **5 of 5** |

Tests: `PSQ_NO_CORPUS=1 pnpm test` **204 passed | 58 skipped (262)**, from a
baseline of 178 | 58. Full `pnpm test` **262 passed, 0 failed** — it was red
before this phase, and step 13 was the cause.

---

## Decisions made this phase

**D-1b-1. One graph, two roots — not one root, and not two composed graphs.**
Plan Revision 1 chose the shared root on the evidence that `extractNode` returns
"identical numbers" at the full-stack root and at `client/` — 33 shapes,
5 clientCalls, 77 components either way. **Those numbers structurally cannot see
the failure.** Re-measured element-wise, the shared root destroys **three of five
attributions** (every call reached through an `@/services/...` import) and
degrades two shapes to `error`-typed fields, because `programFor` finds no root
`tsconfig.json` and falls to `walk` + `FALLBACK_OPTIONS`, which carries no
`paths`.

**A count is not a control.** That is the transferable lesson of this phase.

**D-1b-2. The merge never dedupes shapes by name.** Nine of Northwind's ten C#
DTOs share a name with a TypeScript shape; `file#name` never collides. Deduping
would delete nine real facts, and `Shape` has no key field, so it would also be
non-deterministic about which twin survives.

**D-1b-3. `mirrors` stays a within-stack fact, and the merge says so once.**
`pairShapes` (`pair.ts:26-58`) matches on **names only** — `conceptKey` folds
case, separators, a DTO suffix and plurals — so cross-stack pairing would mostly
*succeed* mechanically today. That is exactly why it is deferred: a newly paired
TS shape immediately emits `fieldDrift`/`dtoOnlyField` questions whose evidence
bar (rule 4a) has never been argued for a cross-language pairing.

**D-1b-4. A warning that would have been false was caught before shipping.**
`node.ts:202-208` ("no CREATE TABLE, so this repo has shapes but no schema")
fires on every full-stack repo, and the merged graph has eight entities. Every
count-based gate is blind to it; the fix was to assert the warning list.

**D-1b-5. `ds-cloze.ts`'s provider gate stayed at the `columnType` site.**
Plan Revision 1 read it as module-level. It is not — `GENERATORS = [fieldType,
discriminator, columnType]` and the first two are ungated and already run on
`efcore` graphs. Hoisting it would have silently deleted two question classes
from every .NET repo.

---

## OPEN — needs James's word

**The `tsconfig.json` amendment has not been signed off.** The implementer added
one line — `test/fixtures/mini-fullstack-csharp` to `exclude` — which is outside
the plan's "Files touched". It is there because the fixture's `@/` aliased import
is this phase's only positive control for root selection, and that import fails
the root `typecheck` program otherwise.

The precedent is real and complete: `mini-react` and `mini-solution-tie` are the
only fixtures carrying their own `tsconfig.json`, both are already excluded, and
this is the third such fixture. Reviewer's narrower option if wanted: exclude
`test/fixtures/mini-fullstack-csharp/client` rather than the whole fixture.

**If vetoed**, the aliased import must go, and with it the control — at which
point the fixture would pass whether or not `nodeRootFor` works.

---

## What the next phase needs to know

**1. `psq selftest` now exits 1 on a full-stack repo, and this phase did it.**
Northwind server-only reports `selftest ok — 97 questions`; the merged root
reports `selftest failed — 2 finding(s) across 113 questions`. The plan
authorised it, but **rule 5 means every full-stack bank psq now produces is
formally untrusted until Phase 1b-ii lands.** This is a state change, not an
open risk.

**2. Phase 1b-ii is smaller than predicted and reproducible hermetically.**
The plan predicted ~8 findings on Northwind; the real number is **2**. The new
fixture also carries exactly 2 — the **first hermetic reproduction** of a defect
that until now existed only on gitignored corpus repos. Note the fixture's
findings were a *choice*, not forced: D7 mandates a shared DTO name, not that
both twins carry exactly one optional field differing by case, and that second
property is the actual trigger.

**3. `merge.ts:70` descends to a single tsconfig candidate without checking
whether TypeScript also lives outside it.** A repo with `scripts/build.ts` at the
root plus `client/tsconfig.json` becomes `"fullstack"` *because of* that
root-level `.ts` — and then the node reader never reads it, silently. The file
that triggered the classification goes unread. Rule 3 territory, one line to
close, not live today (Northwind has 0 `.ts` outside `client/`).

**4. `node.test.ts:87` pins the route floor at 9, not the live 11.** The reader
could drop back to 9 without reddening, provided the nine pinned routes survive.
Ordering and route-addition detection were traded for a runnable gate.

**4a. The SIBLING corpus assertion went stale the next day, and is red now.**
Step 13 split the repo-D *routes* assertion. `packages/extract/test/node.test.ts:49`
(*infers relations from `<table>_id`*) is the same construct — a full ordered
`toEqual` over the same live repo — and nobody split it. repoD took a commit on
2026-09-03 adding two tables, so the full suite is **2 failed / 260 passed**
as of 2026-09-04, entirely in that one test. Verified not caused by this phase:
`git diff a064d80..HEAD` touches only the routes assertion, and the hermetic
suite is 204 passed / 0 failed.

The fix is the one already approved for routes — `expect.arrayContaining` plus
a length floor — but decide the semantics first: for relations, unlike routes, a
DELETED relation is arguably the interesting failure, so a pure floor may be the
wrong shape. **Phase 1's D-2 stands: do not re-pin.** Sweep for any other
`toEqual` against a corpus value while in there.

**5. `apps/server/src/workspace.ts:122-128`'s new `"fullstack"` arm has no test.**
A message string only — but this phase's own Gate 7 standard is that an
untriggered branch may not work.

**6. Recorded, not fixed:** `packages/quiz/src/sql/types.ts:4-15` and
`sql/seed.ts:85,107-109,322` hardcode C#-flavoured `baseType` values with no
provider gate. Correct today only because a fullstack graph's entities are always
EF-sourced — which is exactly what D-1b-2's both-sides-have-entities warning
guards.

**7. `packages/*/test/**` is outside every typecheck project.** The root
`tsconfig.json` `include` is `packages/*/src/**/*.ts`, so a malformed literal in
a test file compiles clean forever. Found this phase; a standalone `tsc` caught
only half of it — the invented and missing properties surfaced only against the
real zod schema.

---

## Files touched

1. `packages/extract/src/merge.ts` — new (`nodeRootFor`, `mergeGraphs`)
2. `packages/extract/src/detect.ts` — `"fullstack"`, rewritten docblock
3. `packages/schema/src/index.ts` — `provider` as `z.enum`
4. `apps/server/src/workspace.ts` — fullstack arm, stale message at :125
5. `packages/quiz/src/generate/ds-cloze.ts` — comment only
6. `packages/quiz/src/generate/entity-mcq.ts` — comment only
7. `apps/cli/src/index.ts` — non-entity summary line
8. `test/fixtures/mini-fullstack-csharp/**` — new
9. `test/fixtures.ts` — `MINI_FULLSTACK_CSHARP`
10. `packages/extract/test/merge.test.ts` — new
11. `test/mini-fullstack-csharp.test.ts` — new
12. `test/mini-node.test.ts` — fullstack detect assertion
13. `packages/extract/test/node.test.ts` — repo-D route assertion split
14. `feature-research/complexity-facts/roadmap.md`
15. `feature-research/m5b-component-attribution/roadmap.md` — C2 overturned
16. `README.md` — test counts
17. **`tsconfig.json` — one line, OUT OF PLAN, see OPEN above**

**Not touched:** `node.ts`, `dotnet.ts`, `csharp/**`, `pair.ts`, `node/*`,
`packages/extract/src/index.ts`, `packages/graph/**`, `apps/web/**`, `bank.ts`,
`grade.ts`, `ds-mcq.ts`, `selftest.ts`, `test/corpus.local.json`, every existing
fixture.

---

## Next phase — three candidates, ranked

1. **M5c — expose M5b's facts through the server and UI.** `apps/server/src/app.ts`
   and `apps/web/src/lib/api.ts` still do not serve or consume `clientCalls` /
   `components`. The work exists and nobody can see it.
2. **Phase 1b-ii — shape-name ambiguity in the DS bank.** Now measured at 2
   findings, hermetically reproducible, and it clears the rule-5 cloud from
   item 1 above. Scope and the likely `shapeLabel(g, shape)` fix are written up
   at the bottom of `plan-phase1b.md`.
3. **Phase 2 — TypeScript complexity as a fact.** Unblocked either way; the
   roadmap put the cheap half first deliberately, to prove the
   fact → schema → graph → oracle path before paying for the C# body pass.

Roadmap open question 2 is **answered and closed** in `roadmap.md`. Open
questions 1, 3 and 4 remain for Phase 2.
