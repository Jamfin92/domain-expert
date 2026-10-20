import type {
  Coverage, CoverageStatus, EntityGraph, FacetCoverage, ProviderBasis, SkipReason, WarningRecord,
} from "@psq/schema";

/**
 * Per-facet coverage: what a reader ran over, so that an empty facet can say
 * WHY it is empty instead of reading exactly like "the repo has none".
 *
 * Every graph `extract()` produces carries `coverage` and `providerBasis`.
 * The schema marks both optional (hand-built graphs and old envelopes must
 * still parse); inside the package the return types make them required so
 * `tsc` catches any return site that forgets them.
 *
 * A reader (`extractDotnet`, `extractNode`, `mergeGraphs`) returns a
 * `ReaderGraph`: it cannot know the provider basis, which is decided before
 * any reader runs. `extract()` adds the basis and returns an `ExtractedGraph`.
 *
 * `warningRecords` is required here for the same reason (P2b): the schema
 * keeps it optional for hand-built graphs, every reader must return it.
 */
export type ReaderGraph = EntityGraph & { coverage: Coverage; warningRecords: WarningRecord[] };
export type ExtractedGraph = ReaderGraph & { providerBasis: ProviderBasis };

export type Skip = { why: SkipReason; count: number };

/** What one reader run covered. Shared by every facet that run produced. */
export interface ReaderRun {
  /** Repo-relative; "." = the root the reader was pointed at. */
  roots: string[];
  /** Files the run read. FILE-level, not per facet. */
  filesRead: number;
  skipped: Skip[];
  /** Set when the run knowingly left eligible input out; every facet is then partial. */
  partialReason?: string | null;
}

/** Facet names in their fixed order. */
export const FACETS = [
  "entities", "relations", "shapes", "routes", "clientCalls", "components",
  "entityRefs", "calls", "pairing",
] as const satisfies readonly (keyof Coverage)[];

/** Only counts > 0 are recorded; the schema requires a positive count. */
export function skips(...entries: [SkipReason, number][]): Skip[] {
  return entries.filter(([, n]) => n > 0).map(([why, count]) => ({ why, count }));
}

/**
 * A facet a reader actually ran for: `complete` when it found something,
 * `none-found` (with `emptyReason`) when it found nothing, and `partial` when
 * the run itself was partial, whatever the count.
 */
export function facet(
  run: ReaderRun,
  readers: string[],
  count: number,
  emptyReason: string,
): FacetCoverage {
  const base = { readers, roots: [...run.roots], filesRead: run.filesRead, skipped: [...run.skipped] };
  if (run.partialReason) return { status: "partial", ...base, reason: run.partialReason };
  if (count > 0) return { status: "complete", ...base, reason: null };
  return { status: "none-found", ...base, reason: emptyReason };
}

/** The reader ran to completion and produced zero facts. */
export function noneFound(run: ReaderRun, readers: string[], reason: string): FacetCoverage {
  return facet(run, readers, 0, reason);
}

/** No reader for this facet ran. Nothing was read, so there are no roots. */
export function notRead(reason: string): FacetCoverage {
  return { status: "not-read", readers: [], roots: [], filesRead: 0, skipped: [], reason };
}

/** Same coverage for all nine facets. */
export function allFacets(f: () => FacetCoverage): Coverage {
  return Object.fromEntries(FACETS.map((k) => [k, f()])) as Coverage;
}

/** Severity order for `mergeFacet`: any partial wins, then complete, then none-found. */
const RANK: Record<CoverageStatus, number> = {
  "not-read": 0,
  "none-found": 1,
  complete: 2,
  partial: 3,
};

/**
 * One facet from two reader runs (the fullstack merge).
 *
 * Status is the worst-of `partial > complete > none-found > not-read`: a
 * partial half makes the whole partial; otherwise either half having run with
 * results makes it complete. Readers, roots and skips concatenate, `filesRead`
 * sums, roots are deduped (a node root equal to the repo root is "." twice),
 * reasons join with "; ". A half's reason survives only if it is still true
 * of the merged facet:
 * - a `not-read` half's reason is dropped when the other half DID run ("no
 *   TypeScript reader runs under provider efcore" is false of a merged graph
 *   whose TypeScript reader ran);
 * - on a merged `complete`, only `complete` halves keep theirs (the fallback
 *   DbContext election note); an empty half's "no CREATE TABLE literal..."
 *   would read as the reason a complete facet is empty.
 */
export function mergeFacet(a: FacetCoverage, b: FacetCoverage): FacetCoverage {
  const status = RANK[a.status] >= RANK[b.status] ? a.status : b.status;
  const keep = (f: FacetCoverage): boolean =>
    status === "not-read" ? true : status === "complete" ? f.status === "complete" : f.status !== "not-read";
  const reasons = [a, b]
    .filter(keep)
    .map((f) => f.reason)
    .filter((r): r is string => r !== null && r.length > 0);
  return {
    status,
    readers: [...a.readers, ...b.readers],
    roots: [...new Set([...a.roots, ...b.roots])],
    filesRead: a.filesRead + b.filesRead,
    skipped: [...a.skipped, ...b.skipped],
    reason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

/**
 * Shape-to-entity pairing ran only when there was something on both sides.
 * Shared by both readers: `pairShapes` is called either way, but with nothing
 * on one side no pairing was computed.
 */
export function pairingCoverage(
  run: ReaderRun,
  entities: number,
  shapes: number,
): FacetCoverage {
  if (entities > 0 && shapes > 0) return facet(run, ["pair"], 1, "");
  return notRead(entities === 0 ? "no entities to pair shapes against" : "no shapes to pair against the entities");
}
