# drift-oracle-followups — plan

Close out the four open items the second review left on `corpus-drift-oracle`,
so the oracle's documented behaviour is also its tested behaviour.

Test-only change. No source files. No `packages/extract/` changes.

## Files touched

| File | Change |
|---|---|
| `test/fixtures.ts` | Append a fifth bullet to the silent-misses block (after line 57); add one self-reference warning line |
| `test/oracle.test.ts` | Add 5 tests to the `tablesInDdlText` describe block |
| `feature-research/drift-oracle-followups/plan.md` | This plan |
| `feature-research/drift-oracle-followups/audit.md` | Implementer's audit |

## Item 1 — document the comment-rule false negative

Append a fifth bullet after `test/fixtures.ts:57`, matching the existing `//`-line
style, two-space indent, aligned arrows. The existing four bullets describe
regex-subset misses; this one describes a *comment-rule* miss, so it needs a
leading clause distinguishing it:

```
//   - a real declaration sharing a line with a leading `//`, `/*` or `--`,
//     or on a line whose first non-space character is `*`, is skipped
//     (`/* v2 */ CREATE TABLE foo`) -> no match
```

The skip rule is at `fixtures.ts:77-78`. This direction fails loudly (a table
goes missing, the assertion reddens) rather than hiding a regression — the
bullet must say so, so a future reader does not "fix" it.

## Item 2 — pin the documented misses

Five tests appended to `describe("tablesInDdlText", ...)` (`oracle.test.ts:14-78`),
one per bullet, in the file's existing style — inline literal into
`expect(...).toEqual([...])`, lowercase behavioural name ("finds…", "accepts…",
"ignores…", "is not fooled by…"):

1. `CREATE VIRTUAL TABLE fts USING fts5(...)` -> `[]`
2. `CREATE TABLE main.foo` -> `["main"]`
3. `CREATE TABLE "my table"` -> `["my"]`
4. non-ASCII identifier truncates at the first non-`\w` character
5. `/* v2 */ CREATE TABLE foo` -> `[]` (item 1's new bullet)

These are **characterization tests, not endorsements**. Each gets a one-line
comment saying it pins documented-known-wrong behaviour, so the fix is "update
the bullet and the test together", not "delete the test". That is exactly the
failure the reviewer flagged: the comment going stale silently.

## Item 3 — count floor: decline, and say why

The reviewer is right that `arrayContaining` over 8 distinct names already
implies length >= 8. Keep it anyway. It costs one line, it states the intent
(*this floor is deliberate and is the original eight*) at the site rather than
only in progress.md, and the redundancy is load-bearing if someone later
loosens the name list to `arrayContaining([...fewer])`. Removing a guard from a
drift detector to save a redundant line is the wrong direction.

Recorded as a decision. No code change.

## Item 4 — self-contamination: one comment, not a rewrite

The real risk is a future test being pointed at `fixtures.ts` and passing by
luck. Rewriting the four `CREATE TABLE` tokens out of its own prose (lines 55,
56, 72, 89) would make the documentation worse to read and would not prevent
that. Instead, one line near the silent-misses block: *this file contains
`CREATE TABLE` tokens in its own prose; never point the oracle at it.*

Line 89's token is unsuppressed and matches nothing only because `TABLE` is
followed directly by a backtick — an accident. The comment names it as an
accident, not a guarantee.

## Verification

- `npx vitest run` from repo root — full suite, expect 193 -> 198.
- `PSQ_NO_CORPUS=1 npx vitest run` — expect 138 -> 143. All five new tests are
  hermetic and must pass in this mode.
- Confirm the actual pre-change `oracle.test.ts` count. progress.md claims 15
  tests; a scout counted 14 `it`s across two describe blocks. If it is 14,
  correct progress.md.

## Out of scope

Everything under the original plan's "Out of scope" heading stays hardcoded:
corpus repo D's wide-table property count, the relation lists, the .NET corpus
assertions, and the corpus use in `graph`/`quiz` tests. M9 and beyond are
separate phases.
