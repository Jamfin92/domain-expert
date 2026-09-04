# M5b programme — component attribution, and the testbed it needs

Supersedes the first draft, which the reviewer returned **"fix first"** with five
blocking issues. Reshaped again by two user directions: the extractor must be
generic across stacks, and the comparison target should be a sample template
codebase populated with Northwind.

## Why this grew

The queued work was one phase. Investigation turned up three things that make it
four:

1. **`programFor` cannot resolve a Vite React client.** Blocking, measured.
2. **The template has no domain layer.** Building the testbed is greenfield.
3. **There is no plugin seam.** "Generic across stacks" means inventing one.

---

## Phase A — refresh the template repo

Repo: `Jamfin92/vite-react-webapi-template` (public, last commit 2026-08-09).
Not stale; `npm ci` and `npm run build` pass. This is hygiene, not rescue.

- `npm update` in `client/` — sweeps shadcn 4.16.2->4.19.0, lucide-react, motion,
  react-hook-form, @hookform/resolvers, oxlint, vite, @vitejs/plugin-react,
  @types/*. Clears the `nanoid` GHSA-2v37-7h3g-55p8 advisory as a side effect
  (build-time CLI only, never in the shipped bundle).
- Move `shadcn` from `dependencies` to `devDependencies` — it is a scaffolding
  CLI and is the sole reason `npm audit` is unclean.
- Add `e2e/` + `playwright.config.ts` to a tsconfig project. Today
  `tsconfig.node.json` includes only `vite.config.ts`, so **`tsc -b` never
  typechecks the test suite**. Do this BEFORE the TypeScript bump so TS 7 errors
  in tests actually surface.
- `@types/node` 24->26, `concurrently` 9->10 (root; only consumer is `dev:all`,
  verify `-n`/`-c`/`--kill-others` survived).
- **TypeScript 6 -> 7 on its own branch, gated on `tsc -b`.** The `~6.0.2` pin
  hides the major. TS 7 is the native-port compiler; expect friction against
  `verbatimModuleSyntax` + `erasableSyntaxOnly`. This is the one item that can
  genuinely bite — it does not block anything downstream and can be deferred.

**Prerequisite, user action:** install a .NET 10 SDK. Only 8.0.128 is present;
`net10.0` will not build and `npm run e2e` hangs on `dotnet run` for 120s.

**Not doing:** code-splitting the 645 kB bundle. Cosmetic for a template.

**Outward-facing.** Pushing to a public repo — confirm before I push.

---

## Phase B — the Northwind testbed

A new repo forked from the refreshed template, carrying a real domain. This is
the biggest phase and it is almost entirely greenfield.

### Server (from scratch — nothing exists to migrate)

Core 8: `Customer`, `Order`, `OrderDetail`, `Product`, `Category`, `Supplier`,
`Employee`, `Shipper`. Chosen because between them they carry every relation
shape the extractor claims to handle:

- composite key — `OrderDetail(OrderId, ProductId)`
- self-referencing FK — `Employee.ReportsTo -> Employee`
- optional FK with a distinct delete behaviour — `Order.ShipVia -> Shipper`
- plain 1:N both ways — `Product -> Category`, `Product -> Supplier`

Add EF Core package references, a `NorthwindDbContext` with DbSets, fluent
configuration (composite key, indexes, delete behaviours), DI wiring, and
minimal-API endpoints replacing the static `Packages.All` list.

**Source-complete, not running.** The extractor is static analysis — it parses
source and executes only `CREATE TABLE` text into in-memory SQLite. No database,
no seeding, no deployment. That is what makes this tractable.

### Client

Replace the single `useApi<T>` hook with a layered structure a real Northwind
CRUD app would have, in the template's own idioms — services, hooks, pages.

**The implementer writes this as an app, not as a fixture, and does not read
`clients.ts` or `refs.ts` while writing it.** Non-negotiable. M5a's three
fabricated facts all survived a green suite; a fixture authored to match the
reader proves nothing about the reader.

It must naturally contain, because a real app does: 3-hop
(component->hook->service->fetch), 2-hop (component->service), a direct call in
a component, a module with calls and no component owner, a hook consumed by two
components, a provider that owns calls, `export default function Named()`, a
`React.forwardRef` const, a barrel re-export, and — critically — **two
components with the same name in different directories**.

The 11 shadcn `ui/` primitives stay. They are excellent decoys: PascalCase
components that make no calls.

---

## Phase C — vendor it in, and fix `programFor`

### C1. The blocking resolution bug

`programFor` (`packages/extract/src/node.ts:41-60`) reads only the root
`tsconfig.json`. A solution-style config (`"files": []` + `"references"`) yields
`fileNames: []`, so it falls through to `walk()` under `FALLBACK_OPTIONS` —
which sets **no `jsx` and no `paths`**.

My first draft asserted the Program "already resolves path aliases because it is
built from the target repo's own tsconfig." That is false. Measured against
`repoA/client`:

```
countyService -> Alias, getAliasedSymbol() -> NODECL   (module unresolved)
getCounties   -> getSymbolAtLocation() === undefined   (receiver is error type)
```

Under `tsconfig.app.json` both resolve perfectly. **This is the default Vite
React shape**, so it hits the Northwind testbed identically.

Fix: when `fileNames` is empty and `references` exist, resolve each referenced
config and union their `fileNames` and options (notably `jsx`, `paths`,
`baseUrl`). If that still yields nothing, fall back to `walk()` **and warn** —
today that branch degrades silently, unlike the `read.error` branch, against the
repo's own "warn, never guess" rule.

**Warning scope is delicate.** It must fire only for "tsconfig existed, parsed,
yielded nothing", never for "no tsconfig at all", or it breaks three
`expect(g.warnings).toEqual([])` contracts at `test/mini-node.test.ts:18`,
`test/mini-fullstack.test.ts:18`, `packages/extract/test/node.test.ts:95`.

### C2. `detectProvider` will mis-route a full-stack fixture

`detect.ts:17-30` returns `"efcore"` if **any** `.cs` file exists under the root.
A `northwind-fullstack/` holding both halves dispatches to the .NET pipeline and
never extracts a single client call.

**This phase: extract the two halves as explicit roots** (`client/`, `server/`),
which is exactly how corpus repoA is already configured. No production change.

**Not doing yet:** a merged full-stack provider. That is the right long-term
answer and it is what `table<->route<->component` ultimately needs, but it is a
separate feature and it needs a C# route reader, which does not exist.

> **SUPERSEDED 2026-09-03 by complexity-facts Phase 1b-i.** The merged provider
> was built, and the two premises above did not survive contact:
>
> - **It did not need a C# route reader.** `dotnet.ts` still hardcodes
>   `routes: []`. The merge joins entities, shapes, client calls and components;
>   route↔table reachability is a later phase and is not a precondition for any
>   of that.
> - **"Two explicit roots" is what the merge does INTERNALLY, not an
>   alternative to it.** `extract()` now runs the .NET reader on the repo root
>   and the TypeScript reader on whichever directory owns the `tsconfig.json`,
>   then re-prefixes every node-side path into the outer root. Asking the user
>   to pass two roots was never the cheaper option — it just moved the merge out
>   of psq and into the user's head, and left `EntityGraph.contextName`, the
>   entity model and the cross-stack DTO comparison with no single home.
>
> `Provider` is now `"efcore" | "sqlite-ddl" | "fullstack" | "none"`. See
> `feature-research/complexity-facts/plan-phase1b.md` and
> `packages/extract/src/merge.ts`.

### C3. Vendoring, and how it stays current

Vendor the testbed source (minus lockfiles, `node_modules`, `.git`) into
`test/fixtures/northwind-fullstack/`.

**On the private feed.** `domain-expert` is public. A fixture pulled from a
private GitHub Packages feed makes tests need network and an auth token — anyone
cloning, and CI, gets a silent skip or a hard failure. The existing corpus
already shows how that goes: gitignored config, and a dropped test count as the
only signal it vanished. Feeds also ship packages, not source, so the artifact
would have to be unpacked back to a directory before every run.

**Instead:** a pinned vendored snapshot plus `scripts/refresh-testbed.ts`, which
pulls the latest tag from the testbed repo, re-applies nothing (the repo *is* the
source of truth), and leaves a reviewable diff. Tests stay offline and hermetic;
updates are one command and a human-reviewed diff.

If you want the template distributed as a package, `dotnet new` template packages
are the right vehicle — but that is about the template repo, not about how
`domain-expert` tests read source.

### C4. Generic e2e

Existing e2e (`e2e/psq.e2e.ts`, 19 tests, vitest + playwright-core against a real
browser and the real API) is mixed: some assertions are invariants
(`locator('[data-psq="node"]').count() === api.entities`), some are pinned to
fixture content (`expect(api.entities).toBe(5)`, hardcoded palette hexes).

Add the testbed to the harness and assert **stack-agnostic invariants only**:
every name in `clientCalls[].components` resolves in `components[]`; attribution
terminates; a call with no UI layer above it yields `[]`; counts on screen match
counts from the API. Leave the existing pinned specs alone.

---

## Phase D — M5b component attribution

The originally queued work. Design as drafted, with the reviewer's five blocking
corrections applied:

- **Key, don't name.** `DefKey = "<repo-relative file>#<name>"`. `Component` gets
  `key`; `ClientCall.components` holds keys. The target repo has **nine**
  distinct `ReviewStep` components and seven `DocumentsStep` — a bare name
  resolves against all nine, and a UI picks the first. That is a fabricated fact
  by this repo's own standard.
- **Definition model, stated not guessed.** Any top-level `VariableDeclaration`
  with an identifier name is a definition whatever the initializer — this covers
  `const Button = React.forwardRef(...)`, every shadcn primitive.
  **`ownerDef` takes the innermost definition**: for
  `const svc = { async getX() { fetch(...) } }` the chain holds both `svc.getX`
  and `svc`, and collapsing to `svc` merges every service method into one node,
  making every component that touches any method own every call. Index by
  **declaration node**, `Map<ts.Declaration, DefKey>`, never by `file#name`.
- **Component detection is a pluggable predicate.** The engine — definitions,
  reference edges, reverse reachability — is stack-agnostic symbol resolution
  with nothing React about it. Only "is this a UI component?" is stack-specific.
  JSX+PascalCase is detector #1; Vue/Svelte/Angular become new detectors rather
  than engine surgery. This is the seam that does not exist today.
- **Nearest-component, with the swallow catalogued by name.** Stopping the
  reverse BFS at the first component stays — the alternative makes root `App` own
  every call. But catalogue the real case: a provider containing the auth calls
  is attributed, and the 22 components calling `useAuth()` are not. Record
  `depth` so a consumer can tell "depth 1, inside a provider" from a real 3-hop
  chain. **Do not add a heuristic that skips providers** — that is a guess.
- **`enclosing` constraint rescoped.** "Existing non-null outputs must not
  change" is unsatisfiable: adding `PropertyAssignment` to the walk necessarily
  changes `const outer = () => ({ p: () => { fetch("/x") } })` from `"outer"` to
  `"p"`. Correct scope: *the outputs pinned by `test/mini-fullstack.test.ts` must
  not change.*
- **State `refs.ts`'s file filter.** `readClientCalls` skips test files and
  express-importing files. Unstated, `components[]` gains every component defined
  in a test file.

### Corrected facts

My draft asserted `demo-seed.ts`'s 11 calls attribute to nothing, and wrote it
into a corpus assertion. False: `demo-launcher-page.tsx:26` calls
`seedRenewalStage` inside a JSX component, so the answer is `["DemoLauncherPage"]`.
The genuinely unattributed site is the module-scope axios interceptor in
`src/lib/axios.ts`. A reddening test built on a false expectation invites the
implementer to weaken the graph until the "expected" skip appears — M5a's exact
failure mode.

### Not in this phase

**Wrapper unwrapping** (`apps/web/src/lib/api.ts`'s `call<T>(path, init)`).
Attribution *annotates* existing facts; unwrapping *creates* new ones, and a
synthesised path can then match a route — how M5a turned one bad fact into a bad
link three times. Reference edges retain their call-site node, which is exactly
what argument-index propagation needs, so the next phase is a consumer, not a
rewrite. Note it must run **before** attribution in `extractNode`.

### Verification

Green suites are not the gate. All three M5a defects survived a green suite and
were caught by falsification against real repos.

1. `pnpm typecheck`; `pnpm test` (corpus ON, `211 passed` must not regress);
   `PSQ_NO_CORPUS=1 pnpm test`; `pnpm test:e2e`.
2. Falsification run over the testbed **and** `repoA/client`,
   hand-verified against source, reported in `audit.md` — including one of each
   deviation shape and an explanation for every `[]`. An unexplained `[]` is a
   defect, not a limitation.
3. Hunt the M5a mode explicitly: **where does this produce a confident answer
   instead of a skip?**

**Private names never enter committed files.** `test/fixtures.ts` documents the
rule on `CorpusRepo.expect`: *"Data, not code: no name from a private repo may
appear in a committed test."* My draft violated it. Real names live only in the
gitignored `corpus.local.json`; add `repoAClient` to the `CorpusKey` union and a
`componentChains?` field to `CorpusNodeExpect`. The committed Northwind testbed
has public names and needs none of this — which is the strongest argument for it.

### Dropped from the draft

Checker cost. Measured: 29,773 identifiers across 221 files resolve in **190 ms**
after a 222 ms program construction. Not a risk; the measurement task buys
nothing.

Line numbers in the draft's "files touched" were all off by one after M5a's
edits: `detect.ts:52`, `dotnet.ts:293` and `:614`, `layout3d.test.ts:49`. The
*set* of four `EntityGraph` construction sites is complete, and there is no
`EntityGraph.parse`/`safeParse` anywhere, so adding a required field breaks no
persisted-graph path.
