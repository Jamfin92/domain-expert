import type { EntityGraph, Question, Section } from "@psq/schema";
import { generateEntityMcq } from "./generate/entity-mcq.js";
import { generateEntityCloze } from "./generate/entity-cloze.js";
import { generateEntitySql } from "./generate/entity-sql.js";
import { generateDsMcq } from "./generate/ds-mcq.js";
import { generateDsCloze } from "./generate/ds-cloze.js";
import { generateClientMcq } from "./generate/client-mcq.js";
import { DEFAULT_SEED } from "./rng.js";
import type { SeededDb } from "./sql/seed.js";

/**
 * The whole question bank for a graph.
 *
 * One composition point, called by the CLI and the server alike. When these
 * were two lists they were two lists that had to be kept identical, and a
 * generator added to one shell would have been missing from the other.
 *
 * Filtering happens here rather than in `selectQuiz`, which round-robins by
 * generator: a quiz asked for one section should not have to win a lottery
 * against the others to get its questions.
 */
export function buildBank(
  g: EntityGraph,
  seeded: SeededDb,
  seed?: number,
  sections?: readonly Section[],
): Question[] {
  // The choke point. One resolution of the seed, passed on as a number, so the
  // six generators cannot each invent their own default and hand the CLI a
  // different bank from the one the server builds.
  const s = seed ?? DEFAULT_SEED;
  const all = [
    ...generateEntityMcq(g, s),
    ...generateEntityCloze(g, s),
    ...generateEntitySql(g, seeded, s),
    ...generateDsMcq(g, s),
    ...generateDsCloze(g, s),
    ...generateClientMcq(g, s),
  ];
  if (!sections || sections.length === 0) return all;
  const wanted = new Set(sections);
  return all.filter((q) => wanted.has(q.section));
}
