import type { EntityGraph, Question } from "@psq/schema";
import { hashSeed, rng, type Rng } from "../rng.js";

/**
 * Fill-in-the-blank questions about shapes and columns.
 *
 * Naming a type is a harder test than recognizing it, and it is the thing you
 * actually have to do when writing against a codebase. Every prompt names its
 * shape: two questions with the same wording and different answers are a
 * selftest finding, and "what type is `id`?" is the same wording eleven times.
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
    section: "ds",
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

/**
 * "What type is this field?"
 *
 * Only asked when the answer is a type the repo itself declares. `title: string`
 * tests nothing — every codebase has a string. `status: TaskStatus` tests
 * whether the reader knows this codebase's vocabulary, which is the whole point.
 *
 * One per shape, so a repo with eighty shapes does not bury every other
 * generator under eighty blanks about its own field names.
 */
function fieldType(ctx: Ctx): Question[] {
  const declared = new Set([
    ...ctx.g.shapes.map((s) => s.name),
    ...ctx.g.entities.map((e) => e.name),
  ]);
  const out: Question[] = [];

  for (const shape of ctx.g.shapes) {
    const candidates = shape.fields.filter(
      (f) =>
        !f.optional &&
        !f.isCollection &&
        f.type === f.baseType &&
        f.baseType !== shape.name &&
        declared.has(f.baseType),
    );
    if (candidates.length === 0) continue;
    const f = ctx.rnd.pick(candidates);
    out.push(
      cloze({
        id: `ds.cloze.type.${shape.file}.${shape.name}.${f.name}`,
        generator: "field-type",
        prompt: `Complete the declaration on ${shape.name}:\n\n    ${f.name}: ____`,
        answers: [f.baseType],
        aliases: [[f.baseType]],
        subjects: [shape.name, f.baseType],
        rationale: `${shape.name}.${f.name} is declared ${f.type} in ${shape.file}.`,
      }),
    );
  }
  return out;
}

/** "Which property tells the members of this union apart?" */
function discriminator(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const shape of ctx.g.shapes) {
    if (!shape.discriminator) continue;
    out.push(
      cloze({
        id: `ds.cloze.disc.${shape.file}.${shape.name}`,
        generator: "discriminator",
        prompt:
          `${shape.name} is a union. Name the property whose value tells its members apart:\n\n    ____`,
        answers: [shape.discriminator],
        aliases: [[shape.discriminator]],
        subjects: [shape.name],
        rationale: `Every member of ${shape.name} declares ${shape.discriminator} as a distinct string literal.`,
      }),
    );
  }
  return out;
}

/**
 * "What storage class does this column have?"
 *
 * Only for a graph read from raw DDL, where the declared type IS the storage
 * class. An EF graph carries C# types, and the mapping between the two is EF's
 * business rather than something the repo wrote down.
 *
 * A "fullstack" graph is dormant here on purpose, not by omission: its entities
 * come wholly from the .NET side, so they carry C# types for the same reason an
 * "efcore" graph does. A React client contributes no DDL.
 *
 * The gate belongs to THIS generator and nowhere else. `GENERATORS` below also
 * holds `fieldType` and `discriminator`, both of which are ungated and already
 * run on efcore graphs; hoisting this condition to `generateDsCloze` would
 * silently delete two question classes from every .NET repo.
 */
function columnType(ctx: Ctx): Question[] {
  if (ctx.g.provider !== "sqlite-ddl") return [];
  const out: Question[] = [];

  for (const e of ctx.g.entities) {
    const columns = e.properties.filter((p) => !p.isNavigation && p.type.length > 0);
    if (columns.length === 0) continue;

    // Ask about a column that does not have the table's usual type. In a table
    // of nine TEXT columns, the one REAL is the fact worth holding.
    const frequency = new Map<string, number>();
    for (const p of columns) frequency.set(p.type, (frequency.get(p.type) ?? 0) + 1);
    const commonest = [...frequency].sort((a, b) => b[1] - a[1])[0]![0];
    const unusual = columns.filter((p) => p.type !== commonest);

    const p = ctx.rnd.pick(unusual.length > 0 ? unusual : columns);
    out.push(
      cloze({
        id: `ds.cloze.column.${e.name}.${p.column}`,
        generator: "column-type",
        prompt: `Complete the column definition in ${e.name}:\n\n    ${p.column} ____`,
        answers: [p.type],
        aliases: [[p.type]],
        subjects: [e.name],
        rationale: `${e.name}.${p.column} is declared ${p.type} in ${e.file}.`,
      }),
    );
  }
  return out;
}

const GENERATORS = [fieldType, discriminator, columnType];

export function generateDsCloze(g: EntityGraph, seed?: number): Question[] {
  const ctx: Ctx = { g, rnd: rng(seed ?? hashSeed(g.repo)) };
  const out: Question[] = [];
  for (const gen of GENERATORS) out.push(...gen(ctx));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
