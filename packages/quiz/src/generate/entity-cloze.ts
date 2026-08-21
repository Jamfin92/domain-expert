import type { EntityGraph, Question } from "@psq/schema";
import { hashSeed, rng, type Rng } from "../rng.js";
import { entityAliases, plural } from "../normalize.js";

/**
 * Fill-in-the-blank questions over the entity graph, graded by token match.
 *
 * A blank asks the reader to produce the name rather than recognize it, which
 * is a harder and more useful test than multiple choice. Every blank carries
 * an alias set built from the graph, so `Customer`, `Customers` and the DbSet
 * name are all accepted for the same answer.
 */

interface Ctx {
  g: EntityGraph;
  rnd: Rng;
}

function cloze(parts: {
  id: string;
  generator: string;
  prompt: string;
  answers: string[];
  aliases: string[][];
  subjects: string[];
  rationale: string;
}): Question {
  return {
    id: parts.id,
    section: "entity",
    kind: "cloze",
    gradeMode: "token",
    generator: parts.generator,
    prompt: parts.prompt,
    answers: parts.answers,
    aliases: parts.aliases,
    subjects: parts.subjects,
    rationale: parts.rationale,
  };
}

/** "Complete the navigation property on X." */
function navigationShape(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const e of ctx.g.entities) {
    for (const p of e.properties.filter((x) => x.isNavigation && x.isCollection)) {
      out.push(
        cloze({
          id: `entity.cloze.nav.${e.name}.${p.name}`,
          generator: "navigation-type",
          prompt:
            `Complete the navigation property on ${e.name}:\n\n` +
            `    public ICollection<____> ${p.name} { get; set; }`,
          answers: [p.baseType],
          aliases: [entityAliases(ctx.g, p.baseType)],
          subjects: [e.name, p.baseType],
          rationale: `${e.name}.${p.name} is declared ICollection<${p.baseType}>.`,
        }),
      );
    }
  }
  return out;
}

/** "Which column carries the foreign key?" */
function foreignKeyName(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const r of ctx.g.relations) {
    if (!r.foreignKeyProperty) continue;
    out.push(
      cloze({
        id: `entity.cloze.fk.${r.id}`,
        generator: "fk-column",
        prompt:
          `${r.dependent} references ${r.principal}. ` +
          `Name the property on ${r.dependent} that holds the foreign key.\n\n    ____`,
        answers: [r.foreignKeyProperty],
        aliases: [[r.foreignKeyProperty.toLowerCase()]],
        subjects: [r.dependent, r.principal],
        rationale: `Relation ${r.id} keys on ${r.dependent}.${r.foreignKeyProperty}.`,
      }),
    );
  }
  return out;
}

/** "What table does this entity map to?" */
function tableName(ctx: Ctx): Question[] {
  return ctx.g.entities
    .filter((e) => e.tableName !== e.name)
    .map((e) =>
      cloze({
        id: `entity.cloze.table.${e.name}`,
        generator: "table-name",
        prompt: `Which database table does the ${e.name} entity map to?\n\n    ____`,
        answers: [e.tableName],
        aliases: [[e.tableName.toLowerCase(), plural(e.name).toLowerCase()]],
        subjects: [e.name],
        rationale: `${e.name} maps to ${e.tableName}.`,
      }),
    );
}

/** "Name both sides of the join entity's composite key." */
function compositeKeyParts(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const e of ctx.g.entities) {
    if (e.keys.length < 2) continue;
    out.push(
      cloze({
        id: `entity.cloze.compositekey.${e.name}`,
        generator: "composite-key-parts",
        prompt:
          `${e.name} has a composite primary key. Name both columns, ` +
          `in order, separated by a comma.\n\n    ____, ____`,
        answers: e.keys,
        aliases: e.keys.map((k) => [k.toLowerCase()]),
        subjects: [e.name],
        rationale: `${e.name} declares HasKey on (${e.keys.join(", ")}).`,
      }),
    );
  }
  return out;
}

/** "Which entity sits between A and B?" */
function joinEntity(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const e of ctx.g.entities) {
    if (e.keys.length !== 2) continue;
    const targets = ctx.g.relations
      .filter((r) => r.dependent === e.name && e.keys.includes(r.foreignKeyProperty ?? ""))
      .map((r) => r.principal);
    if (targets.length !== 2) continue;
    const [a, b] = targets as [string, string];
    out.push(
      cloze({
        id: `entity.cloze.join.${a}.${b}`,
        generator: "join-entity",
        prompt:
          `${a} and ${b} are linked through a join entity. Name it.\n\n    ____`,
        answers: [e.name],
        aliases: [entityAliases(ctx.g, e.name)],
        subjects: [e.name, a, b],
        rationale: `${e.name} keys on (${e.keys.join(", ")}), pointing at ${a} and ${b}.`,
      }),
    );
  }
  return out;
}

const GENERATORS = [navigationShape, foreignKeyName, tableName, compositeKeyParts, joinEntity];

export function generateEntityCloze(g: EntityGraph, seed?: number): Question[] {
  const ctx: Ctx = { g, rnd: rng(seed ?? hashSeed(g.repo)) };
  const out: Question[] = [];
  for (const gen of GENERATORS) out.push(...gen(ctx));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
