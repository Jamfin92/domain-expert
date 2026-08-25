# M5b — component attribution (+ the resolution fix it depends on)

Deferred work (template refresh, Northwind testbed, vendoring, generic e2e) is in
`roadmap.md`. This file is the phase to build now.

Validation for this phase is a hermetic `mini-react` fixture plus falsification
runs against `repoA/client`. No private name enters a committed file.

---

## Part 1 — `programFor` must resolve a Vite React client

**This is a prerequisite, not a cleanup.** Without it Part 2 resolves nothing and
reports `components: []` everywhere, which is indistinguishable from a legitimate
"no component owner".

`programFor` (`packages/extract/src/node.ts:41-60`) reads only the root
`tsconfig.json`. The Vite React default is solution-style — `"files": []` plus
`"references"` — so `parsed.fileNames` is empty and control falls through to
`ts.createProgram(walk(...), FALLBACK_OPTIONS)`. `paths`, `jsx` and
`moduleResolution: "bundler"` all live in `tsconfig.app.json`, which is never
read.

Measured against the real repo:

```
countyService -> Alias, getAliasedSymbol() -> NODECL   (module unresolved)
getCounties   -> getSymbolAtLocation() === undefined   (receiver is error type)
```

Under `tsconfig.app.json` both resolve.

### The fix — pick one project, do not merge

When `parsed.fileNames.length === 0` and there are project references: resolve
each one, parse it, and **select the referenced project with the largest
`fileNames`. Use its `fileNames` AND its options verbatim**, plus the existing
forced `strictNullChecks: true` / `noEmit: true`. Tiebreak explicitly by
lexicographic config path — do not lean on `Array.prototype.sort` stability.

**Do not union file sets or overlay options.** A project reference is a separate
compilation unit; merged options are not a thing tsc has. Overlaying leaks keys
the winner never set — a Vite template that omits `types` or `lib` would silently
inherit `types: ["node"]` and a DOM-less `lib` from `tsconfig.node.json`, which
is a guessed compilation. Unioning is worse: it compiles `vite.config.ts` under
the app project's options, and the Part 2 edge walk drops the resulting
unresolved symbols silently. The union also buys nothing — psq wants `src`, which
is the winner's file set already.

**Resolution mechanics, stated because the obvious copy is wrong.** Reusing the
`basePath` from `packages/extract/src/node.ts:48` passes `repoRoot`, which is
correct here only because both configs sit in one directory. For
`{ "path": "./packages/app" }` the referenced `include: ["src"]` would resolve
against the wrong root, yield zero files, and fall through to `walk()` — a wrong
answer wearing "no files" as a disguise. Use `parsed.projectReferences` (already
absolute), resolve directory-vs-file with `ts.resolveProjectReferencePath`, and
call `ts.parseJsonConfigFileContent(cfg, ts.sys, dirname(refPath), undefined,
refPath)`.

**One level, no recursion.** A referenced config that is itself solution-style
contributes nothing and the warning fires.

**With 3+ references the largest wins and the rest are dropped** — for a real
monorepo solution config that is a silent half-read, so warn: `N referenced
projects; reading only <winner>`.

If this still yields nothing, fall back to `walk()` **and push a warning**. Today
that branch degrades in silence, unlike the `read.error` branch — against the
repo's own "warn, never guess" rule.

### Warning scope is the delicate part

It must fire **only** for "a tsconfig existed, parsed, and yielded no files".
Never for "no tsconfig at all". Three committed contracts assert
`expect(g.warnings).toEqual([])` — whole-array equality, so any leak fails:

- `test/mini-node.test.ts:18`
- `test/mini-fullstack.test.ts:18`
- `packages/extract/test/node.test.ts:95` (repoE, corpus)

Verified during planning, so treat this as settled and do not re-litigate it:
**neither `test/fixtures/mini-node/` nor `test/fixtures/mini-fullstack/` has a
`tsconfig.json` at all**, so both take the "no tsconfig" path and never reach the
new branch; repoE (`repoE`) has an ordinary config with
`include: ["src/**/*.ts"]` — non-empty, no references. Only `repoA/client`
is solution-style.

There is a **fourth** `warnings).toEqual([])` at `e2e/psq.e2e.ts:67`, over the
mini-EF fixture. It is unaffected — noted so its absence from this list is not
mistaken for an oversight to "fix".

**Warning placement.** It must also cover "tsconfig parsed, zero files, **no**
references at all", and it must be `else` to the `read.error` branch at
`packages/extract/src/node.ts:44-46`, or one broken tsconfig emits two warnings
for one fact.

Add `jsx: ts.JsxEmit.Preserve` to `FALLBACK_OPTIONS` while here. Note that is close to a
no-op — `.tsx` parses as JSX by extension regardless, and no diagnostics are
read. Do **not** treat "a .tsx fixture parses" as evidence Part 1 works; the
failure being fixed is *module resolution*, not parsing.

---

## Part 2 — attribution

### The engine is stack-agnostic; only one predicate is not

Definitions, reference edges and reverse reachability are symbol resolution with
nothing React about them. The single stack-specific question is "is this
definition a UI component?" That becomes a **pluggable predicate**, with
JSX+PascalCase as detector #1, so Vue/Svelte/Angular are new detectors rather
than engine surgery. No such seam exists today — readers are a hardcoded chain at
`node.ts:88-91` — so this is inventing one, deliberately, at the smallest useful
scope.

### Definitions (`packages/extract/src/node/refs.ts`, new)

`DefKey = "<repo-relative file>#<name>"`.

A definition is a named binding **whose statement is at `SourceFile` scope** —
say it that way, not "top-level", or "any `VariableDeclaration`" reads as "at any
depth" and every `const handler = () => …` inside a component becomes a
definition. At that scope: function declarations; **any `VariableDeclaration`
with an identifier name, whatever the initializer** (this covers
`const Button = React.forwardRef(...)`, i.e. every shadcn primitive); properties
of an object literal (`svc.getX`); classes and their methods; anonymous
`export default`.

**Anonymous default exports key as `"<file>#default"`** — the general form has no
name to interpolate.

**Collision rule:** if two definitions produce the same key (a top-level `Button`
and a class method `Button`), **first wins and push a warning naming both
sites**. A duplicate key makes `ClientCall.components` resolve ambiguously
against `components[]`, which is the exact fabricated-fact failure the
keys-not-names decision exists to kill.

**Index by declaration node — `Map<ts.Declaration, DefKey>` — never by
`file#name`.** A name-keyed lookup invents edges between same-named locals.

**Key on the exact node the checker reports**, i.e. whatever
`valueDeclaration ?? declarations[0]` returns for that member — not the node you
happened to visit. `svc.getX` is a `MethodDeclaration` for `{ async getX(){} }`,
a `PropertyAssignment` for `{ getX: async () => {} }`, and a
`ShorthandPropertyAssignment` for `{ getX }`.

**`ownerDef` takes the innermost enclosing definition.** For
`const svc = { async getX() { fetch(...) } }` the ancestor chain holds both
`svc.getX` and `svc`; collapsing to `svc` merges every service method into one
node, so every component touching any method owns every call. That is fan-out
fabrication by construction, not something a falsification run should have to
notice.

`ownerDef` is a **different notion** from `ClientCall.enclosing` (nearest *named
function*, which may be an inner callback). Both are needed; do not merge them.

**File filter, stated:** `refs.ts` walks the same set `readClientCalls` does —
skipping `isTestFile(rel)` and express-importing files (`clients.ts:140`).
Unstated, `components[]` gains every component defined in a test file.

### Edges

Inside definition `D`, resolve every `Identifier` and every
`PropertyAccessExpression.name`: `getSymbolAtLocation` -> if `SymbolFlags.Alias`
then `getAliasedSymbol` -> `valueDeclaration ?? declarations[0]`. If that
declaration is under the repo root, is not a `.d.ts`, and maps to a known
definition `E`, record `D -> E` **carrying the referencing node** (the deferred
wrapper phase needs the call site for argument-index propagation).

Bare method references used as values (`queryFn: svc.getThings`) must produce
edges. They are load-bearing and easy to miss — a value, not a call.

### Attribution: nearest component

From `ownerDef(callNode)`: if it is itself a component, attribute and stop.
Otherwise BFS over **reverse** edges, recording each component reached and **not
expanding past it**. `visited` kills cycles; depth cap 8, silently.

Stopping at the first component is deliberate — attributing to all reaching
components makes root `App` own every call in the app, which is true and useless.

**Catalogue the swallow by name**, not as a generic "ancestors are missed": a
context provider that contains the auth calls is attributed, and the components
consuming its hook are not. **Do not add a heuristic that skips providers** —
that is a guess. `depth` is deliberately not recorded this phase; it complicates
the exhaustive `toEqual` fixtures and its only consumer is an M5c UI that does
not exist.

### Schema

- New `Component`: `key`, `name`, `file`, `line`.
- `EntityGraph.components: Component[]`.
- `ClientCall.components: string[]` — sorted **keys**, resolving against
  `components[]`.

**Keys, not names.** The house-style precedent (`Shape.mirrors`,
`ClientCall.matches`) resolves to entity names and `"METHOD path"` strings, which
are near-unique. Component names are not: the target repo has **nine** distinct
`ReviewStep` components and seven `DocumentsStep`. A bare name resolves against
all nine and a UI picks the first — a fabricated fact by this repo's own
standard. Keys keep the convention (a name resolving against a sibling array,
never an index) and remove the ambiguity.

Extend the `ClientCall` miss list with the attribution misses: ancestor
components above the nearest, the provider swallow, depth-cap truncation,
non-PascalCase components, indirect JSX returns.

### `enclosing` tightening

Fix only the null cases M5a catalogued: object-literal arrow properties, class
property arrows, constructors, get-accessors, anonymous default exports.

Constraint, correctly scoped: **the outputs pinned by
`test/mini-fullstack.test.ts` must not change.** The draft's "no existing
non-null output may change" is unsatisfiable — adding `PropertyAssignment` to the
walk necessarily turns `const outer = () => ({ p: () => { fetch("/x") } })` from
`"outer"` into `"p"`. Accept that tightening; preserving it would need a guard
that fires only when the result would otherwise be null, making the field mean
two different things by nesting depth.

### Ordering

Attribution runs **last** in `extractNode`. The deferred wrapper phase
*synthesises* `ClientCall`s, and attribution must see them.

---

## Fixture: `test/fixtures/mini-react/` (new)

Every entry exists to catch a specific defect class. A fixture that only proves
the happy path is what let M5a's three defects through a green suite.

- **solution-style `tsconfig.json` + `tsconfig.app.json` with `@/*` paths** —
  the only thing that exercises Part 1. **All sources live under `src/`** (the
  app config's `include: ["src"]`), and **the component->hook and hook->service
  hops must import via `@/…`**. With relative imports the chain resolves under
  `walk()` + `FALLBACK_OPTIONS` too, and the fixture stays green with Part 1
  reverted — precisely the blindness this fixture exists to prevent.
- **two same-named definitions in one file** — the collision rule above (the
  same-name-different-directory case below covers only the key ambiguity)
- **a `CREATE TABLE`** — `node.ts:93-98` warns when a Node repo yields no
  entities, which would defeat a zero-warning assertion. `mini-fullstack` carries
  one for this reason. Verify the interaction before asserting on warnings.
- 3-hop (component -> hook -> service -> fetch), 2-hop, direct-call-in-component
- **two components with the same name in different directories** — key ambiguity
- **a bare method reference as a value** (`queryFn: svc.getThings`)
- **an object-literal service with two methods**, asserting a call in method A
  does *not* attribute through method B — the innermost-`ownerDef` guard
- `export default function Named()`, and a `React.forwardRef` const
- a provider-shaped component owning a call while other components consume it
- a barrel re-export (`export * from "./x"`)
- a genuinely unattributed module-scope call
- a PascalCase non-component decoy, and a reference cycle

`test/mini-react.test.ts` follows house style: extract once at module scope,
exhaustive `toEqual`, `// ABSENT on purpose:` comments per catalogued miss.

---

## Verification

Green suites are not the gate. All three M5a defects survived a green suite and
were caught by falsification against real repos on disk.

1. `pnpm typecheck`; `pnpm test` (corpus ON — **`211 passed` must not regress**);
   `PSQ_NO_CORPUS=1 pnpm test`; `pnpm test:e2e` (19).
2. **Falsification run over `repoA/client`**, hand-verified against
   source, reported in `audit.md`: one of each deviation shape, and an
   explanation for **every** `[]`. An unexplained `[]` is a defect, not a
   limitation. Three facts are already known and must come out right —
   `demo-seed.ts`'s calls attribute to `DemoLauncherPage` (via
   `demo-launcher-page.tsx:26`), *not* to nothing; the auth calls attribute to
   the provider; `src/lib/axios.ts`'s module-scope interceptor is the genuinely
   unattributed site.
3. Hunt the M5a mode explicitly: **where does this produce a confident answer
   instead of a skip?** Every fall-through justified in `audit.md`.

**No private name in a committed file.** `test/fixtures.ts` documents the rule on
`CorpusRepo.expect`: *"Data, not code: no name from a private repo may appear in
a committed test."* Add `repoAClient` to the `CorpusKey` union and a
`componentChains?: { file: string; line: number; components: string[] }[]` to
`CorpusNodeExpect`; real values live only in the gitignored `corpus.local.json`.

**User action:** the corpus test skips silently until
`"repoAClient": { "path": "<repoA path>/client", ... }`
is added by hand to `test/corpus.local.json`. Per standing note, a dropped test
count is the only signal.

PATH: `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`

---

## Files touched

**New**
- `packages/extract/src/node/refs.ts`
- root `tsconfig.json` — add `"test/fixtures/mini-react"` to `exclude` (see below)
- `test/fixtures/mini-react/**` (incl. `tsconfig.json`, `tsconfig.app.json`)
- `test/mini-react.test.ts`

**Modified**
- `packages/schema/src/index.ts` — `Component`, `EntityGraph.components`,
  `ClientCall.components`, extended miss list
- `packages/extract/src/node.ts` — project-reference resolution + warning; `jsx`
  in `FALLBACK_OPTIONS`; wire `refs.ts`; `components` on the graph; ordering
- `packages/extract/src/node/clients.ts` — `enclosing` nulls; accept attribution
- `packages/extract/src/detect.ts:52` — `components: []`
- `packages/extract/src/dotnet.ts:293` and `:614` — `components: []`
- `packages/graph/test/layout3d.test.ts:49` — `components: []`
- `test/mini-fullstack.test.ts` — `components: []` on every call
- `test/fixtures.ts` — `CorpusKey` += `repoAClient`; `CorpusNodeExpect` +=
  `componentChains?`
- `packages/extract/test/node.test.ts` — `[corpus]` describe for `repoAClient`
- `README.md` — M5b row

**`pnpm typecheck` will fail without the exclude.** Root `tsconfig.json:3-13` has
`include: ["test/**/*.ts"]` with no fixture exclusion, and `tsconfig.base.json`
sets `module: NodeNext` + `verbatimModuleSyntax` — which is why every existing
fixture writes `import { Crew } from "./base.js"`
(`test/fixtures/mini-node/contracts.ts:2`). A `mini-react` `.ts` file importing
`@/services/x` or an extensionless relative path is a hard root-project error: no
`paths` at root, and NodeNext rejects the extensionless form. React types are
absent from root `node_modules` too — only `apps/web/node_modules/@types/react`
exists. `.tsx` files escape only because `**/*.ts` does not match `.tsx`, which is
an accident not worth depending on.

Line numbers verified post-M5a; the draft's were all off by one. The set of four
`EntityGraph` construction sites is complete, and there is no
`EntityGraph.parse`/`safeParse` anywhere, so adding a required field breaks no
persisted-graph path.

**Deliberately not touched**
- `apps/web/src/lib/api.ts:106` — the hand-written `EntityGraph` mirror drifts
  further. M5a's precedent; M5c's job.
- Wrapper unwrapping. Attribution *annotates* facts; unwrapping *creates* them,
  and a synthesised path can match a route — how M5a turned one bad fact into a
  bad link three times. Edges retain their call-site node so the next phase is a
  consumer, not a rewrite.

## Dropped

Checker cost. Measured: 29,773 identifiers across 221 files in **190 ms** after
222 ms of program construction. Not a risk.
