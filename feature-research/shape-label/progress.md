# Phase C — 1b-ii: `shapeLabel` at the five DS prompt sites — PROGRESS

**Status: SHIPPED at `744565f` (2026-09-06); reviewer "Ship with the
non-blocking items"; James accepted 2026-09-07.** The feature commit sits on
`1b-ii-shape-label`, branched from `master` at `37960f2` (the Phase B
close-out). This record is committed on top of it, `master` is
fast-forwarded to the record commit, and both refs are pushed together (the
D-A-3 / D-C-9 shape).

Plan: `plan.md` (approved verbatim; one blocking and twelve non-blocking
critique items were folded in before approval). Audit: `audit.md`. Previous
phase record: `../deploy-personal/progress.md`. Spec this phase closed:
"Phase 1b-ii" at the bottom of `../complexity-facts/plan-phase1b.md`.

---

## What shipped

**`psq selftest` exits 0 on full-stack repos.** A shape whose name is
duplicated in the graph is now named `<name> (<file>)` in the prompt text
of the five DS question sites; everywhere a name is unique the bank is
byte-identical to before. Ids, subjects, rationale, options, answers,
grading, selection, extraction, the server, the web UI and the desktop
shell are unchanged.

| Part | Where | What |
|---|---|---|
| Helper | `packages/quiz/src/generate/shape-label.ts` | `shapeLabel(g, shape)`: `shape.name` when unique in `g.shapes` (exact, case-sensitive), else `` `${shape.name} (${shape.file})` ``. Extraction keys shapes by `file:name`, so the labelled form is unique whenever the shape is. No state, no `rng` call. |
| Barrel | `packages/quiz/src/index.ts` | one `export { shapeLabel }` line (for tests and M5c-ii) |
| Five sites | `packages/quiz/src/generate/ds-mcq.ts` (`optionalField`, `collectionField`, `notAMember`), `ds-cloze.ts` (`fieldType`, `discriminator`) | `const label = shapeLabel(ctx.g, shape)` once per question; `${label}` replaces `${shape.name}` in the `prompt` template only |
| Unit tests | `test/shape-label.test.ts` (root `test/`, so `pnpm typecheck` covers it) | five cases: unique → bare; twins → distinct labelled; triplets → all labelled; `MINI_NODE` (12 unique shapes) → every label equals its name; `Foo`/`foo` both bare |
| Hermetic guard | `test/mini-fullstack-csharp.test.ts` | the deliberately-red assertion flipped: `selftest(questions)` is `[]`, the two `field-optional` prompts are pinned exactly (`Which field of ProductDto (client/src/types/product-dto.ts) is optional?` and the `server/Dtos/ProductDto.cs` twin), their ids unchanged; the floor assertions (≥4 questions, ≥2 generators, exactly 2 `field-optional`) stay as the positive control |

### Gates (final; the reviewer re-ran every one from a detached `37960f2` worktree for the before side)

| Gate | Baseline (`37960f2`) | Result |
|---|---|---|
| `pnpm typecheck` | clean | clean |
| `PSQ_NO_CORPUS=1 pnpm test` | 225 passed \| 58 skipped (283) | **230 passed \| 58 skipped (288)**, 0 failed |
| `pnpm test` | 283 passed | **288 passed**, 0 failed |
| `pnpm test:e2e` | 21 passed | **not run** (D-C-10, below) |
| selftest, fixture `mini-fullstack-csharp` | exit 1, 2 findings / 16 q | **exit 0**, 16 q |
| selftest, Northwind full-stack | exit 1, 2 findings / 113 q | **exit 0**, 113 q |
| selftest, Northwind server-only | ok, 97 q | ok, 97 q, bank byte-identical |
| selftest, `repoA` / `repoB` / `repoC` / `repoE` | ok, 213 / 107 / 2 / 56 q | ok, same counts, banks byte-identical |
| selftest, `repoD` | ok, 132 q | ok, 132 q; 4 prompts changed (3 duplicated names) |
| selftest, `repoAClient` | exit 1, 5 findings / 88 q | exit 1, **exactly 1** finding (the pre-existing graded-wrong `not-a-member`); all 4 prompt-ambiguity findings gone; 16 prompts changed (8 duplicated names) |
| bank ids, all roots | — | identical before/after |
| bank non-prompt fields, all roots | — | identical (`jq 'map(del(.prompt))'`) |
| changed prompts | — | only on the four duplicated-name roots; every changed prompt's `(<file>)` is the file in its own id |
| byte-identical control | — | empty `diff -r` on all five zero-duplicate roots |
| `git show --stat 744565f` | — | exactly the six plan paths |
| corpus-name sweep | control 10/10 on the corpus file | 0 genuine across records, commit, `README.md`, `scripts/*` (the 6-letter dictionary-word basename: 42-file precedent at `89448e7`, all hits prose or the fixture's own directory segment) |
| secret sweep | control 2/2 on the env file (pattern file, never a variable) | 0 everywhere, including the commit body |

Measured duplicated shape names per root (the spec's "≥18 / ≥39" were
stale): fixture 1, Northwind full-stack 9, Northwind server-only 0,
`repoA` 0, `repoB` 0, `repoC` 0, `repoD` 3, `repoE` 0, `repoAClient` 8.

---

## Review history

1. **Plan critique**: one blocking (step 0 demanded a clean tree while the
   plan file itself was untracked). Twelve non-blocking, all folded in:
   stale corpus counts replaced with measured ones; the `repoAClient`
   residual named so the build would not stop on it; the unit test moved
   to root `test/` so typecheck covers it; `MINI_EFCORE` (0 shapes) ruled
   out for the all-unique case; D-C-2's justification corrected; the
   ambiguity gate scoped to the five id prefixes; the `--out` layout named;
   the Northwind root citations fixed; the e2e gate dropped (D-C-10); the
   token sweep moved to a pattern file; "one root per process" for the
   measurement script.
2. **Implementation review**: no blocking. Seven non-blocking. Verdict
   "Ship with the non-blocking items". James accepted the feature commit
   as reviewed.

## Deviations from the approved plan

**None in the build** (`audit.md` "Deviations" is empty; the six changed
paths are exactly the plan's table).

Accepted leftovers from the implementation review, deliberately **not**
folded in so the verified commit keeps its SHA:

- `packages/quiz/src/index.ts`: the new export sits at the bottom of the
  barrel rather than beside the other `./generate/*` exports.
- `test/mini-fullstack-csharp.test.ts`: the `field-optional` filter is
  computed twice; one comment mixes past and present tense for the
  pre-change behaviour (every claim in it is true).
- `test/shape-label.test.ts`: case 1's `not.toBe(labelled)` is implied by
  the `toBe(name)` above it (the plan asked for it).
- `audit.md`: one baseline row originally quoted corpus shape names and
  answer values beyond the plan's "generator + id" rule — trimmed before
  this record was committed; its case-sensitive count for the
  dictionary-word basename in `README.md` read 5 where the reviewer's
  case-insensitive sweep read 6 (an identifier in CamelCase prose;
  classification unchanged).

## Decisions

Full text in `plan.md`. The ones later phases must not undo:

- **D-C-1** label form `<name> (<file>)`, exact case-sensitive uniqueness,
  file rather than module or language.
- **D-C-2** prompt only; ids are persisted keys and never change;
  `subjects` and `rationale` stay bare.
- **D-C-3** the two drift sites (`fieldDrift`, `dtoOnlyField`) stay bare;
  their defect is the id template without a file, for the
  cross-stack-mirrors phase.
- **D-C-4** `selftest.ts` keys on raw prompt text by design; do not add
  `normalize()` there.
- **D-C-5** helper lives next to its callers and is exported from `@psq/quiz`.
- **D-C-7** full-stack banks are now **formally trusted** (rule 5 of the
  1b-i record is satisfied: selftest passes on the fixture and Northwind).
- **D-C-8** deploy is a separate, James-authorised step.
- **D-C-10** no e2e run when the change cannot reach the e2e fixtures —
  see the production note below.

---

## What the next phase needs to know

- **The live service has not been redeployed.** `com.psq.server` still
  runs the `37960f2` code it loaded at its last start. Because the
  LaunchAgent runs TypeScript from this checkout via `tsx`, the **files on
  disk are already at `744565f`**, so any restart (a crash, a reboot,
  `scripts/deploy.sh`) picks the change up. To deploy on purpose:
  `scripts/deploy.sh` (James, or an agent on James's say-so — D-C-8).
- **`pnpm test:e2e` is not harmless on this checkout.** Phase 1b-i and
  Phase B records called the `apps/web/dist` rebuild harmless; the plan
  critique corrected that: `apps/web/vite.config.ts` builds with
  `emptyOutDir: true` into the directory the live server serves from disk
  (`apps/server/src/index.ts:33-35`), so the served bundle is empty for the
  length of the build and stays empty if the build fails. Run e2e only when
  a phase touches web or server code, and say so in the plan; if a phase
  must run it, run it right before `scripts/deploy.sh`.
- **Prompt text is now scope-dependent.** The same question id renders a
  bare name under a server-only root and a labelled name under the
  full-stack root of the same repo. Ids are stable, so persisted answer
  history is keyed correctly, but a stored prompt string can drift by
  extraction scope. Nothing persists prompt text today; if M5c or later
  does, key on id, never on prompt.
- **Two sweeps before every commit**, positive control first — unchanged
  from Phase B, with one refinement: the host/token sweep uses a 600
  pattern file (`grep -F -f`), never a shell variable, so `set -x` or an
  error line cannot copy a value into a record. One corpus basename is a
  6-letter dictionary word; classify its hits by the dictionary check and
  the 42-file precedent at `89448e7`, never by quoting it.
- Carried forward, unchanged by this phase:
  - **`repoAClient` exits 1 on selftest** with one `not-a-member` question
    whose reference answer grades wrong (pre-existing, a wrong reference
    answer, not ambiguity). Different class; not yet planned.
  - **Drift-site ids** (`ds.drift.*.${entity.name}.${shape.name}`, no file)
    collide if two same-named shapes ever mirror one entity — unreachable
    while TS shapes carry `mirrors: null`; the cross-stack-mirrors phase.
  - **`clientCalls` / `components` are extracted but never surfaced** (M5c).
  - `apps/server/test/api.test.ts:213` flaked once in Phase B (~13 runs);
    not seen since.
  - **No Dockerfile, no CI.** The corpus config is the only copy of the
    ground truth.
  - `packages/*/test/**` is outside every tsconfig project (this phase
    sidestepped it by placing its test under root `test/`).
- **Next: M5c-i** — serve and render `clientCalls` / `components` (row D of
  the MVP table in `../green-and-push/progress.md`). Then **M5c-ii**, one
  comparative question generator, which should use `shapeLabel` from
  `@psq/quiz` for any shape it names. Start by reading this file, then
  scout `apps/server/src/app.ts` and `apps/web/src/views/*` for how the
  existing graph parts reach the UI.
