# psq — Ps and Qs

Read a codebase. Then prove you know it.

psq extracts the structure of a project, generates questions whose answers it
already holds, and grades your answers. It reads .NET / EF Core projects and
Node backends whose schema is raw SQL. React clients come next.

## Why this exists

You cannot hold a large codebase in your head by reading it. You find out what
you actually know when something asks you and checks the answer.

psq does two jobs from one extraction:

- **You** get an entity graph, a diagram, and a graded quiz.
- **An agent** gets the same graph as JSON it can index, plus a domain brief.

One design rule shapes everything here:

> Every question ships with a grader that needs no model.

An agent may write the prose of a question. It may never decide whether an
answer is right. A model that both writes and grades measures nothing.

## Status

| Milestone | State |
|---|---|
| M1 — entity graphs, multiple choice | done |
| M2 — short answer, cloze, SQL over a seeded database | done |
| M3 — server, web UI, Electron shell | done |
| M4 — Node backends, data structures | done |
| M5 — React clients, cross-layer links | planned |
| M6 — agent-authored questions, STE checks | planned |
| M7 — working memory export | planned |

## Install

```bash
pnpm install
```

Node 24 or later. No native build step.

## Use

```bash
# extract the entity graph
pnpm psq graph --repo ../corpus-repo-a/server/src/corpus-repo-a.Api

# write the graph and a mermaid diagram to disk
pnpm psq graph --repo <path> --out .psq

# build the question bank
pnpm psq questions --repo <path>

# prove every question can pass AND fail
pnpm psq selftest --repo <path>

# take a quiz
pnpm psq quiz --repo <path> --n 10
```

Add `--seed <n>` to fix the generator seed, `--rows <n>` to change how many rows
are seeded, and `--section entity,ds` to narrow the bank. The same repo and seed
always give the same questions in the same order, and the same database down to
the byte.

psq works out what kind of project it is looking at from what is on disk — a
`.csproj` or `.cs` file means the EF reader, a `package.json` or TypeScript
source means the Node reader, and neither means an empty graph with a warning
that says what was looked for.

## The app

```bash
pnpm dev:all      # API on 8092, UI on 5173, one Ctrl-C stops both
pnpm build:web    # then: pnpm dev:server serves the UI itself on 8092
pnpm desktop      # the Electron app
```

One core, one UI, two shells. All the work lives in `packages/*`; the CLI, the
server and the desktop app are consumers.

| Shell | Runs | Gets |
|---|---|---|
| `apps/server` | localhost, or hosted later | the JSON API |
| `apps/web` | browser, both shells | the React UI, one codebase |
| `apps/desktop` | Electron | folder picker, open-in-editor, dock presence |

Electron boots the same express app on a free port and points a window at it.
The UI feature-detects the bridge — `window.psq?.pickFolder()` exists there and
is absent in a browser, which falls back to a path input. Electron is about a
hundred lines, not a second application.

Why not Electron alone: **an Electron app cannot be served**, which forecloses
running psq in the cloud later. Why not the browser alone: a browser cannot
return a real filesystem path, and pointing psq at a repo is the first thing
you do. Offline does not separate the two — a localhost server is offline.

The server grades every answer. Questions reach the client without their
answers, so the score means something.

## SQL questions

A schema alone cannot answer "which students have a B+ GPA". That needs rows.

So psq builds a SQLite database from the extracted schema, seeds it with a
fixed seed, and grades by **running** your query beside its own and comparing
result sets. Your real database is never touched.

```
Return the Name of every Student whose Gpa is a B+ (at least 3.3 and below 3.7).
Give the two bounds, separated by a comma.

    SELECT "Name" FROM "Students"
    WHERE "Gpa" >= ____ AND "Gpa" < ____
    ORDER BY "Name"

> 3.3, 3.7
correct — 6 row(s) match
```

Because it compares results and not text, a differently written query still
passes. Different aliases, different whitespace, a different join order: all
correct if the rows match. Row order is ignored unless the reference query has
an `ORDER BY`, and column names are ignored entirely.

### The grader runs your SQL, so it is sandboxed

Locally the blast radius is one throwaway database. Hosted, it would be the
only component that runs user input at all, so it is locked down now rather
than later. A graded query must be a **single SELECT or WITH**. That is a
positive allowlist, not a blacklist of dangerous words, so `ATTACH`, `PRAGMA`,
`INSERT` and `DROP` are all refused at the door.

Two behaviors of `node:sqlite` on Node 24 shaped this, both measured:

- `ATTACH` is allowed even on a read-only connection. Without the allowlist, a
  query could read any other SQLite file on the machine.
- `prepare("SELECT 1; DROP TABLE t")` succeeds but silently runs only the first
  statement. Safe, but it would hide half of what you typed, so psq refuses
  multiple statements instead of quietly ignoring them.

## Node backends

A Node service usually writes its schema as a string and hands it to SQLite. So
psq does the same: it collects every `CREATE TABLE` literal in the repo, runs
them into a throwaway in-memory database, and asks SQLite what it got.

That is not a shortcut, it is the point. Composite primary keys, comments
between columns, `AUTOINCREMENT`, `DEFAULT '[]'` and `DESC` in an index all come
out right because the authority on what the DDL means is SQLite, not a regular
expression psq wrote. It finds the schema whether it is written inline in
`db.exec(...)` or bound to a constant and executed ninety lines later.

TypeScript is read with the TypeScript compiler API rather than a hand-written
reader. The checker resolves what syntax cannot:

```ts
export type SerializedRefreshDecision = Omit<
  RefreshDecision, 'weight' | 'effectiveMove' | 'hoursSinceRefresh'
> & { weight: number | 'Infinity'; /* … */ }
```

That is six fields. Reading the syntax alone reports three, and a question built
on three is wrong rather than merely absent. The same applies to zod: a schema's
inferred type is read through zod's own type machinery, so `.extend()`,
`.optional()` and a schema imported from another file all resolve without psq
modelling any of them.

### Nobody declares a foreign key

Neither of the Node repos psq is measured against declares a single
`FOREIGN KEY`. Relationships live in naming, so psq infers them — and marks
every one `inferred`, draws it dashed, and never asks a delete-behavior question
about it.

Two rules, in descending order of evidence. A column named `<table>_id` where a
table of that name exists. And a column whose name is another table's sole
identifying column, which is how a schema keyed on `symbol` rather than `id`
links up at all.

Both refuse more than they accept:

- Six tables that each call their primary key `id` are using a house style, not
  lending each other a key. psq says so in a warning and infers nothing from it.
- When two tables are keyed on the same column, the one carrying more attributes
  under that key owns it and the other is an extension of it. An exact tie is
  not resolvable, and psq says that rather than picking.

| Repo | Tables | Relations | Warnings |
|---|---|---|---|
| `corpus-repo-d` | 8 | 5 | 2, both naming the thing psq refused to guess |
| `corpus-repo-e` | 5 | 3 | 0 |

## Drift

One extraction holds a repo's tables and its declared shapes at once, which
makes a question possible that neither file can be read to answer:

```
CountyDto mirrors County. Which column of County has no field
of that name on CountyDto?

  a) LogoUrl   b) ContactPhone   c) CreatedAt   d) IsActive
```

A shape is paired with a table only when the names reduce to the same concept
*and* the fields substantially overlap. `TaskRow`, `tasks` and `Task` are one
thing; a `Market` interface that happens to sit near a `markets` table is not,
and psq leaves it unpaired rather than inventing drift.

The comparison is by name, and the questions say so. Where a table has
`published_ts` and its DTO has `publishedAt`, psq reports a gap in both
directions — because that is what it knows. It can see the two names do not
match; it cannot see whether a mapper reconciles them, and claiming the field
was dropped would be asserting the half it did not read.

`null` and `undefined` are one axis. A row type saying `project_id: string | null`
and its DTO saying `projectId?: string` describe the same fact, and splitting
them would report drift on every nullable column in the schema.

## What it reads

psq parses C# directly. It does not build the target project, so it works on a
repo that does not compile on this machine.

An entity is a class you can reach from a `DbSet<T>` or from an Identity base
type argument. Every other class is ignored. That rule is what keeps DTOs,
services, and stale duplicates out of the graph.

Measured against `corpus-repo-a`:

| Fact | Value |
|---|---|
| Entities | 17 |
| Relations | 20 |
| Warnings | 0 |
| Questions generated | 191 across 18 generators |

Both numbers match `Migrations/AppDbContextModelSnapshot.cs`, which EF
generates and psq never writes. The snapshot declares 17 domain entities and
26 `HasForeignKey` calls; 6 of those belong to the Identity join tables.

### Constructs it handles

- `IdentityDbContext<TUser, TRole, TKey>`, not only `: DbContext`
- Both `DbSet<T> X { get; set; }` and `DbSet<T> X => Set<T>()`
- Both fluent styles: `builder.Entity<T>().HasOne(...)` and
  `builder.Entity<T>(e => { e.HasOne(...); })`
- Members inherited from a base class, including `IdentityUser<TKey>`
- Composite keys, unique indexes, precision, max length
- `IsRequired(false)`, which makes a relationship optional
- Modern C#: `required` members, file-scoped namespaces, collection
  expressions, and interpolated raw strings
- Positional records — `record UserProfileDto(Guid Id, string Email, …)` declares
  properties, and a reader that skips the parameter list makes every DTO in a
  modern codebase invisible

### Why the parser is hand-written

The prebuilt tree-sitter C# grammars on npm are built against tree-sitter 0.20.
That grammar fails on `corpus-repo-a/.../LicenseApplication.cs`, which uses
`required` members and `= []`. The current grammar has no compatible prebuilt
wasm, and the native binding needs node-gyp.

psq needs a narrow, regular subset of C#. Getting the *literals* right is what
matters, because a `;` or `{` inside a string must never look like structure.
The lexer guarantees that. Anything it does not recognize becomes a warning,
never a guess.

## Delete behavior: written or derived

EF applies a default when a repo does not declare `OnDelete`. psq records which
one you are looking at:

- `fluent` — the repo wrote `OnDelete(DeleteBehavior.X)`
- `convention` — EF's default: `Cascade` for a required foreign key,
  `ClientSetNull` for an optional one

`corpus-repo-a` declares no `OnDelete` at all, so psq marks all 20 of its
relations `convention` and **asks no delete-behavior questions about it**.
A question must test the codebase, not an EF default.
`corpus-repo-b` declares seven, so those become questions.

## `psq selftest`

Run this before you trust a question bank.

A question that always passes cannot be told apart from a question whose
grader is broken. So psq proves every question twice: once with its reference
answer, which must pass, and once with a mutation, which must fail.

It also checks the set as a whole. Two questions with the same prompt and
different answers mean one of them is wrong, and the reader cannot tell which.
That fault is invisible in any single question.

The command exits non-zero on any finding.

## Development

```bash
pnpm typecheck   # root, e2e, web and desktop
pnpm test        # vitest, hermetic, no browser
pnpm test:e2e    # builds the web bundle, then drives a real browser
pnpm build       # typecheck, then the web and desktop bundles
```

There is no linter. `tsc` under `strict` is the gate.

The suite has two layers. Hermetic tests run against
`test/fixtures/mini-efcore`, which lives in this repo. Corpus tests run against
real projects on this machine and validate extraction against ground truth psq
did not produce. Corpus tests skip when those projects are absent:

```bash
PSQ_NO_CORPUS=1 pnpm test   # 92 tests, no external repo needed
pnpm test                    # 147 tests
```

`test/fixtures/mini-node` is the Node counterpart to `mini-efcore`, and is
adversarial the same way: it plants exactly one of each construct the reader has
to survive — DDL written both ways, a `_id` join and a natural-key join, a
composite primary key, a comment between two columns, routes registered inside a
factory, a zod schema extended across a file boundary, a utility type over an
intersection, and a row/DTO pair with one field of drift in each direction. Its
contract is `expect(g.warnings).toEqual([])`.

## Layout

```
packages/schema     zod contract, no I/O
packages/extract    reader dispatch, C# lexer + EF fluent reader, TS/DDL reader
packages/graph      invariants, degrees, shortest path, layout, mermaid
packages/quiz       generators, bank, grader, selftest, seeding, SQL sandbox
apps/cli            hand-rolled argv
apps/server         express, the JSON API
apps/web            Vite, React 19, Tailwind v4, shadcn
apps/desktop        Electron main and preload
test/fixtures       self-contained EF and Node projects
```

### End-to-end

`pnpm test:e2e` runs the real API, the real bundle and a real browser against
the fixture in this repo. It covers what unit tests structurally cannot: that
the diagram draws unclipped, that clicking an entity selects it, that the theme
actually changes and survives a reload, and that a question's answer never
reaches the page before it is submitted.

It finds a Chromium wherever one exists — a Playwright cache, or a system
install — and **skips cleanly when there is none**, the same contract the
corpus tests use. Point `PSQ_E2E_BROWSER` at a binary to override.

The suite caught a real bug on its first run: calling `setPointerCapture` on
pointerdown retargets the derived click to the capturing element, so clicking
an entity was delivered to the `<svg>` and selection never happened. The
diagram now captures the pointer only once movement passes a threshold, which
keeps drag-to-pan working and lets a click be a click.

Packages export `./src/index.ts` directly. There is no build step.
