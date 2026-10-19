# @psq/mcp — psq for agents

A stdio [MCP](https://modelcontextprotocol.io) server over psq's deterministic
graph. It lets an agent talk about an app's areas, how its sections connect, and
where it could be simplified, while every claim traces to a fact psq extracted.
Nothing here asks a model to decide anything: the tools return facts (rule 1),
read from `EntityGraph` (rule 2), and `warnings` says what psq could not see
(rule 3).

## Run it

Like the CLI, it runs from source through `tsx` (no build step). From a psq
checkout, after `pnpm install`:

```bash
pnpm exec tsx apps/mcp/src/index.ts --repo <path-to-your-app>
```

`--repo` is optional; it opens that repo at startup. A tool that omits `repo` uses it
only while it is the sole open repo. Without it, call `open_repo` first. stdout carries the protocol, so
logs go to stderr.

A repo where psq finds no entities (no EF Core DbContext, no `CREATE TABLE`)
still opens here: the MCP calls `Workspace.open(path, {allowEmpty: true})` from
`--repo`, `open_repo` and an implicit path `repo`. Every result for such a repo
carries `coverage`: one entry per facet (`entities`, `relations`, `shapes`,
`routes`, `clientCalls`, `components`, `entityRefs`, `calls`, `pairing`), each
`{status, readers, roots, filesRead, skipped, reason}`. An `entities` status of
`none-found` with its reason (e.g. "no CREATE TABLE literal among 2 TypeScript
files") means psq read no schema, not that the app stores nothing. The HTTP
server does not opt in and keeps refusing it with "No entities found: <reason>"
(or, when the read itself was partial, "No entities found in a partial read
(<what was left out>)"), because its quiz would have nothing to ask.

## Register it

Claude Code:

```bash
claude mcp add psq -- <path-to-psq>/node_modules/.bin/tsx <path-to-psq>/apps/mcp/src/index.ts --repo <path-to-your-app>
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "psq": {
      "command": "<path-to-psq>/node_modules/.bin/tsx",
      "args": ["<path-to-psq>/apps/mcp/src/index.ts", "--repo", "<path-to-your-app>"]
    }
  }
}
```

Use absolute paths; the client does not start in your shell's working directory
and may not have your `PATH`. Node 24 or later.

## Tools

Every tool takes an optional `repo` (an id from `open_repo`, or a path). It may
be left out only when exactly one repo is open; with several open, omitting it is an error. Lists are capped and say so (`truncated`).

Twelve tools and one prompt:

| Tool | Returns |
| --- | --- |
| `open_repo {path}` | repo id, counts (entities, relations, shapes, routes, clientCalls, components, entityRefs, warnings, districtBasis), `providerBasis` (the file counts that decided the provider), `coverage` (per-facet status and reason) and the identity fields below |
| `overview` | areas: districts (and the basis they were derived from), components with their client calls, routes grouped by first path segment; `coverage` |
| `search_entities {query, wholeWord?}` | entities matching by name, table or property; `wholeWord` needs a whole identifier word; `next` |
| `entity {name}` | fields, relations `out` (this entity holds the FK) and `in`, mirroring shapes with drift, a summary of mentions; `next` |
| `refs {entity, via?}` | where an entity is mentioned: `file:line`, enclosing `Type.method` |
| `routes {prefix?}` | routes with `file:line`, the handler when psq knows it, and whether any client call matched; `next` |
| `client_calls {component?}` | client HTTP calls with the component they attribute to and the route they matched |
| `warnings` | extraction warnings plus `cannotSee`, the standing list of what psq cannot see in this repo; `coverage` |
| `mermaid` | `erDiagram` source; line 2 is `%% graphDigest <hex>` |
| `flow {route? \| handler?, maxDepth?}` | a route or handler followed through resolved calls, hop by hop, with the entities each method mentions; `next` |
| `areas` | route-derived feature areas with their routes, components and entities, shared entities, and cross-area edges |
| `brief` | the markdown domain brief |

| Prompt | Returns |
| --- | --- |
| `brief {repo?}` | the same markdown brief as the `brief` tool, as a user message |

`open_repo`, `overview` and `warnings` always carry the full `coverage` block,
so a healthy repo's caller can see partial or not-read facets. On a repo with no
entities every JSON result carries it: `entity`, `refs`, `flow` and `areas`
answer `{error: "no-entities", coverage, graphDigest}` as a normal result (not an
MCP error), with the full per-facet block; `search_entities` answers an empty
`hits` with `coverage`.

### Identity

`open_repo` returns which snapshot every later answer was read from:

| Field | Meaning |
| --- | --- |
| `repoHead` | `{commit, prefix}` from `git rev-parse --verify HEAD` and `--show-prefix`, taken once at open; `prefix` is non-empty when the path is a subfolder of a larger repo; `null` outside git or on any git failure. psq never runs `git status` or `git diff` (a repo's `core.fsmonitor` would run its code). |
| `extractorVersion` | the extractor's semantics version (`EXTRACTOR_VERSION`) |
| `graphDigest` | sha256 of the graph as sorted-key JSON without the absolute `repo` path, so the same checkout on another machine hashes the same when the same dependencies are installed (the TypeScript reader resolves imports such as `zod` from `node_modules`; a missing package changes what is extracted, and so the digest) |
| `sourceFingerprint` | the digest of the source files psq read, taken before extraction |

Every JSON result carries `graphDigest`. `mermaid` carries it as a `%%` comment
on its second line, and the brief (tool and prompt) as a
`> snapshot: <commit[:prefix]|none> · extractor <n> · graph <hex>` line under
its title.

### Stop conditions and `next`

Each tool description ends with one `Limit:` sentence saying what its answer
does not establish. Those sentences and `warnings.cannotSee` come from one table
(`LIMITS` in `src/common.ts`), so the two cannot disagree. `entity`, `routes`,
`flow` and `search_entities` add `next: [{tool, args, why}]`: follow-up calls for
what the answer could not show. A cut list is narrowed (`wholeWord`, a longer
`prefix`), not paged.

`refs` are **mentions by name, not call sites**. Entities and relations are
located by file only; the graph has no line for them, and the tools do not
invent one.

## The brief

`brief` renders areas, entities with their relations, routes, client-call wiring,
hot spots (most-mentioned entities, methods touching the most entities, most
connected entities), coverage (one line per facet with its status, readers,
roots, files read and reason, then the provider basis; never cut) and warnings.
It opens and closes with the standing
instruction:

> Every claim must cite a graph fact (file:line); say "psq cannot see this"
> rather than guess.

Ask your client for the `brief` prompt (`/mcp` prompts in Claude Code) or call
the `brief` tool, then discuss.

## Example conversation

> **You:** Use psq to tell me what areas this app has, and where it's tangled.
>
> *Agent calls `open_repo`, then `overview`.* The graph shows two districts by
> namespace… `Student` references `Course` (`Models/Student.cs`).
>
> **You:** What touches `Course` the most?
>
> *Agent calls `refs {entity: "Course"}`.* 12 mentions; `Dup.Sync`
> (`Controllers/CoursesController.cs:55`) is one. These are mentions by name, not
> proven call sites.
>
> **You:** Could the enrollment logic be pulled into one place?
>
> *Agent calls `brief`, reads "Methods touching the most entities":*
> `EnrollmentService.Enroll` (`Services/EnrollmentService.cs:15`) touches both
> entities. psq cannot see runtime cost, so I can describe the coupling but not
> whether it is slow.

## Tests

```bash
PSQ_NO_CORPUS=1 pnpm test      # includes apps/mcp/test
```

Handlers are tested directly against the `mini-efcore-refs`,
`mini-fullstack-react`, `mini-aspnet-routes` and `mini-types-only` (0 entities)
fixtures, and one suite drives the real server over the SDK's in-memory
transport.
