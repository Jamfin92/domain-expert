# Corpus drift oracle — make the CREATE TABLE assertions self-updating

## Context

`packages/extract/test/node.test.ts` validates the Node extractor against real repos on this
machine (`corpus-repo-d`, `corpus-repo-e`, `corpus-repo-c`). Two of its tests hardcode the full list of
tables those repos declare. Those repos are live and actively developed, so the lists go stale
and the suite fails for a reason that has nothing to do with psq.

This already happened once: corpus-repo-d added a ninth table, `model_variant_eta`, and
`node.test.ts:14` failed until commit `424c321` updated the literal by hand. It will happen
again on the tenth table.

The fix: derive the expected table names from a `CREATE TABLE` regex over the schema source, so
the assertion tracks the corpus automatically. Keep a hand-written floor so the test cannot pass
vacuously when both sides break the same way.

## Ground truth (verified against the current code on 2026-08-22)

**How the extractor gets its table names.** It does not parse DDL. `collectDdl`
(`packages/extract/src/node/ddl.ts:34`) walks every non-test TS source, collects every string or
no-substitution template literal matching `/\bCREATE\s+TABLE\b/i`, and `readSchema` **executes**
them in an in-memory SQLite, then reads `sqlite_master` (`ddl.ts:99`). SQLite is the authority on
what the DDL means. This is why the oracle is genuinely independent: a regex over source text and
a live SQLite catalog are two different readings of the same file.

**Ordering.** Table names are sorted at `ddl.ts:101`, entities again at `ddl.ts:359`, both
alphabetical. A regex yields source order, so both sides must be sorted before comparing.

**One DDL file per corpus repo.** Confirmed by grep over non-test `.ts`/`.js`:

| Corpus | DDL file | Tables | Delivery |
|---|---|---|---|
| `corpus-repo-d` | `server/src/state/db.ts` | 9 | one inline `db.exec(\`…\`)` at line 15 |
| `corpus-repo-e` | `src/db.ts` | 5 | `export const SCHEMA = \`…\``, exec'd ~90 lines later |
| `corpus-repo-c` | none | 0 | negative fixture — no DDL anywhere |

**Two literals the extractor deliberately refuses**, which a naive whole-repo regex would wrongly
pick up: DDL under a test/fixtures path (`isTestFile`, `packages/extract/src/files.ts:53`) and
DDL in a template literal *with substitutions*, which produces a warning instead of a table
(`ddl.ts:56-62`).

**`CORPUS` values are bare repo-root strings** consumed by six test files
(`node.test.ts`, `dotnet.test.ts`, `fluent.test.ts`, `structure.test.ts`,
`packages/graph/test/graph.test.ts`, `packages/quiz/test/quiz.test.ts`). Changing their shape
would touch all six.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Oracle scope | One **declared DDL file per corpus entry**, not a repo-wide scan | A repo-wide regex would have to reimplement `isTestFile` and the substituted-template refusal — that is reimplementing the extractor, which makes the oracle circular rather than independent |
| `CORPUS` shape | **Unchanged.** Add a separate `CORPUS_DDL` map derived from it | Keeps the other five test files untouched |
| Assertion strength | Oracle equality **plus** a hand-verified stable core **plus** a count floor | The oracle alone can pass vacuously; see Risks |
| Missing / empty DDL file | Helper **throws** | Otherwise a moved file makes both sides `[]` and the test passes green while checking nothing |
| Comment handling | Skip a match with `--` earlier on its own line; do not strip comments globally | A global `--` strip would eat TS decrements (`count--;`) and corrupt the file |
| Helper shape | Pure `tablesInDdlText(text)` + thin `tablesDeclaredIn(path)` | The pure core is unit-testable with no corpus present |

## Design

Add to `test/fixtures.ts`:

```ts
/** The file that holds each corpus repo's schema. Pinned, so the oracle reads
 *  one known file instead of reimplementing the extractor's file selection. */
export const CORPUS_DDL = {
  corpus-repo-d: resolve(CORPUS.corpus-repo-d, "server/src/state/db.ts"),
  corpus-repo-e: resolve(CORPUS.corpus-repo-e, "src/db.ts"),
} as const;

const CREATE_TABLE_NAME =
  /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?(\w+)[`"\]]?/gi;

/** Table names a human would find by reading the file, sorted. The independent
 *  half of the corpus assertion: the extractor runs the DDL through SQLite,
 *  this just reads the text. */
export function tablesInDdlText(text: string): string[] { /* see Stage 1 */ }

/** Throws when the file is missing or declares nothing, so a moved schema
 *  fails loudly instead of comparing [] to []. */
export function tablesDeclaredIn(path: string): string[] { /* see Stage 1 */ }
```

Each corpus table test then becomes three assertions:

```ts
it("reads every table declared in the schema file", () => {
  const names = g.entities.map((e) => e.name);
  // The oracle: text-read names must equal SQLite-read names.
  expect(names).toEqual(tablesDeclaredIn(CORPUS_DDL.corpus-repo-d));
  // The floor: hand-verified, must never regress even if the oracle breaks too.
  expect(names).toEqual(expect.arrayContaining([
    "approvals", "audit", "chat_messages", "chats",
    "packets", "settings", "spend", "tasks",
  ]));
  expect(names.length).toBeGreaterThanOrEqual(8);
});
```

Note the floor is the **original eight**, not nine — it is the set known stable, and a table
corpus-repo-d might later drop should not be encoded as a permanent requirement.

## Stage 1 — The helper, hermetic

Write `tablesInDdlText` and `tablesDeclaredIn` in `test/fixtures.ts`.

`tablesInDdlText` walks `CREATE_TABLE_NAME` matches over the raw text. For each match, take the
slice from the previous `\n` to the match index; if it contains `--`, skip the match (a
commented-out `-- CREATE TABLE old_thing` is not a declaration). Dedupe, sort, return.

`tablesDeclaredIn` reads the file with `readFileSync`; throws `` `no DDL file at ${path}` `` if
absent, and `` `${path} declares no CREATE TABLE` `` if the result is empty.

Cover it in a new `test/oracle.test.ts`, which needs no corpus and must pass under
`PSQ_NO_CORPUS=1`: plain `CREATE TABLE x`, `IF NOT EXISTS`, `TEMP`/`TEMPORARY`, a quoted name
(`"x"`, `` `x` ``, `[x]`), a `-- CREATE TABLE ghost` line that must be ignored, a `count--;` line
on which a later real declaration must still be found, duplicate declarations deduped, output
sorted, and both throw cases.

## Stage 2 — Wire it into the corpus tests

Rewrite two tests in `packages/extract/test/node.test.ts`:

- `:14` corpus-repo-d — currently `"reads all nine tables from one inline template literal"`
- `:77` corpus-repo-e — currently `"reads five tables from a constant exec'd ninety lines later"`

Keep each test's existing name-and-premise flavour, since the delivery mechanism is the thing
under test. Keep corpus-repo-e's `expect(g.warnings).toEqual([])`. Its stable core is
`feed_items`, `feed_state`, `meta`, `quotes`, `tickers` with a floor of 5.

Leave the `corpus-repo-c` block alone — it asserts zero entities, which is the point of the
fixture and cannot drift upward without a real code change.

Update the file's header comment (`:5-9`), which currently says these tests "assert the counts a
person can check by opening the file and counting CREATE TABLE" — that is now what the oracle
does, with the hand-checked core as the backstop.

## Stage 3 — Verify

```
pnpm exec tsc --noEmit
pnpm exec vitest run                  # expect 12 files, 178+ tests, all passing
PSQ_NO_CORPUS=1 pnpm exec vitest run  # corpus tests skip; oracle.test.ts still runs
```

Note the environment: node is managed by **fnm** and is not on the non-interactive `PATH`. Run
every command through a login shell — `zsh -lic '…'` — or `pnpm`/`node` will be "command not
found".

## Files touched

| File | Change |
|---|---|
| `test/fixtures.ts` | Add `CORPUS_DDL`, `tablesInDdlText`, `tablesDeclaredIn`; add `readFileSync` import. `CORPUS` and `hasCorpus` unchanged |
| `test/oracle.test.ts` | **New.** Hermetic coverage of the two helpers |
| `packages/extract/test/node.test.ts` | Rewrite the corpus-repo-d (`:14`) and corpus-repo-e (`:77`) table tests; refresh the header comment |
| `feature-research/corpus-drift-oracle/audit.md` | **New.** Implementer's audit |

Nothing in `packages/extract/src/**` changes. This is a test-infrastructure change only; if a
production file needs editing, stop and report instead.

## Risks — what this does NOT catch

1. **A table the extractor and the regex both miss.** If a schema moves to a file
   `CORPUS_DDL` does not name, the oracle reads the old file and the comparison is meaningless.
   Mitigated by the throw-on-missing and by the stable-core assertion, which fails if a known
   table disappears.
2. **The oracle is weaker than what it replaces.** It checks table *names* only. Column counts,
   keys and relations stay hardcoded — see Out of scope.
3. **A wrong-but-consistent regex.** Covered by `oracle.test.ts` against literals whose answer is
   obvious by eye.

## Out of scope

These corpus assertions are drift-prone in the same way and are **deliberately left alone**;
raise them as a follow-up if they start failing:

- corpus-repo-d: `tasks.properties` length 15, `tasks.keys`, the 5-relation list, the "6 tables" warning
  text, the 2-route list, the `Task`/`WorkerUsage`/`TaskRow` shape pairs
- corpus-repo-e: the 3-relation list, `EventClass` members 8, `routes` length 6,
  `SerializedRefreshDecision` fields
- All .NET corpus assertions in `dotnet.test.ts`, `fluent.test.ts`, `structure.test.ts`
- Corpus use in `packages/graph/test/graph.test.ts`, `packages/quiz/test/quiz.test.ts`
- Any change to the shape of `CORPUS`
