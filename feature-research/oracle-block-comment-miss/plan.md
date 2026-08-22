# Close the drift-oracle leftovers

Small, test-and-prose only. Closes items 1, 2 and 3 of the four the
`drift-oracle-followups` phase left open. Item 4 is deliberately not done.

All work is in the **repo-root** `test/` directory, not under a package.

## Background

`tablesInDdlText` (`test/fixtures.ts:68-92`) is a regex oracle that finds
`CREATE TABLE` names in pinned corpus files. It is deliberately not a SQL
parser. Its skip rule is two guards that inspect only the slice from the
previous newline to the match:

```
if (before.includes("--") || before.includes("//") || before.includes("/*")) continue;
if (/^\s*\*/.test(before)) continue;
```

`fixtures.ts:51-62` documents five known misses as a bullet list, and
`test/oracle.test.ts` pins each with a characterization test. Four of the five
are false negatives — they fail loudly, the table goes missing, a corpus
assertion reddens. That is the safe direction.

The hole this phase closes: `fixtures.ts:81-84` documents a miss that fails in
the **dangerous** direction and is pinned by nothing. A `CREATE TABLE` alone on
a line inside a `/* … */` block, on a line with no leading `*`, is captured as a
**real table** — a ghost, silently. It is also documented only in the function
body, not in the bullet list where the other four live.

## Changes

1. `test/oracle.test.ts` — add a characterization test for the block-comment
   slip-through. A multi-line block comment containing a `CREATE TABLE` on its
   own unmarked line; assert the ghost name **is** returned. Place it with the
   other characterization tests (the existing five are at `:79`, `:84`, `:89`,
   `:94`, `:99`). Note the two nearby tests at `:53` and `:58` cover cases that
   *are* correctly ignored — this new one is their opposite and the comment
   should not let a reader confuse them.

2. `test/oracle.test.ts` — add the missing half of bullet 5. Bullet 5 covers two
   suppression paths; only the `/* v2 */ CREATE TABLE foo` half is pinned
   (`:99`). Add one for the second guard: a line whose first non-space character
   is `*` (the JSDoc-continuation case) is skipped.

3. Both new tests must carry the same style of comment the existing five carry:
   they pin **documented known-wrong** behaviour, so the correct response to
   them reddening is "update the bullet and the test together", never "delete
   the test". This is the whole point of the previous phase and must not be
   diluted.

4. `test/fixtures.ts` — add a sixth bullet to the list at `:51-62` for the
   block-comment slip-through, explicitly marked as the one miss that fails in
   the dangerous direction (a ghost captured as real, silently) rather than
   loudly like the other five. The body comment at `:81-84` stays where it is;
   it explains the implementation limit at the site of the code. The bullet is
   the user-facing catalogue and was missing an entry.

5. `test/fixtures.ts` — fix bullet 5's wording (`:59-62`). It says a declaration
   sharing a line with a **leading** `//`, `/*` or `--` is skipped. The rule is
   broader: any of those substrings anywhere earlier on the line suppresses, so
   `count--; CREATE TABLE foo` is skipped too. Behaviour does not change — this
   is wording only.

6. **Not doing**: `audit.md` deviation 2's inaccurate aside about bullet 4 being
   multi-line. It is a historical record of a finished phase, its load-bearing
   claim is true, and the reviewer already judged it not worth a round.

## Constraints

- Do not change `tablesInDdlText`'s behaviour. Every test added here is a
  characterization test that pins what the oracle does **today**, including
  where that is wrong. No regex edits, no comment state machine — the code
  comment at `:83-84` says a full state machine is not worth it for these
  pinned files, and that decision stands.
- `fixtures.ts` carries literal `CREATE TABLE` tokens in its own prose and must
  never be the file the oracle is pointed at; a warning to that effect already
  exists in the file. Any new prose you add there must not break that warning's
  premise or add tokens that would confuse a reader about it.
- Bullets and tests map 1:1 in both directions today, with no orphan either
  way. After this change that must still hold: six bullets, six pinned misses.
  Verify it explicitly and say so in the audit.

## Verification

- `pnpm typecheck` — the only lint gate.
- `pnpm test` and `PSQ_NO_CORPUS=1 pnpm test`. Both must pass. Report before and
  after counts for both (they were 198 full / 143 no-corpus at the end of the
  last phase).
- **Verify every claim against the tree before reporting.** The last phase's
  implementer reported an item done when its `str.replace` had silently no-opped
  against a target string whose line-wrapping did not match the file's bytes.
  For every prose edit here, `git diff` the file afterwards and confirm the
  change is actually present in the working tree. Do not report from your own
  summary of what you intended to write.

## Files touched

| file | change |
|---|---|
| `test/oracle.test.ts` | two new characterization tests |
| `test/fixtures.ts` | new sixth bullet; bullet 5 wording fix |
| `feature-research/oracle-block-comment-miss/audit.md` | **new** — your audit |

Nothing else. No source file outside `test/` is touched, and `README.md` is not
touched — this closes leftovers, it does not complete a milestone.
