/**
 * Answer normalization and alias generation.
 *
 * Grading is deterministic: a typed answer is normalized, then tested for
 * membership in an alias set built from the graph. No model is consulted.
 */
import type { EntityGraph } from "@psq/schema";

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

/** Naive English pluralization, matching EF's DbSet naming closely enough. */
export function plural(name: string): string {
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

export function singular(name: string): string {
  if (/ies$/i.test(name)) return `${name.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(name)) return name.slice(0, -2);
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.slice(0, -1);
  return name;
}

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
