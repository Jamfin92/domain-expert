import type {
  Entity,
  EntityGraph,
  EntityMatchField,
  EntityMatchReason,
  EntitySearchHit,
} from "@psq/schema";

/**
 * Partial-match search over the entities of an EntityGraph.
 *
 * Pure and deterministic: same graph and same query in, byte-identical answer
 * out, whatever order the graph happens to list its entities or properties in.
 * Rule 7 — a result that reshuffles between runs cannot be argued with.
 *
 * Matching is a case-insensitive substring test against the RAW declared
 * strings, never against `conceptKey`/`fieldKey`: those are normalisation
 * artefacts, and a user searching a repo types what the repo says.
 */

/**
 * The fields the matcher iterates, in rank order, and the single source of
 * `EntitySearchResult.searched`. The route spreads this array rather than
 * repeating a literal, so adding a fourth field cannot leave the reported
 * surface behind.
 *
 * `columnName` is absent on purpose: `property.column` is always
 * `property.name`, so the reason could never be distinct. Shapes are absent
 * because a shape is not an entity.
 */
export const MATCH_FIELDS: readonly EntityMatchField[] = [
  "entityName",
  "tableName",
  "propertyName",
];

/** Rank of a match field: lower sorts first, for hits and for reasons alike. */
function rankOf(field: EntityMatchField): number {
  return MATCH_FIELDS.indexOf(field);
}

/**
 * Code-unit ordering, deliberately NOT `localeCompare`.
 *
 * `localeCompare` is locale- and ICU-dependent, and returns 0 for strings that
 * are distinct: on this repo's node, `"é".localeCompare("é") === 0` for the
 * NFC and NFD spellings. A comparator that returns 0 for distinct inputs makes
 * the result depend on the input order that reaches the sort, which is exactly
 * the property this file exists to remove. `degrees`/`adjacency` in
 * `./index.ts` use `localeCompare`; this file does not, and that difference is
 * intentional.
 */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Order the reasons of one hit. Rank first, then the matched string.
 *
 * Without this the array would fall out of `properties[]` order, which is an
 * extraction artefact.
 */
function compareReasons(a: EntityMatchReason, b: EntityMatchReason): number {
  const byRank = rankOf(a.field) - rankOf(b.field);
  if (byRank !== 0) return byRank;
  return byCodeUnit(a.matched, b.matched);
}

/**
 * Order the hits: best match field first, then a stable tiebreak chain.
 *
 * This is a DETERMINISTIC order, not a provably total one: two entities
 * sharing name, namespace and file would tie and fall back on sort stability.
 * That is unreachable in any graph psq emits today — same name plus same
 * namespace is the same entity — and the claim is not made stronger than it is.
 */
function compareHits(a: EntitySearchHit, b: EntitySearchHit): number {
  const byRank = rankOf(a.reasons[0]!.field) - rankOf(b.reasons[0]!.field);
  if (byRank !== 0) return byRank;
  const byName = byCodeUnit(a.name, b.name);
  if (byName !== 0) return byName;
  const byNamespace = byCodeUnit(a.namespace ?? "", b.namespace ?? "");
  if (byNamespace !== 0) return byNamespace;
  return byCodeUnit(a.file, b.file);
}

/** Every reason `entity` has for matching an already-lowercased needle. */
function reasonsFor(entity: Entity, needle: string): EntityMatchReason[] {
  const reasons: EntityMatchReason[] = [];
  for (const field of MATCH_FIELDS) {
    if (field === "entityName") {
      if (entity.name.toLowerCase().includes(needle)) {
        reasons.push({ field, matched: entity.name, property: null });
      }
    } else if (field === "tableName") {
      // A .NET table name is usually `dbSetName ?? name` pluralised
      // (`dotnet.ts:417`) and a Node one duplicates `name` outright, so this
      // reason is frequently psq's convention rather than something the repo
      // wrote. It is NOT labelled as derived in the response, because `Entity`
      // carries no `FactSource` (only `Index` and `Relation` do), so psq
      // cannot tell an explicit `ToTable(...)` from a convention and any label
      // would be a guess — which rule 3 forbids.
      if (entity.tableName.toLowerCase().includes(needle)) {
        reasons.push({ field, matched: entity.tableName, property: null });
      }
    } else {
      for (const property of entity.properties) {
        if (property.name.toLowerCase().includes(needle)) {
          reasons.push({ field, matched: property.name, property: property.name });
        }
      }
    }
  }
  return reasons;
}

/**
 * Entities whose name, table name or any property name contains `query`,
 * case-insensitively.
 *
 * An empty or whitespace-only query returns NO hits rather than everything:
 * `"".includes()` is true of every string, and "I typed nothing" is not a
 * request for the whole graph.
 *
 * Framework entities are not filtered out. Today that is a no-op rather than a
 * safeguard: `isFramework` is the literal `false` at both and only
 * construction sites (`dotnet.ts:436`, `node/ddl.ts:199`) and nothing assigns
 * it anywhere, so no graph psq can emit has a `true` to include or exclude.
 *
 * No null guards on `tableName` or `property.name`: both are `z.string()` in
 * the schema, not nullable, so a guard would be unreachable code.
 */
export function searchEntities(graph: EntityGraph, query: string): EntitySearchHit[] {
  const q = query.trim();
  if (q === "") return [];
  const needle = q.toLowerCase();

  const hits: EntitySearchHit[] = [];
  for (const entity of graph.entities) {
    const reasons = reasonsFor(entity, needle);
    if (reasons.length === 0) continue;
    reasons.sort(compareReasons);
    hits.push({
      name: entity.name,
      tableName: entity.tableName,
      namespace: entity.namespace,
      file: entity.file,
      reasons,
    });
  }
  hits.sort(compareHits);
  return hits;
}
