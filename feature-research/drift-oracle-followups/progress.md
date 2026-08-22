# drift-oracle-followups — progress

Status: **shipped**, reviewed twice (second review took two rounds).
Commits: `8be05a7` (pin the silent misses), `d6f0e50` (literal é, em-dashes,
audit correction).

This closes the four open items left by `corpus-drift-oracle`. That phase's
progress.md is now history; start from this file.

## What shipped

The oracle's documented "silent misses" are now tested behaviour, not just a
comment. Each bullet in the list at `test/fixtures.ts:51-62` has a
characterization test in `test/oracle.test.ts`: `CREATE VIRTUAL TABLE` -> none,
`main.foo` -> `main`, `"my table"` -> `my`, a non-ASCII identifier truncating
at the first non-`\w` character, and `/* v2 */ CREATE TABLE foo` -> none.
Bullets and tests map 1:1 with no orphan in either direction, so a future
"fix" to the regex cannot leave the docs stale without reddening a test.

A fifth bullet was added for a miss the comment rule introduced and never
recorded, plus a warning that `fixtures.ts` carries `CREATE TABLE` tokens in
its own prose and must never be the file the oracle is pointed at.

Test counts 193 -> 198 full, 138 -> 143 under `PSQ_NO_CORPUS=1`.

## Decisions worth not relitigating

- **The count floor stays**, though `arrayContaining` over eight distinct names
  already implies length >= 8. It states at the site that the eight are
  deliberate. Removing a guard from a drift detector to save a redundant line
  is the wrong direction.
- **`fixtures.ts` keeps the `CREATE TABLE` tokens in its own documentation.**
  Rewriting them out would make the prose worse and would not stop a future
  test being pointed at the file. A warning comment addresses the real risk.
- **The new tests are characterization, not endorsement.** Each carries a
  comment saying it pins documented-known-wrong behaviour, so the correct fix
  is "update the bullet and the test together", never "delete the test".
- **The `--` inside the bullet documenting the skip rule is verbatim.** It
  names the token; it is not prose. Only prose dashes became `—`.

## Open, deliberately not done

1. **The one dangerous-direction miss is still untested.** `fixtures.ts:80-84`
   documents that a `CREATE TABLE` on its own line inside a multi-line block
   comment with no leading `*` still slips through — a ghost captured as a
   *real* table. Every other documented miss is a false negative that reddens
   loudly; this one is a silent false positive, and it is the remaining hole in
   this phase's own goal. **Best first item for whoever picks this up.**
2. The fifth bullet says a declaration "sharing a line with a **leading** `//`,
   `/*` or `--`" is skipped. The rule is broader: any of those substrings
   anywhere earlier on the line suppresses, so `count--; CREATE TABLE foo`
   is skipped too. Wording, not behaviour.
3. The `*`-continuation half of the fifth bullet has no test. Only the
   `/* v2 */` half is pinned.
4. `audit.md` deviation 2 says the fifth bullet "is multi-line prose (as
   bullet 4 already is)". Bullet 4 is a single line. The load-bearing claim —
   that bullet 4 already breaks the aligned-arrow pattern — is true. Reviewer
   judged it not worth another round.

Everything under the original plan's "Out of scope" heading is still
hardcoded: corpus-repo-d's `tasks.properties` length 15, the relation lists, the
.NET corpus assertions, and the corpus use in `graph`/`quiz` tests.

## Next phase: M9

`README.md` "Next" sets the order, and the drift-oracle follow-ups were item 1.
With them closed, **M9 is next**: finish the 3D entity city that M8 shipped.

What exploration already established, so the next context need not rediscover
it:

- M8 shipped `packages/graph/src/layout3d.ts` plus the `scene3d` / `webgl` /
  `EntityCity` renderer, through phase 2a. **`EntityCity` is imported by
  nothing**, so the city does not render today.
- M9 is two things: wire the city into the web UI, and replace the hardcoded
  colours flagged at `apps/web/src/lib/scene3d.ts:12` with theme-derived ones.
- **There is no spec for M9 anywhere in the repo** — no `docs/` or `design/`
  directory exists. The README row and the inline comments are all there is.
  Expect to spend the explore step deciding what "wired in" means before
  planning.
- `apps/web` is Vite / React 19 / Tailwind v4 / shadcn.

After M9 the order is M5 (React clients — `packages/extract/src/node/routes.ts`
is complete and tested, waiting on its client side), then M6, then M7.

## Process note

The implementer reported an item as done when it had not landed: its edits used
`str.replace` against target strings whose line-wrapping did not match the
file's bytes, so the replacements silently no-opped. The reviewer caught it by
diffing against HEAD instead of reading the summary. Worth telling the
implementer to verify claims against the tree before reporting, on any task
where it edits prose it also quotes.
