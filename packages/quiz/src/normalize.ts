/**
 * Answer normalization and alias generation.
 *
 * Grading is deterministic: a typed answer is normalized, then tested for
 * membership in an alias set built from the graph. No model is consulted.
 */
import type { EntityGraph } from "@psq/schema";
import { plural, singular } from "@psq/extract";

/**
 * Case, whitespace, punctuation and namespace differences are noise.
 * "corpus-repo-a.Api.Models.Domain.Order" and "order" both reduce to "order".
 */
export function normalize(s: string): string {
  let t = s.trim().toLowerCase();
  t = t.replace(/\s+/g, " ");
  t = t.replace(/[.,;:!?]+$/g, "");
  // collapse spacing inside generic arguments: "icollection< order >" -> "icollection<order>"
  t = t.replace(/\s*([<>,])\s*/g, "$1");
  // drop namespace qualification on the head symbol only
  const lt = t.indexOf("<");
  const head = lt === -1 ? t : t.slice(0, lt);
  const rest = lt === -1 ? "" : t.slice(lt);
  const shortHead = head.includes(".") ? head.slice(head.lastIndexOf(".") + 1) : head;
  return (shortHead + rest).trim();
}

/**
 * Pluralization lives with the extractors, which need the same rule to pair a
 * shape with a table. Re-exported here because the alias set is built from it.
 */
export { plural, singular } from "@psq/extract";

/**
 * Every spelling of an entity that should be accepted as the same answer:
 * class name, table name, DbSet property name, and singular/plural forms.
 */
export function entityAliases(g: EntityGraph, entity: string): string[] {
  const e = g.entities.find((x) => x.name === entity);
  const out = new Set<string>([entity, plural(entity), singular(entity)]);
  if (e) {
    out.add(e.tableName);
    out.add(singular(e.tableName));
    if (e.dbSetName) {
      out.add(e.dbSetName);
      out.add(singular(e.dbSetName));
    }
  }
  return [...out].map(normalize).filter((x) => x.length > 0);
}

/** True when `given` matches the canonical answer or any accepted alias. */
export function matches(given: string, canonical: string, aliases: readonly string[]): boolean {
  const g = normalize(given);
  if (g.length === 0) return false;
  if (g === normalize(canonical)) return true;
  return aliases.some((a) => normalize(a) === g);
}
