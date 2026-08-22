# oracle-block-comment-miss — progress

Status: **shipped**, accepted. Reviewed twice (one fix round).

Closes items 1, 2 and 3 of the four left open by `drift-oracle-followups`.
That phase's progress.md is now history for the oracle work; start from this
file. Item 4 was deliberately declined and stays declined.

## What shipped

The drift oracle's known misses are now a complete, accurate catalogue with a
1:1 test behind every entry.

- **The dangerous miss is pinned.** A `CREATE TABLE` alone on an unmarked line
  inside a `/* … */` block is captured as a **real** table. Every other
  documented miss is a false negative; this one silently invents a table. It
  was documented only in the function body and pinned by nothing.
- **Bullet 5 was split into its two real rules** — the shared-line comment
  opener and the `*`-continuation — because they are two separate guards in the
  code. The `*` half had no test.
- **A seventh bullet** was added for the ghost, moving it into the catalogue.
- Final state: **7 bullets, 7 pinned tests**, no orphan in either direction,
  and every test names its bullet by ordinal so the reverse walk works.
- Counts 198 -> 200 full, 143 -> 145 under `PSQ_NO_CORPUS=1`.

`tablesInDdlText` is **byte-identical**. `git diff` filtered to non-comment
lines in `fixtures.ts` is empty. Every test added is characterization: it pins
what the oracle does today, including where that is wrong.

## The real work was the prose, and two rounds went to it

Both review rounds found zero problems with the code and two sentences that
were false against the tree. Worth internalising, because this phase exists to
make the catalogue true:

- **"nothing reddens" was wrong.** The oracle's only consumers are
  `packages/extract/test/node.test.ts:19` and `:87`, both
  `expect(names).toEqual(tablesDeclaredIn(...))`. A ghost fails that `toEqual`
  as loudly as an omission. The genuine danger is **misattribution**: the diff
  reads as "psq missed a table" and sends the next maintainer into the
  extractor when the invented name came from the oracle. That is what the file
  says now, and it is a better reason for the bullet to exist than the one
  originally written.
- **"every such test names its bullet" was true of 3 of 7.** Fixed by adding
  ordinals rather than deleting the claim.

Chasing those corrected an **inherited** falsehood too. The block was headed
"Known *silent* misses" and claimed four of them fail loudly. Checking the
extractor's own gate (`packages/extract/src/node/ddl.ts:18`,
`/\bCREATE\s+TABLE\b/i`) showed `CREATE VIRTUAL TABLE` evades that regex as
well, so bullet 1 is the only one that can pass quietly. Header is now "Known
misses" and the claim matches.

## Decisions worth not relitigating

- **Bullet 5 was split, not re-scoped.** The inherited invariant was strict 1:1;
  giving one bullet two tests would have quietly weakened it. Two guards, two
  rules, two bullets, two tests.
- **No regex change, no comment state machine.** The guard-site comment says a
  full state machine is not worth it for these pinned files. That stands. Every
  new test pins current behaviour; the correct response to one reddening is
  "update the bullet and the test together", never "delete the test".
- **`audit.md` deviation 2 from the previous phase stays unfixed** (item 4). It
  is a historical record of a finished phase, its load-bearing claim is true,
  and editing a past audit to be more accurate about itself is churn.

## Open

1. **One-word accuracy fix, accepted as-is.** `test/fixtures.ts:69-71` hedges
   correctly with "bullet 1 ... **can** pass quietly", but the trailing clause
   says "so both sides omit the table" without carrying the hedge. The gate is
   applied per string literal (`packages/extract/src/node/ddl.ts:50`, `:54`),
   not per statement, so an fts5 declaration sharing a literal with real tables
   does reach `sqlite_master` and redden. "so both sides *can* omit" closes it.
   Reviewer judged it not worth a round; user accepted the phase with it open.
2. `test/fixtures.ts:81`'s self-reference warning enumerates the file's
   `CREATE TABLE` tokens as "the bullets above, plus one unsuppressed token in
   an error message below". There is now also one in prose at `:70`. It is
   suppressed twice over so the warning's premise holds, but the enumeration
   was already loose (`:99` was outside it) and is now one line looser.

## Next: M9a

M9 was one milestone; a plan review split it in two. Both plans are written.

**`feature-research/m9a-wire-city/plan.md` — ready to implement.** Wire the
dead `EntityCity` into the Dashboard behind a 2D/3D toggle, keeping the
hardcoded palette untouched. Key facts already established: the server route
`GET /api/repos/:id/layout3d` (`apps/server/src/app.ts:105-112`) and the client
binding `api.layout3d(id)` (`apps/web/src/lib/api.ts:175`) **already exist and
are called by nothing**, so there is no server work. The sixth fetch must carry
its own `.catch(() => null)` — the Dashboard loader is all-or-nothing and a
3D-only failure would otherwise blank the whole repo view. The e2e suite is
`e2e/psq.e2e.ts`, **not** under repo-root `test/`.

**`feature-research/m9b-theme-colours/plan.md` — deliberately not ready.** It
holds two findings that must not be lost:

- The obvious token mapping produces a **white-on-white city in light mode**:
  `--graph-node` is `oklch(1 0 0)`, the renderer clears transparent, and `--card`
  is white. The 2D diagram survives those tokens only because an SVG node is
  *stroked*. Shipping M9a first makes this visible on screen so it can be
  answered by looking rather than guessed at — that is why the split exists.
- A **React ordering trap**: `ThemeProvider` flips the `.dark` class in a
  passive `useEffect` (`apps/web/src/lib/theme.tsx:57-59`) and is the *parent*
  of any consumer. Both effect phases run child->parent, so a consumer reading
  tokens on either effect type sees the **old** theme and never re-fires. It
  looks correct on mount only because `index.html` sets the class pre-paint,
  so it survives casual manual testing and ships broken.

After M9 the order is M5 (React clients — `packages/extract/src/node/routes.ts`
is complete and tested, waiting on its client side), then M6, then M7.

## Process note

The previous phase's implementer reported prose edits as done when its
`str.replace` had silently no-opped. This phase's implementer was told to verify
against `git diff` before reporting and did so consistently — that failure did
not recur. Keep the instruction.

The failure mode that *did* recur is different and worth naming: **an
implementer escalating a plan's careful wording into a stronger, checkable, and
false claim.** The plan said "silently"; the implementer wrote "silently, and
nothing reddens". Reviewing prose against the tree as hard as code caught it
twice.
