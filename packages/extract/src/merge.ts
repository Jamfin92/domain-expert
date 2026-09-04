import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ClientCall, Component, EntityGraph, Entity, Route, Shape } from "@psq/schema";

/**
 * Joining a .NET graph and a TypeScript graph into one.
 *
 * The two readers are run over DIFFERENT roots and their outputs are then put
 * into one coordinate system here. That is deliberate, and it is the whole
 * reason this file exists — see `nodeRootFor`.
 */

/**
 * Directories that never hold a repo's own TypeScript project.
 *
 * A local copy of `files.ts`'s SKIP set on purpose: this scan is one level
 * deep and looks for a `tsconfig.json`, not for source, so the two lists have
 * no reason to stay equal. Sharing one would couple root selection to a set
 * tuned for a different job.
 */
const SKIP = new Set([
  "node_modules", "bin", "obj", ".git", "dist", "build", ".next", ".vs",
  "TestResults", "coverage", ".venv", "__pycache__",
]);

/**
 * Which directory the TypeScript reader should be pointed at.
 *
 * A full-stack repo usually keeps its client in a subdirectory with its own
 * `tsconfig.json`, and that config is not decoration: `paths` (`@/*`) and
 * `moduleResolution: "bundler"` are what make the client's cross-file
 * references resolve. Reading such a client from the OUTER root falls through
 * to `programFor`'s directory scan with default options, and every reference
 * that goes through an alias breaks. Measured on a real React + .NET repo:
 * three of five client calls lost their component attribution entirely, and
 * `components: []` is indistinguishable from "genuinely unowned".
 *
 * The alternative — teaching `programFor` to discover a nested tsconfig —
 * was rejected. It would change extraction for every single-stack repo with
 * no root config (a corpus repo is exactly that shape, four nested projects,
 * with pinned expectations). Confining root selection to the full-stack path
 * keeps every single-stack extraction byte-identical. That is a choice, not
 * an oversight.
 *
 * Warns only when it genuinely cannot decide (rule 3). One candidate is not a
 * guess, and no candidate at all is the ordinary tsconfig-less Node repo,
 * which reads correctly from the root today.
 */
export function nodeRootFor(root: string): { root: string; warnings: string[] } {
  if (existsSync(join(root, "tsconfig.json"))) return { root, warnings: [] };

  const candidates: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return { root, warnings: [] };
  }
  for (const name of entries.sort()) {
    if (SKIP.has(name)) continue;
    const full = join(root, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    if (existsSync(join(full, "tsconfig.json"))) candidates.push(name);
  }

  if (candidates.length === 1) return { root: join(root, candidates[0]!), warnings: [] };
  if (candidates.length > 1) {
    return {
      root,
      warnings: [
        `no tsconfig.json at the repo root and ${candidates.length} candidates below it ` +
          `(${candidates.map((c) => `${c}/`).join(", ")}); read the TypeScript side from the ` +
          "root with default compiler options, so client-call attribution may be incomplete.",
      ],
    };
  }
  return { root, warnings: [] };
}

/**
 * The exact text `extractNode` emits when it finds shapes and no DDL schema.
 *
 * Matched by prefix rather than rewritten at the source: on a single-stack
 * Node repo the warning is true and must stay word for word. It is only false
 * once a .NET entity model is merged in beside it.
 */
const NO_SCHEMA_PREFIX = "No CREATE TABLE statement was found, so this repo has shapes but no schema.";

function prefixPath(prefix: string, p: string): string {
  return prefix === "" ? p : `${prefix}/${p}`;
}

function byNameThenFile(a: { name: string; file: string }, b: { name: string; file: string }): number {
  return a.name.localeCompare(b.name) || a.file.localeCompare(b.file);
}

/**
 * One graph from two readers' output.
 *
 * `prefix` is the node root's path relative to the merge root ("" when they
 * are the same directory). Every node-side path is re-prefixed by it. Miss one
 * field and a `DefKey` stops resolving, so the list is exhaustive by
 * construction: `Entity.file`, `Shape.file`, `Route.file`, `ClientCall.file`,
 * `Component.file`, `Component.key` (the key embeds the path) and every string
 * in `ClientCall.components` (they are `Component.key`s).
 *
 * Pure over its inputs. Neither argument is mutated.
 */
export function mergeGraphs(
  dotnet: EntityGraph,
  node: EntityGraph,
  prefix: string,
  rootWarnings: string[] = [],
): EntityGraph {
  const at = (p: string): string => prefixPath(prefix, p);

  const nodeEntities: Entity[] = node.entities.map((e) => ({ ...e, file: at(e.file) }));
  const nodeShapes: Shape[] = node.shapes.map((s) => ({ ...s, file: at(s.file) }));
  const nodeRoutes: Route[] = node.routes.map((r) => ({ ...r, file: at(r.file) }));
  const nodeComponents: Component[] = node.components.map((c) => ({
    ...c,
    key: at(c.key),
    file: at(c.file),
  }));
  const nodeCalls: ClientCall[] = node.clientCalls.map((c) => ({
    ...c,
    file: at(c.file),
    components: c.components.map(at),
  }));

  const entities = [...dotnet.entities, ...nodeEntities].sort(byNameThenFile);
  const relations = [...dotnet.relations, ...node.relations].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  // Never deduped by name. Nine of ten C# DTOs in the reference full-stack repo
  // share a name with a TypeScript shape; they are the same DTO twice, in two
  // naming conventions, and the difference between them is the merge's whole
  // point. `Shape` also has no key field, so a name-dedupe could not even say
  // deterministically which twin survives (rule 7 on top of rule 3).
  const shapes = [...dotnet.shapes, ...nodeShapes].sort(byNameThenFile);

  // Concat, not re-sort: the .NET reader contributes none of these three
  // (`dotnet.ts` hardcodes routes/clientCalls/components empty), so a concat
  // preserves the node reader's own order exactly and the merged graph reads
  // identically to `extractNode` on the same client. Re-sorting would differ
  // from it for no gain.
  const routes = [...dotnet.routes, ...nodeRoutes];
  const clientCalls = [...dotnet.clientCalls, ...nodeCalls];
  const components = [...dotnet.components, ...nodeComponents];

  // The node reader's "no schema here" warning is TRUE of the client and FALSE
  // of the merged graph, which does have a schema — the .NET one. `psq graph`
  // prints warnings, so leaving it would state a wrong fact. Rewritten rather
  // than dropped, so the honest half survives.
  const nodeWarnings = node.warnings.map((w) =>
    entities.length > 0 && w.startsWith(NO_SCHEMA_PREFIX)
      ? "No CREATE TABLE statement was found on the TypeScript side; this graph's schema " +
        "comes from the .NET entity model instead. psq reads a TypeScript schema from raw " +
        "DDL only; an ORM-defined schema is not read."
      : w,
  );

  const mergeWarnings: string[] = [];

  // `invariants()` reads only entities and relations and catches a name
  // COLLISION; it cannot see this. An EF `Customer` beside a DDL `customers`
  // merges silently into one graph holding two entity languages — C# types
  // next to SQLite storage classes — which is precisely the state
  // `entity-mcq`'s distractor padding and `packages/quiz/src/sql` depend on
  // not existing. This warning is the guard, not `invariants()`.
  if (dotnet.entities.length > 0 && nodeEntities.length > 0) {
    mergeWarnings.push(
      `both stacks contributed entities (${dotnet.entities.length} from the .NET side, ` +
        `${nodeEntities.length} from raw DDL); this graph holds two entity languages at once, ` +
        "so any fact that reads a property type without knowing which side it came from is " +
        "unreliable here.",
    );
  }

  // `mirrors` is computed inside each reader against that run's own entities
  // and frozen there; nothing recomputes it after the merge. So a TypeScript
  // shape's `mirrors: null` means "not computed", not "no mirror" — and that
  // distinction is invisible in the graph. Said once, not once per shape.
  const unpaired = nodeShapes.filter((s) => s.mirrors === null).length;
  if (unpaired > 0 && dotnet.entities.length > 0) {
    mergeWarnings.push(
      `${unpaired} shapes from the TypeScript side were not paired against the .NET entity ` +
        "model; psq pairs shapes within a stack only, so mirrors:null on a TS shape means " +
        '"not computed", not "no mirror".',
    );
  }

  return {
    kind: "entity",
    repo: dotnet.repo,
    provider: "fullstack",
    contextName: dotnet.contextName,
    entities,
    relations,
    shapes,
    routes,
    clientCalls,
    components,
    warnings: [...dotnet.warnings, ...nodeWarnings, ...rootWarnings, ...mergeWarnings],
  };
}
