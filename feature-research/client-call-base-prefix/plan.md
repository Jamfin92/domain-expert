# client-call-base-prefix — plan

## Approach
- `readClientCalls` learns two statically readable bases, both resolved through
  the type checker (so an exported instance or const imported from another file
  resolves):
  1. `X = axios.create({ baseURL: <literal | const-of-literal> })`, then
     `X.get("/p")` etc.
  2. a template-literal head hole that is a `const` bound to a string literal:
     `` fetch(`${API}/x`) `` with `const API = "/api"`.
- The schema is NOT touched. The call keeps its literal `path` ("/x"); the
  prefix lives in a module-level `WeakMap<ClientCall, string>`
  (`basePrefixOf` / `setBasePrefix`), which `mergeGraphs` carries across its
  spread-copy of the node-side calls.
- `linkCalls`: literal path first; only when that finds no candidate and the
  call has a prefix, try prefix + path (same ambiguity warning).
- Unreadable base (env var, non-literal, spread, non-`/` literal): no guess.
  One warning per distinct base expression text. For an axios instance the
  call is still recorded (literal match still tried); for a `fetch` template
  whose head hole is unreadable the call stays unrecorded (as today) but warns.
- `apiPrefix` override: no config surface exists in `packages/extract`; skipped
  (decision recorded in audit).

## Files touched
- packages/extract/src/node/clients.ts, packages/extract/src/merge.ts
- packages/extract/src/node.ts (ONE line: pass the checker; needed for
  cross-file resolution; outside the stated list — flagged in audit)
- packages/extract/test/client-base.test.ts, test/fixtures/mini-client-base/**

## Gates
- fixture extraction ground truth (paths, prefixes, matches, warnings)
- merge against hand-written .NET-style routes
- linkCalls unit cases: literal-first, ambiguity, no prefix fallback w/o prefix
- each proven RED by mutant (see audit)
