import type { EntityGraph, EntityRef, RefVia } from "@psq/schema";

/**
 * Where an entity is mentioned, straight off the graph.
 *
 * `graph.entityRefs` already exists; without this selector it is reachable
 * only by pulling the whole graph and filtering client-side. Pure and
 * deterministic, like everything else in this package.
 *
 * The match on `entity` is EXACT and case-sensitive, never fuzzy (D-Hb2-3):
 * `/api/repos/:id/search` is the fuzzy lookup and has its own ranked-hit
 * contract, so a selector that silently fuzzy-matched would make `refs` and
 * `search` two answers to the same question that disagree. An entity name no
 * graph knows returns `[]`, matching `relationsOf`'s precedent in `./index.ts`.
 *
 * Order is INHERITED from `graph.entityRefs`, which the walker already sorted
 * on six keys. This function filters and never re-sorts, so the one ordering
 * decision lives in one place.
 *
 * `opts.via` absent means BOTH vias, not neither — an omitted filter is not a
 * filter on `undefined`. And note D-Hb2-6: `via: "dbSetName"` records that the
 * matched token was the DbSet property name preceded by a `.`, which is a
 * MENTION rule, not evidence that the code went through the DbContext.
 *
 * Returns a fresh array because `Array.prototype.filter` always allocates one.
 * That is recorded rather than gated: no mutant makes it return the live array
 * without also breaking the entity filter.
 */
export function refsFor(
  graph: EntityGraph,
  entity: string,
  opts?: { via?: RefVia },
): EntityRef[] {
  const via = opts?.via;
  return graph.entityRefs.filter((r) => r.entity === entity && (via === undefined || r.via === via));
}
