# M5b — progress

Status: **shipped, reviewed (verdict: ship, after five fix rounds), and committed.**

M9a, M9b and M5a were already committed before this phase began — `8959d16`
(3D city), `b7e60e3` (client HTTP calls), `474c8a7` (their phase records).
M5a's handoff said "nothing has been committed" and that claim was stale by the
time this phase started; it was repeated here once before being checked. Verify
`git log` rather than trusting a predecessor's commit claim.

## What shipped

Client-side HTTP calls are now attributed to the React component that causes
them, across arbitrarily many hops. Plus the resolution fix that made it possible.

### Part 1 — `programFor` reads solution-style tsconfigs

`packages/extract/src/node.ts`. A root `tsconfig.json` with `"files": []` +
`"references"` — **the Vite React default** — previously yielded zero filenames
and fell through to `walk()` under `FALLBACK_OPTIONS`, which sets no `jsx` and no
`paths`. Every `@/` import resolved to nothing.

- **Pick one project, never merge.** Winner = the referenced project with the
  most files *under repoRoot*, tiebreak lexicographic by config path. Its
  `fileNames` **and its options verbatim**, plus the forced
  `strictNullChecks`/`noEmit`. A project reference is a separate compilation
  unit; overlaying options leaks keys the winner never set, and unioning file
  sets compiles `vite.config.ts` under the app project's options.
- **In-root counting is load-bearing.** Selecting by raw file count let a
  reference contributing zero in-repo files win, after which `ownSources`
  filtered everything away — zero warnings, zero facts, worse than the old
  fallback.
- `ts.resolveProjectReferencePath` for directory-vs-file; `basePath =
  dirname(refPath)`, not `repoRoot`. One level, no recursion.
- Two new warnings, both narrowly scoped so they cannot reach the four
  `warnings).toEqual([])` contracts (mini-node:18, mini-fullstack:18,
  node.test.ts:95, e2e/psq.e2e.ts:67 — none of those fixtures has a tsconfig).

### Part 2 — attribution

`packages/extract/src/node/refs.ts` (new). Definitions indexed by declaration
node, alias-following reference edges carrying the referencing node, innermost
`ownerDef`, nearest-component reverse BFS (visited set, depth cap 8).

- Schema: `Component` (`key`, `name`, `file`, `line`), `EntityGraph.components`,
  `ClientCall.components` holding **keys, not names** — the corpus has nine
  distinct `ReviewStep` components and seven `DocumentsStep`.
- **Component detection is a pluggable `ComponentDetector`**, JSX+PascalCase as
  detector #1. The engine is stack-agnostic symbol resolution; only this
  predicate is React-specific. This is the extension seam the repo did not have.
- `enclosing` null cases fixed (object-literal arrow properties, class property
  arrows, constructors, get- **and** set-accessors, anonymous default exports).
  Every value pinned by `mini-fullstack` is byte-identical.

## Verification

`pnpm typecheck` clean · `pnpm test` **219 passed** (corpus ON) ·
`PSQ_NO_CORPUS=1` 161 passed / 58 skipped · `pnpm test:e2e` 19 passed.

Falsification over the real React client: **50 calls, 201 components, 6 empties
(all explained), max list 12.** Stable across rounds 2-5.

PATH: `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`

## The lesson worth carrying forward

**One defect class produced a blocking finding in every review round, six times,
each instance one AST node over from the last.**

An owner-walk that *skips* a node as a definition still walks past it and hands
the call to the enclosing holder. Skipping a node and stopping the walk at it are
two separate decisions; the code must make both. The instances: collision losers,
computed-key members, accessors, inline-spread members, non-method class members,
the constructor, containers not reached at all (factory args, implicit object
returns, IIFEs, arrays), and finally a predicate counting *indexable* siblings
rather than siblings.

**Three times the concealment was in the prose, not the code.** "Computed keys,
spreads, accessors: skipped" describes the indexing decision and says nothing
about the call inside — it reads as a documented limitation while being a
confident wrong answer. "Anonymous sub-expressions … BY DESIGN" was correct for
`forwardRef(cb)` and wrong for every multi-member container, because the real
discriminator is **sibling-bearing, not anonymity**. An inventory entry must
state what happens to a *call* inside the construct.

**A sweep that enumerates the arms you wrote is not a sweep of the containers the
language has.** The table now reads "every arm reached by `collectDefs`, plus the
containers it never reaches", with the never-reached ones listed. An untrue
completeness claim is worse than an honest gap.

**None of the six was caught by a green suite.** 219 tests passed throughout. All
were caught by adversarial probes and by running over a real repo.

## Decisions made

- **Nearest component, not all reaching.** Attributing to every reaching
  component makes root `App` own the app. The provider swallow is catalogued by
  name: a context provider owns the auth calls, and the 22 components consuming
  its hook are not listed. No provider-skipping heuristic — that is a guess.
- **Sibling-bearing rule applies to call ownership only, not reference edges.**
  Verified, not assumed: every `useQuery({...})` in the real client carries both
  `queryKey` and `queryFn`, so applying it to `collectEdges` would refuse
  `queryFn: svc.method` and sever the 3-hop and 4-hop chains — the bulk of 72
  depth-2 and 30 depth-3 attributions. The residual is quantified below.
- **Keys qualified for object members (`file#svc.getX`), unqualified for class
  methods.** Forced by `mini-fullstack`, whose one file holds both `api.get` and
  `bus.get`.
- **The constructor is dropped like every other non-method member.** The earlier
  exception ("the class is its provable owner") is false: type annotations,
  `instanceof`, static access and `extends` are indistinguishable from `new` to
  the edge walk, so a component importing a class only for its type owned the
  constructor's calls.
- **Single-member containers still attribute**, stated in true terms: because
  there are no siblings to fan across — *not* because every referrer provably
  reaches the call. A `typeof x` referrer is still counted an owner.

## Known limitations

- **The B residual, now bounded by evidence.** An edge originating inside a
  sibling-bearing container under a non-component owner can carry one-hop-removed
  fan-out. Instrumented on the corpus: 1073 such edges, 897 in product position,
  of which **2** target a call-bearing definition — and that site is correct on
  inspection. The mis-attributing shape (`useBoth() { return { x: svcA.one, y:
  svcB.two } }` with member-selective consumers) occurs **zero times**.
- Class components' own calls come out `[]` — the innermost owner is an
  unqualified method nothing references. Catalogued.
- Anonymous `export default function () {}` keys as `#default`, fails PascalCase,
  and can never be a component. Catalogued.
- Overloads: canonical is the first **bodiless signature**, so an overloaded
  component is absent from `components[]` and its own calls are unowned.
- `DefKey` does not escape `.`, so `{ "a.b": x, a: { b: y } }` collide. Warns and
  drops the loser.
- Everything inside a `namespace` / `export =` is invisible to attribution.
- Depth cap 8, silently.
- `detectProvider` still returns `"efcore"` if any `.cs` exists anywhere, so a
  full-stack repo must be extracted as two explicit roots.

## What the next phase needs to know

**`roadmap.md` holds the deferred programme**, re-scoped mid-phase on user
direction: the extractor must be generic across stacks, and the comparison target
should be a sample template populated with Northwind rather than private repos.

1. **Template refresh** — `Jamfin92/vite-react-webapi-template`, not stale (15
   days, builds clean). `npm update` sweep, move `shadcn` to devDeps, add `e2e/`
   to a tsconfig project (nothing typechecks it today). **TypeScript 6->7
   deliberately deferred** — the `~` pin hides it and it blocks nothing.
2. **Northwind testbed** — core 8 tables. Greenfield, and the biggest item here:
   the template has **zero** EF Core (8-line csproj, static in-memory list, 3
   endpoints) and no service/hook layer. Source-complete only; the extractor
   never runs the app. **The implementer must write it as an app and must not
   read `clients.ts`/`refs.ts` while doing so** — a fixture authored to match the
   reader proves nothing, which is this phase's whole lesson.
3. **Vendor + generic e2e** — pinned snapshot plus a refresh script, **not** a
   private feed: this repo is public, and a feed makes tests need network and a
   token. e2e assertions must be invariants, not pinned counts.

**Blocker for any server-side roadmap work:** only .NET SDK 8.0.128 is installed
and the template targets `net10.0`. `brew install dotnet`.

**The corpus test skips silently** until `repoAClient` is added by hand to the
gitignored `test/corpus.local.json` (it is currently populated). A dropped test
count is the only signal.

**M5c is API + UI.** `apps/server/src/app.ts:153-166` already returns `routes`
and is the obvious home for `clientCalls` + `components`.
`apps/web/src/lib/api.ts:106` is a hand-written structural mirror of
`EntityGraph` and still does **not** know about `clientCalls` or `components` —
it has now drifted two phases.

**Wrapper unwrapping is still unbuilt** and is the natural next consumer of
`refs.ts`: edges retain their call-site node precisely so argument-index
propagation is a consumer, not a rewrite. It must run **before** attribution in
`extractNode`, since it synthesises `ClientCall`s. Note its only validating
subject is this repo's own `apps/web`, which today yields zero client calls —
that gap is not solved.

**`route -> table` remains the unbuilt half** of the README's
"table<->route<->component"; it needs handler-body SQL/ORM tracing. A C# route
reader would let the real React client's 50 calls stop sitting at
`matches: null`.

**M5b is committed on branch `m5b-component-attribution`, not merged to
`master` and not pushed.**
