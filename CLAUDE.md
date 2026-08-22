# psq — working rules

These are hard rules, not style notes. Break one and the tool stops meaning
anything.

## 1. No model ever grades an answer

Every question carries its own grader inputs: a choice index, canonical text
plus aliases, or a reference SQL query. An agent may write a question's prose.
An agent may never decide whether an answer is right.

If a generated question cannot be graded deterministically, drop it. Do not add
a model fallback.

## 2. A fact must come from the graph

Generators read `EntityGraph`. They never re-parse source and never infer a
fact at question time. If a fact is not in the graph, no question may assert it.

Add the fact to extraction first, with a test against ground truth psq did not
produce (an EF migration snapshot, a live schema).

## 2a. Read a schema by running it

The DDL reader does not parse SQL. It executes every `CREATE TABLE` literal into
a throwaway in-memory database and reads `sqlite_master` and the pragmas back.
The authority on what a schema means is SQLite. Do not add a SQL parser.

TypeScript is read through the compiler API with a `Program` and a checker, for
the same reason: `Omit<X, "a"> & { … }` and a zod `.extend()` chain resolve
correctly or not at all, and "not at all" must be a warning, never a guess.

`strictNullChecks` is forced on for every program psq builds, including over a
repo whose own tsconfig turns it off. Without it zod's inferred types collapse —
every field reads optional and every `.nullable()` loses its null — so psq would
report drift on fields that are fine and miss the ones that are not.

Nothing may `import "node:sqlite"` directly. Use `packages/extract/src/sqlite/driver.ts`;
Vite resolves the bare specifier to a package named "sqlite" and the failure
appears only under vitest.

## 3. Warn, never guess

The C# reader is deliberately partial. When it meets a construct it does not
know, it appends to `warnings` and moves on. A missing fact costs one question.
A guessed fact costs the premise of the tool.

`psq graph` prints warnings. Treat a new warning as a bug.

## 4. Mark derived facts as derived

`FactSource` records how psq came to know something: `fluent`/`attribute` (the
repo wrote it in EF's configuration API), `declared` (the repo wrote it in raw
DDL), `convention` (the framework implied it), `inferred` (psq worked it out
from naming and says so).

Never present a derived value as if someone had written it. A delete-behavior
question may only be asked about `fluent` or `declared`.

Every relation in a raw-DDL repo is `inferred`, because no Node repo psq reads
declares a foreign key. Inference refuses more than it accepts: a primary-key
name shared by many tables is a house style rather than a reference, and two
tables keyed on the same column need a resolvable owner or psq emits a warning
and no edge.

## 4a. A pairing is a claim, and needs evidence

A shape mirrors a table only when the names reduce to the same concept AND the
fields substantially overlap. A wrong pairing invents drift that is not there,
which is worse than no drift question at all.

Drift is compared by name, and the prompts say so. `published_ts` and
`publishedAt` are a gap in both directions: psq can see the names differ and
cannot see whether a mapper reconciles them. `null` and `undefined` are one
axis — treating them apart reports drift on every nullable column.

## 5. Every question must be failable

`psq selftest` grades each question with its reference answer, which must pass,
and with a mutation, which must fail. Run it before trusting a bank. A
generator whose questions cannot be failed is broken, not hard.

## 6. A graded query may only read

The SQL grader executes user input. It accepts a single `SELECT` or `WITH` and
nothing else — a positive allowlist, never a blacklist of dangerous keywords.
`node:sqlite` allows `ATTACH` even read-only, and silently runs only the first
of several statements, so neither can be relied on to stop anything.

This holds even though psq runs locally today. The moment it is hosted, this is
the only component that runs anything a user typed.

## 7. Determinism is a feature

Same repo, same seed, same questions in the same order. Use the seeded `rng`
from `@psq/quiz`. Never call `Math.random`. A quiz that cannot be reproduced
cannot be argued with.

## 8. Target repos are read-only

Extraction never writes into a project it reads. psq writes only where you
point it with `--out` (accepted by `graph` and `questions`); the `.psq/`
directory is just the README's example path. `psq export` is the M7 command
for a packaged export and does not exist yet.

## Commands

```bash
pnpm typecheck                 # the only lint gate
pnpm test                      # hermetic
PSQ_NO_CORPUS=1 pnpm test      # hermetic, ignores local repos
pnpm test:e2e                  # real API, real bundle, real browser
pnpm psq selftest --repo <p>   # before trusting any bank
```

The bank is composed in one place, `packages/quiz/src/bank.ts`. The CLI and the
server both call it. Adding a generator anywhere else makes the two shells
disagree about what psq asks.
