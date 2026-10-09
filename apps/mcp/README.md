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

| Tool | Returns |
| --- | --- |
| `open_repo {path}` | repo id and counts: entities, relations, routes, clientCalls, components, entityRefs, warnings, districtBasis |
| `overview` | areas: districts (and the basis they were derived from), components with their client calls, routes grouped by first path segment |
| `search_entities {query, wholeWord?}` | entities matching by name, table or property; `wholeWord` needs a whole identifier word |
| `entity {name}` | fields, relations `out` (this entity holds the FK) and `in`, mirroring shapes with drift, a summary of mentions |
| `refs {entity, via?}` | where an entity is mentioned: `file:line`, enclosing `Type.method` |
| `routes {prefix?}` | routes with `file:line`, the handler when psq knows it, and whether any client call matched |
| `client_calls {component?}` | client HTTP calls with the component they attribute to and the route they matched |
| `warnings` | extraction warnings plus the standing list of what psq cannot see |
| `mermaid` | `erDiagram` source |
| `brief` | the markdown domain brief (also an MCP prompt named `brief`) |

`refs` are **mentions by name, not call sites**. Entities and relations are
located by file only; the graph has no line for them, and the tools do not
invent one.

## The brief

`brief` renders areas, entities with their relations, routes, client-call wiring,
hot spots (most-mentioned entities, methods touching the most entities, most
connected entities) and warnings. It opens and closes with the standing
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

Handlers are tested directly against the `mini-efcore-refs` and
`mini-fullstack-react` fixtures, and one suite drives the real server over the
SDK's in-memory transport.
