import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { EXTRACTOR_VERSION } from "@psq/extract";
import type { EntityGraph, Route } from "@psq/schema";
import type { OpenRepo } from "../../server/src/workspace.js";

/** Code-unit order. Never localeCompare: the output must not depend on the host locale. */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function cap<T>(items: readonly T[], n: number): { items: T[]; omitted: number } {
  return { items: items.slice(0, n), omitted: Math.max(0, items.length - n) };
}

export const cite = (file: string, line?: number): string =>
  line === undefined ? file : `${file}:${line}`;

export const handlerOf = (r: Route): Route["handler"] => r.handler;

/**
 * Identity of a method: the same `Type.method` in two files is two methods
 * (`Dup.Sync` in a controller and a service). NUL cannot occur in a path.
 */
export const methodKey = (r: { file: string; type: string; method: string }): string =>
  `${r.file}\0${r.type}.${r.method}`;

/** Does this graph describe a .NET API (the attribute-route reader applies)? */
const isDotnet = (g: EntityGraph): boolean =>
  g.provider === "efcore" ||
  (g.provider === "fullstack" && (g.entityRefs.length > 0 || g.routes.some((r) => r.handler)));

/** The first path segment, the unit routes are grouped by. */
export const segmentOf = (path: string): string => path.split("/").filter(Boolean)[0] ?? "/";

// ---------------------------------------------------------------------------
// Identity: which snapshot an answer was read from.

/**
 * The graph as JSON with every object's keys sorted (code-unit order) and the
 * absolute `repo` path removed, so a graph rehydrated through zod (which may
 * reorder keys) and the same checkout on another machine serialise the same.
 * Array order is kept: it is part of what the extractor produced.
 */
export function canonicalGraphJson(g: EntityGraph): string {
  const { repo: _repo, ...rest } = g;
  void _repo;
  return JSON.stringify(sortKeys(rest));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort(cmp)) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== undefined) out[k] = sortKeys(x);
  }
  return out;
}

export const graphDigestOf = (g: EntityGraph): string =>
  createHash("sha256").update(canonicalGraphJson(g)).digest("hex");

export interface RepoHead {
  commit: string;
  /** Non-empty when the opened path is a subfolder of a larger repo (git's `--show-prefix`). */
  prefix: string;
}

/**
 * `git rev-parse` only. Never `status` or `diff`: those can run the opened
 * repo's `core.fsmonitor` hook, which is code from the repo psq is reading.
 * The environment is scrubbed of the variables that would point git at a
 * different repository than the path. Null on any failure (no git, not a
 * repo, no commits, timeout).
 */
export function repoHeadOf(path: string): RepoHead | null {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  const git = (args: string[]): string =>
    execFileSync("git", ["-C", path, "rev-parse", ...args], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
      env,
      encoding: "utf8",
    });
  try {
    const commit = git(["--verify", "HEAD"]).trim();
    if (!/^[0-9a-f]{40,64}$/.test(commit)) return null;
    const prefix = git(["--show-prefix"]).replace(/\n$/, "");
    return { commit, prefix };
  } catch {
    return null;
  }
}

export interface Identity {
  repoHead: RepoHead | null;
  extractorVersion: number;
  graphDigest: string;
  sourceFingerprint: string;
}

// Keyed by the OpenRepo object: every `Workspace.open` makes a new one, so this
// is computed once per open and never outlives the graph it describes.
const identities = new WeakMap<OpenRepo, Identity>();

export function identityOf(repo: OpenRepo): Identity {
  let id = identities.get(repo);
  if (!id) {
    id = {
      repoHead: repoHeadOf(repo.path),
      extractorVersion: EXTRACTOR_VERSION,
      graphDigest: graphDigestOf(repo.graph),
      sourceFingerprint: repo.sourceFingerprint,
    };
    identities.set(repo, id);
  }
  return id;
}

/** `commit` alone, or `commit:prefix` (git's tree-ish:path) for a subfolder; `none` outside git. */
export const headLabel = (h: RepoHead | null): string =>
  h === null ? "none" : h.prefix === "" ? h.commit : `${h.commit}:${h.prefix}`;

/** The coverage note a 0-entity repo carries on every tool result. */
export const NO_ENTITIES = { entities: "none-found" } as const;

// ---------------------------------------------------------------------------
// Stop conditions: what psq cannot see, and what each tool does not establish.

/**
 * ONE table feeds both the tool descriptions and `warnings.cannotSee`, so the
 * two cannot say different things.
 *
 * `text` is true of EVERY repo: tool descriptions are registered before any
 * repo is open, so a description cannot depend on a graph. `see` decides the
 * `cannotSee` line for one graph: `true` emits `text`, a string emits that
 * (a sharper statement about this graph), `false` emits nothing. A row without
 * `see` is a tool-only stop condition. Rows are emitted in table order.
 */
interface Limit {
  text: string;
  see?: (g: EntityGraph) => boolean | string;
}

const isTsFile = (f: string): boolean => /\.(ts|tsx|mts|cts)$/.test(f);

export const LIMITS = {
  runtime: {
    text:
      "psq reads declarations and source text only: it has no runtime data, so query counts, " +
      "latency, row volumes and index usage are invisible.",
    see: () => true,
  },
  coverage: {
    text:
      "Counts are what psq extracted, not what the repo holds: 0 entities means psq read no " +
      "schema it understands, not that the app stores no data.",
    see: (g) =>
      g.entities.length === 0 &&
      "psq read no entity schema here (no EF Core entity reachable from a DbSet, no CREATE TABLE " +
        "literal): missing coverage is unknown, not absence, and the app may keep data in a way " +
        "psq does not read.",
  },
  ddlRelations: {
    // `ddl.ts` marks a relation `declared` when the DDL writes FOREIGN KEY /
    // REFERENCES, so "no foreign key is declared" is false of such a schema.
    text:
      "Relations read from raw DDL are `inferred` from column naming unless the DDL declares a " +
      "FOREIGN KEY (`source: declared`); an inferred edge is psq's reading, not a constraint.",
    see: (g) => g.provider === "sqlite-ddl" || g.provider === "fullstack",
  },
  mirrors: {
    text:
      "`mirrors: null` on a shape does not prove the shape has no table: psq pairs shapes within " +
      "one stack only, so in a .NET + TypeScript repo a TypeScript shape is never compared " +
      "with the .NET entities.",
    see: (g) => {
      const unpaired = g.shapes.filter((s) => s.mirrors === null);
      if (unpaired.length === 0) return false;
      // With no entities there was nothing to pair against; "found none" would
      // claim a search that never ran. The `coverage` row speaks for this graph.
      if (g.entities.length === 0) return false;
      // The merge's own condition (`merge.ts`): TS shapes unpaired AND a .NET
      // entity model beside them. There, null was never computed cross-stack.
      const crossStack =
        g.provider === "fullstack" &&
        g.entities.some((e) => e.file.endsWith(".cs")) &&
        unpaired.some((s) => isTsFile(s.file));
      return crossStack
        ? "TypeScript shapes were not paired against the .NET entity model: `mirrors: null` on a " +
            'TypeScript shape means "not computed" cross-stack, not "no mirror".'
        : "`mirrors: null` means psq paired the shape against this stack's entities and found none " +
            "whose name and fields both match; a mapper psq cannot see may still connect them.";
    },
  },
  refMentions: {
    text:
      "entityRefs are MENTIONS of an entity name inside method bodies, not call sites, and are " +
      "matched by name only: a same-named class elsewhere is reported as a ref.",
    see: (g) => g.provider === "efcore" || g.provider === "fullstack",
  },
  refScan: {
    text: "Constructor bodies, comments and #if blocks are not scanned for entity refs.",
    see: (g) => g.provider === "efcore" || g.provider === "fullstack",
  },
  calls: {
    text:
      "Calls are resolved syntactically (DI fields typed by repo interfaces, this/static calls); " +
      "unresolved calls are counted, not followed, and overloads are not distinguished.",
    see: (g) => g.calls !== undefined,
  },
  attributeRoutes: {
    text:
      "psq reads ASP.NET ATTRIBUTE routes only. Conventional routing (MapControllerRoute) and " +
      "minimal APIs (MapGet, MapPost, ...) are not read; they surface as warnings.",
    see: isDotnet,
  },
  missingRoutes: {
    text:
      "A route absent from this list is not proof the endpoint is absent: psq lists only the " +
      "routes it could read.",
    see: (g) =>
      isDotnet(g) &&
      g.routes.length === 0 &&
      "psq found no attribute routes; the API may still have endpoints psq cannot see.",
  },
  clientMatch: {
    text:
      "A client call with no matching route is not proof the server lacks it: the route may be " +
      "one psq cannot read, or the URL one psq cannot resolve.",
    see: (g) => {
      if (g.clientCalls.length === 0) return false;
      const matched = g.clientCalls.filter((c) => c.matches !== null).length;
      return (
        matched * 2 < g.clientCalls.length &&
        `Only ${matched} of ${g.clientCalls.length} client calls match a route psq read: ` +
          "the server side is mostly invisible to psq (routes it cannot read, or URLs it cannot resolve)."
      );
    },
  },
  clientWrappers: {
    text:
      "Client calls through wrapper functions, concatenated URLs, non-literal URLs and " +
      "baseURL-relative paths are not seen.",
    see: (g) => g.clientCalls.length > 0 || g.components.length > 0,
  },
  attribution: {
    text:
      "A call is attributed only to the NEAREST component; class components and anonymous " +
      "default exports are never attributed.",
    see: (g) => g.clientCalls.length > 0 || g.components.length > 0,
  },
  grouping: {
    text:
      "Areas and districts are psq's own grouping (by namespace, directory, component or route " +
      "path segment), not module boundaries the code declares.",
  },
  entitySearch: {
    text:
      "A miss is not proof of absence: only entity names, table names and property names are " +
      "searched, never shapes, routes, components or source text.",
  },
} satisfies Record<string, Limit>;

export type LimitId = keyof typeof LIMITS;

/** A tool description plus its one stop-condition sentence from {@link LIMITS}. */
export const withLimit = (description: string, id: LimitId): string =>
  `${description} Limit: ${LIMITS[id].text}`;

/**
 * What psq cannot see, stated up front. Only the rows of {@link LIMITS} that
 * apply to this graph are returned, in table order.
 */
export function blindSpots(g: EntityGraph): string[] {
  const out: string[] = [];
  for (const row of Object.values(LIMITS) as Limit[]) {
    const v = row.see?.(g) ?? false;
    if (v === true) out.push(row.text);
    else if (typeof v === "string") out.push(v);
  }
  return out;
}
