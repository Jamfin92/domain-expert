# Phase C — 1b-ii: `shapeLabel` at the five DS prompt sites — PLAN

**Status: APPROVED by James 2026-09-06** (plan critique: one blocking item
fixed, twelve non-blocking folded in). Base: `37960f2` (`master` ==
`origin/master` == `m5b-component-attribution`, tree clean, verified
2026-09-05). Spec: bottom of `../complexity-facts/plan-phase1b.md`
("Phase 1b-ii"). Prior records: `../complexity-facts/progress-1b.md` (item 1
under "what the next phase needs to know"), `../deploy-personal/progress.md`
(carried items). MVP table row C in `../green-and-push/progress.md`.

---

## Goal

`psq selftest` exits 0 on every full-stack repo — proven on the hermetic
fixture `test/fixtures/mini-fullstack-csharp` and on the Northwind sibling
checkout — with **byte-identical banks wherever a shape name is unique**.
Nothing about extraction, grading, selection, the server, the web UI or the
desktop shell changes.

## The defect (measured today at `37960f2`)

`packages/quiz/src/selftest.ts` (`selftest()`, ~line 114) groups questions by
the **raw** `prompt` string and flags any prompt that has ≥2 different
reference answers across the set. Five DS generator sites interpolate only
`shape.name` into the prompt while keying the question **id** on
`shape.file`. On a merged full-stack graph the C# and TS twins of one DTO
therefore share a prompt and disagree on the answer (case-different field
spellings), and selftest reads the pair as a contradiction:

| Root | Today |
|---|---|
| `test/fixtures/mini-fullstack-csharp` | exit 1 — `2 finding(s) across 16 questions`, both `field-optional`, prompt `"Which field of ProductDto is optional?"`, answers `description \| Description` |
| Northwind full-stack root | exit 1 — `2 finding(s) across 113 questions`, both `field-collection`, prompt `"Which field of OrderDto holds many values rather than one?"`, answers `details \| Details` |
| Northwind server-only root | exit 0 — `selftest ok — 97 questions` (from the 1b-i record) |

The 1b-ii spec's corpus numbers (`repoAClient` ≥18 duplicated shape names,
`repoD` ≥39) are **stale**. Measured 2026-09-05 at `37960f2` with the same
`extract()` the CLI uses (plan critique; step 1 re-measures, one root per
process):

| Root | Duplicated shape names | `selftest` today |
|---|---|---|
| fixture `mini-fullstack-csharp` | 1 (`ProductDto`) | exit 1, 2 findings / 16 q |
| Northwind full-stack (`~/Developer/northwind-fullstack`) | 9 | exit 1, 2 findings / 113 q |
| Northwind server-only (`…/northwind-fullstack/server`) | 0 | ok, 97 q |
| `repoA` | 0 | ok, 213 q |
| `repoB` | 0 | ok, 107 q |
| `repoC` | 0 | ok, 2 q |
| `repoD` | 3 | ok, 132 q |
| `repoE` | 0 | ok, 56 q |
| `repoAClient` | 8 (worst repeated 10×) | exit 1, **5** findings / 88 q: 4 prompt-ambiguity (2 `field-collection`, 2 `not-a-member`, all at the five sites) **+ 1 `not-a-member` "reference answer is graded wrong"** that this phase does not touch |

So the prompt diff is non-empty on exactly four roots (fixture, Northwind
full-stack, `repoD`, `repoAClient`) and the bank must be byte-identical on
the other five. **`repoAClient` still exits 1 after this phase** (the
graded-wrong finding, a different class — D-C-7); everything else exits 0.
A measured count that differs from this table is not a regression by itself
— record it and continue; the gates in step 5 decide.

## The five sites (current lines at `37960f2`)

All eight DS generator functions (five in `ds-mcq.ts`, three in
`ds-cloze.ts`) take `ctx: Ctx` and reach the graph as `ctx.g`; the entry points are `generateDsMcq(g, seed?)` (`ds-mcq.ts:195`) and
`generateDsCloze(g, seed?)` (`ds-cloze.ts:154`). Ids at the five sites already
carry `shape.file`; only the prompt text is ambiguous.

| # | File | Function | Prompt line | Id template (unchanged) |
|---|---|---|---|---|
| 1 | `packages/quiz/src/generate/ds-mcq.ts` | `optionalField` | 127 | `ds.optional.${shape.file}.${shape.name}` |
| 2 | `packages/quiz/src/generate/ds-mcq.ts` | `collectionField` | 149 | `ds.collection.${shape.file}.${shape.name}` |
| 3 | `packages/quiz/src/generate/ds-mcq.ts` | `notAMember` | 182 | `ds.member.${shape.file}.${shape.name}` |
| 4 | `packages/quiz/src/generate/ds-cloze.ts` | `fieldType` | 73 | `ds.cloze.type.${shape.file}.${shape.name}.${f.name}` |
| 5 | `packages/quiz/src/generate/ds-cloze.ts` | `discriminator` | 94 | `ds.cloze.disc.${shape.file}.${shape.name}` |

**Not touched:** `fieldDrift` (`ds-mcq.ts:73`) and `dtoOnlyField`
(`ds-mcq.ts:96`). Their prompts also use the bare name, but their ids are
`ds.drift.*.${entity.name}.${shape.name}` with **no file** — the recorded
landmine for the cross-stack-mirrors phase (unreachable while TS shapes carry
`mirrors: null`). When that id collides, `selftest.ts:~152` already reports a
duplicate id, so labelling their prompts alone would hide nothing and fix
nothing. See D-C-3.

## Design

New helper, one function, no state:

```ts
// packages/quiz/src/generate/shape-label.ts
import type { EntityGraph, Shape } from "@psq/schema";

/** `shape.name` when the name is unique in `g.shapes`, else
 *  `"<name> (<file>)"`. Extraction keys shapes by `file:name`, so the
 *  labelled form is unique whenever the shape is. Exact, case-sensitive
 *  match — selftest keys on raw text, so `Foo` and `foo` never collide. */
export function shapeLabel(g: EntityGraph, shape: Shape): string {
  let n = 0;
  for (const s of g.shapes) if (s.name === shape.name && ++n > 1) break;
  return n > 1 ? `${shape.name} (${shape.file})` : shape.name;
}
```

At each of the five sites: `const label = shapeLabel(ctx.g, shape);` once per
question, and replace `${shape.name}` **in the `prompt` template only** with
`${label}`. Ids, `subjects`, `rationale`, options and answers stay exactly as
they are (D-C-2). Export the helper from the `packages/quiz/src/index.ts`
barrel (one line) so tests and M5c-ii can import it from `@psq/quiz`.

Expected new prompts on the fixture (pin these exactly in the test):

- `Which field of ProductDto (client/src/types/product-dto.ts) is optional?`
- `Which field of ProductDto (server/Dtos/ProductDto.cs) is optional?`

## Files touched

Feature commit (`feat(quiz): …`):

| Path | Change |
|---|---|
| `packages/quiz/src/generate/shape-label.ts` | **new** — the helper above |
| `packages/quiz/src/index.ts` | **modified** — one `export { shapeLabel } from "./generate/shape-label.js";` line (match the barrel's existing style) |
| `packages/quiz/src/generate/ds-mcq.ts` | **modified** — import; sites 1–3 |
| `packages/quiz/src/generate/ds-cloze.ts` | **modified** — import; sites 4–5 |
| `test/shape-label.test.ts` | **new** — hermetic unit tests (below). Root `test/`, not `packages/quiz/test/`: the root `tsconfig.json` includes `test/**/*.ts` but not `packages/*/test/**`, so this placement is the only one `pnpm typecheck` covers; the root vitest include picks up both |
| `test/mini-fullstack-csharp.test.ts` | **modified** — the `"yields a bank worth running the selftest against"` test (lines 117–151): flip the deliberately-red assertion to green, pin the labelled prompts, rewrite the comment block |

Record commit (`docs: …`) on top: `feature-research/shape-label/plan.md`
(this file, unchanged unless a deviation is recorded), `audit.md`,
`progress.md`.

**Nothing else.** In particular not: `selftest.ts`, `grade.ts`,
`normalize.ts`, `bank.ts`, `entity-*.ts`, `packages/extract/**`,
`packages/schema/**`, `apps/**`, `scripts/**`, `README.md`, any
`tsconfig*.json`, `package.json`, the lockfile. If the build needs a file
outside this table, stop and report instead of touching it.

## Tests

### `test/shape-label.test.ts` (new, hermetic)

Import `shapeLabel` from `@psq/quiz` (the barrel). `Shape` has nine required
fields (`packages/schema/src/index.ts:138-157`), so write one local
`shape(name, file)` helper that fills the rest with empty/null defaults, and
one `graph(shapes)` helper for a minimal `EntityGraph` — graph literals
already exist in `packages/extract/test/merge.test.ts` and
`packages/graph/test/layout3d.test.ts`; follow their shape (`quiz.test.ts`
builds none — it extracts). The helper reads only `g.shapes`. Cases:

1. Unique name → returns `shape.name` exactly (positive: also assert the
   labelled form is **not** returned).
2. Same name in two files → each twin returns `"<name> (<file>)"` with its own
   file; the two labels differ.
3. Three same-named shapes → all three labelled, all distinct.
4. A graph with all-unique names → `shapeLabel(g, s) === s.name` for every
   `s` (loop over `g.shapes`; assert `g.shapes.length ≥ 2` first so the loop
   is not vacuous). Use the extracted `MINI_NODE` fixture graph (12 shapes,
   all unique) the way `test/mini-node.test.ts` obtains it — **not**
   `MINI_EFCORE`, which extracts to 0 shapes and would fail the floor.
5. Case matters: `Foo` and `foo` in different files are both returned bare.

### `test/mini-fullstack-csharp.test.ts` (flip)

Keep the existing floor assertions unchanged (≥4 questions, ≥2 generators,
exactly 2 `field-optional`) — they are the positive control that stops an
empty bank from passing as "clean". Then replace the red block with:

- `expect(selftest(questions)).toEqual([])`.
- The two `field-optional` prompts, sorted, equal the two labelled strings
  under "Design" above (pinned exactly — this proves the label engaged, not
  that selftest went blind).
- Their ids are unchanged: still
  `ds.optional.client/src/types/product-dto.ts.ProductDto` and
  `ds.optional.server/Dtos/ProductDto.cs.ProductDto`.

Rewrite the comment block so it says what is now true: this is the hermetic
guard for 1b-ii, why the label carries the file, and that ids never changed.
Drop the "out of scope here / Phase 1b-ii" sentences.

## Steps (implementer)

Prerequisites for every command: `export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"`
(node/pnpm are not on the default PATH). Work from the repo root. **This
checkout is production** (`com.psq.server` LaunchAgent runs from it): never
run `scripts/deploy.sh`, `launchctl bootout/bootstrap`, or `launchctl print`;
do not restart anything. **Do not run `pnpm test:e2e` or `pnpm build:web`**
(D-C-10): the web build has `emptyOutDir: true` on the directory the live
server serves from disk, and this change cannot reach the e2e fixtures.

0. Confirm `git status --porcelain` shows **only** the untracked
   `feature-research/shape-label/` (this plan) and `git rev-parse HEAD` is
   `37960f2…`. `git switch -c 1b-ii-shape-label master`.
1. **Baselines before any edit** (record every number in `audit.md`):
   - `pnpm typecheck` → clean. `PSQ_NO_CORPUS=1 pnpm test` → expect
     `225 passed | 58 skipped (283)`. `pnpm test` → expect `283 passed`.
   - For each of the nine roots R in the table under "The defect": the
     fixture (`test/fixtures/mini-fullstack-csharp`),
     `~/Developer/northwind-fullstack`, `~/Developer/northwind-fullstack/server`
     (the server-only root, as in `../complexity-facts/progress-1b.md:112`),
     and the 6 `path` entries in `test/corpus.local.json` (refer to them
     **only** by their keys `repoA`…`repoE`, `repoAClient` — never the path or
     basename):
     - `pnpm selftest --repo R` → record exit code, the summary line, and
       for each finding its generator + id (ids are repo-relative — still
       sweep the audit afterwards).
     - `pnpm psq questions --repo R --seed 7 --out <scratch>/before/<key>`.
       It writes `<out>/questions/entity.json` (the **whole** bank despite
       the name) and `<out>/schema.sql`. Same `--seed` after. Scratch dir:
       the session scratchpad, never inside the repo.
   - Count duplicated shape names per root with a throwaway tsx script in
     the scratchpad that calls `extract()` and prints `name → count` for
     counts ≥2 (a tool, not a change). **One root per process** — two
     `extract()` calls in one tsx process silently produced nothing for the
     second root during the critique. Record the **numbers** per root
     against the table above, and the names only for the fixture and
     Northwind (corpus shape names are withheld, as the spec did).
2. Add `shape-label.ts`, the barrel export, and `test/shape-label.test.ts`;
   run `pnpm vitest run test/shape-label.test.ts` until green (there is no
   per-package test script; the root vitest include covers `test/**`).
3. Apply the label at sites 1–5. Nothing else in those two files changes
   (no reformatting, no import reordering beyond the one new import).
4. Flip `test/mini-fullstack-csharp.test.ts` as specified.
5. **Gates** (all recorded in `audit.md`, with the command and the output
   line that proves each):
   - `pnpm typecheck` clean.
   - `PSQ_NO_CORPUS=1 pnpm test`: expect **`≥230 passed | 58 skipped`**, 0
     failed (5 new unit tests; the flipped test stays 1 test).
   - `pnpm test`: all passed, 0 failed, count = hermetic count + 58.
   - No e2e run (D-C-10).
   - `pnpm selftest --repo R` for every root in step 1: **exit 0 on the
     fixture and both Northwind roots (required)**; exit 0 on `repoA`,
     `repoB`, `repoC`, `repoD`, `repoE` (they are ok today and must stay
     ok); **`repoAClient`: exit 1 with exactly one finding**, the
     `not-a-member` "reference answer is graded wrong" one from the
     baseline — its four prompt-ambiguity findings must be gone. Any
     remaining finding whose problem is `prompt has N different reference
     answers` on an id starting `ds.optional.`, `ds.collection.`,
     `ds.member.`, `ds.cloze.type.` or `ds.cloze.disc.` is a **bug in this
     phase** — stop and report. Any other finding is recorded, not fixed.
   - Bank diff per root, `after` vs `before` (the bank file is
     `<out>/questions/entity.json`):
     - **ids unchanged:** `jq '[.[].id]'` of before == after (byte-identical
       lists, same length).
     - **only prompts changed:** `jq 'map(del(.prompt))'` of before == after.
     - **every changed prompt belongs to a duplicated name:** for each
       question whose prompt differs, its id's shape name (the segment after
       the file at the five sites) is in that root's duplicated-name set from
       step 1, and the new prompt contains `(<file>)` for the file in the id.
       Report `changed / total` per root.
     - **positive control:** non-empty prompt diff on exactly the four
       roots with duplicated names — fixture (≥2 changed), Northwind
       full-stack (≥2), `repoD`, `repoAClient` (≥4).
     - **byte-identical control:** `diff -r before/<key> after/<key>` is
       empty (exit 0) on the five roots with 0 duplicated names: Northwind
       server-only, `repoA`, `repoB`, `repoC`, `repoE`. Name each.
   - `git diff --stat` on the feature commit lists exactly the six code/test
     paths in "Files touched" and nothing else.
6. **Two sweeps, positive control first, before `git commit`:**
   - Corpus basenames: derive the set from `test/corpus.local.json` paths
     (`jq -r '.[].path'` → `basename`), never hand-typed. Control: grep the
     set against `test/corpus.local.json` itself → N hits. Then grep against
     `feature-research/shape-label/*`, the staged diff (`git diff --cached`),
     `README.md`, `scripts/*` → **0 genuine**. Report counts only, never the
     names. One basename is a 6-letter dictionary word (exact match in
     `/usr/share/dict/words`) that already appears in 42 record files at
     `89448e7`; whole-word hits of it in ordinary prose are noise, not a
     leak — classify them that way (dictionary check + precedent count),
     never by quoting the word. Every other basename must be 0.
   - Host/token: write the `PSQ_HOST` and `PSQ_TOKEN` values from
     `~/.config/psq/deploy.env` into a 600 pattern file in the scratchpad
     (`grep -E '^(export )?PSQ_(HOST|TOKEN)=' | cut -d= -f2-`, quotes
     stripped) and sweep with `grep -c -F -f <patterns>` — the values never
     sit in a shell variable or in argv, so neither `set -x` nor an error
     line can copy them into `audit.md`. Control: the env file → 2. Then the
     same targets as above → **0**. Delete the pattern file afterwards.
7. Commit the feature on `1b-ii-shape-label`. Write `audit.md` (build log,
   gates, both sweeps with control counts, deviations). Do **not** write
   `progress.md`, fast-forward `master`, or push — those follow review.

## Gates summary

| Gate | Baseline (`37960f2`) | Required after |
|---|---|---|
| `pnpm typecheck` | clean | clean |
| `PSQ_NO_CORPUS=1 pnpm test` | 225 passed \| 58 skipped (283) | ≥230 passed \| 58 skipped, 0 failed |
| `pnpm test` | 283 passed | all passed, 0 failed |
| `pnpm test:e2e` | 21 passed | **not run** (D-C-10) |
| selftest, fixture | exit 1, 2 findings / 16 q | **exit 0**, `selftest ok — 16 questions` |
| selftest, Northwind full-stack | exit 1, 2 findings / 113 q | **exit 0**, 113 questions |
| selftest, Northwind server-only | exit 0, 97 q | exit 0, 97 q, bank byte-identical |
| selftest, `repoA`/`repoB`/`repoC`/`repoE` | ok (213 / 107 / 2 / 56 q) | ok, same counts, banks byte-identical |
| selftest, `repoD` | ok, 132 q | ok, 132 q; prompts changed for its 3 duplicated names |
| selftest, `repoAClient` | exit 1, 5 findings / 88 q | exit 1, **exactly 1** finding (graded-wrong `not-a-member`), 88 q |
| bank ids, every root | — | identical before/after |
| bank prompts, every root | — | changed only where the name is duplicated (4 roots), empty diff on the other 5 |
| corpus sweep | control N/N on the corpus file | 0 elsewhere |
| secret sweep | control 2/2 on the env file | 0 elsewhere |

## Decisions

- **D-C-1 Label form.** `shape.name` when unique in `g.shapes`, else
  `"<name> (<file>)"`. Exact, case-sensitive uniqueness. File, not module or
  language: `file` is what the id already keys on, what extraction keys on
  (`file:name`), and what a learner can open. No `language` field exists on
  `Shape`; inferring one from the extension would add a second naming scheme.
- **D-C-2 Prompt only.** Ids are already unique (they carry the file) and
  are persisted keys — unchanged. `subjects` feed selection/grouping and
  would fragment if labelled. `rationale` stays bare: two of the five
  (`notAMember`, `fieldType`) already name `shape.file`, the other three
  (`optionalField`, `collectionField`, `discriminator`) do not, but every
  rationale is displayed with its now-labelled prompt, so the question as a
  whole is unambiguous. Leaving it bare keeps the diff to the five lines the
  spec names; labelling rationale is a recorded follow-up, not a gate.
- **D-C-3 The two drift sites stay bare.** Their defect is the id template
  (no file), recorded for the cross-stack-mirrors phase; it is unreachable
  today and, when reached, selftest reports it as a duplicate id. Labelling
  their prompts now would be byte-identical today and would mask nothing,
  but it is outside the spec's five and adds a change without a test.
- **D-C-4 selftest keying unchanged.** It keys on raw text by design; adding
  `normalize()` there would collapse `Description`/`description` and hide the
  very ambiguity this phase removes.
- **D-C-5 Helper location.** `packages/quiz/src/generate/shape-label.ts`,
  next to its two callers, exported from the `@psq/quiz` barrel for tests and
  for M5c-ii's comparative generator, which will need the same label.
- **D-C-6 No memoisation.** A linear scan of `g.shapes` per question is a few
  thousand comparisons on the largest corpus. Pre-computing a duplicate set
  would mean threading it through both files' `Ctx` — more surface for no
  measurable gain.
- **D-C-7 Trust boundary.** Full-stack banks become formally trusted (rule 5
  of the 1b-i record) only when selftest passes on the fixture **and**
  Northwind. The six corpora are measured and recorded; `repoAClient`'s one
  remaining `not-a-member` graded-wrong finding is a different class (a
  wrong reference answer, not an ambiguous prompt), stays, and does not
  block this phase — it is recorded in `progress.md` as a carried item.
- **D-C-8 Deploy is a separate step.** The live service picks the change up
  only on restart. After James accepts the review, `scripts/deploy.sh` (run
  by James, or by an agent on James's explicit say-so) redeploys; it is not
  part of the build or the gates.
- **D-C-9 Branch and commit shape.** New branch `1b-ii-shape-label` from
  `master`; feature commit, then the record commit on top; `master`
  fast-forwarded to the record commit; both refs pushed together (the D-A-3
  shape). The checkout currently sits on `m5b-component-attribution` at the
  same commit — leave that branch where it is.
- **D-C-10 No e2e run this phase.** `apps/web/vite.config.ts` builds with
  `emptyOutDir: true` into the `apps/web/dist` the live server serves from
  disk (`apps/server/src/index.ts:33-35`), so `pnpm test:e2e` (which runs
  `pnpm build:web`) empties the running site's bundle for the length of the
  build and leaves it empty if the build fails. The e2e fixtures are
  `mini-efcore` (0 shapes) and `mini-node` (12 shapes, 0 duplicated names),
  so their banks are provably byte-identical under this change and the
  suite cannot observe it. The 1b-i and Phase B records called the rebuild
  "harmless"; that claim is corrected here and carried into `progress.md`.

## Out of scope (recorded, not done)

- The drift-site id template (`ds.drift.*` without file) — cross-stack-mirrors
  phase.
- `selftest.ts` keying on raw text, and its `answersByPrompt` not using
  `normalize()`.
- `rationale` / `subjects` labelling.
- `repoAClient`'s `not-a-member` "reference answer is graded wrong" finding
  (a wrong reference answer; pre-existing; different class).
- `packages/*/test/**` sitting outside every tsconfig project (pre-existing;
  this phase sidesteps it by placing its test under root `test/`).
- M5c-i (serve/render `clientCalls`/`components`) and M5c-ii — next phases.
