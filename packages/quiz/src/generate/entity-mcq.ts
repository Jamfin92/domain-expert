import type { EntityGraph, Question } from "@psq/schema";
import { degrees, shortestPath } from "@psq/graph";
import { hashSeed, rng, type Rng } from "../rng.js";
import { plural } from "../normalize.js";

/**
 * Deterministic multiple-choice generators over an entity graph.
 *
 * Rules every generator here follows:
 *  - The answer is read from the graph, never inferred at question time.
 *  - Distractors are drawn from sibling entities or real sibling values, so a
 *    wrong option is plausible rather than absurd. An obviously-silly option
 *    lets the reader score by elimination and measures nothing.
 *  - A question is emitted only when enough distractors exist. Padding with
 *    junk would be worse than asking one fewer question.
 *  - `rationale` names the source fact so a disputed answer can be settled.
 */

const MIN_CHOICES = 3;

interface Ctx {
  g: EntityGraph;
  rnd: Rng;
}

/** Assemble a choice list with the answer placed at a seeded position. */
function mcq(
  ctx: Ctx,
  parts: {
    id: string;
    generator: string;
    prompt: string;
    answer: string;
    distractors: string[];
    subjects: string[];
    rationale: string;
  },
): Question | null {
  const pool = [...new Set(parts.distractors.filter((d) => d !== parts.answer))];
  if (pool.length + 1 < MIN_CHOICES) return null;
  const chosen = ctx.rnd.sample(pool, 3);
  const choices = ctx.rnd.shuffle([parts.answer, ...chosen]);
  return {
    id: parts.id,
    section: "entity",
    kind: "mcq",
    gradeMode: "choice",
    generator: parts.generator,
    prompt: parts.prompt,
    choices,
    answerIndex: choices.indexOf(parts.answer),
    subjects: parts.subjects,
    rationale: parts.rationale,
  };
}

/** "X.YId is a foreign key to which entity?" */
function fkTarget(ctx: Ctx): Question[] {
  const out: Question[] = [];
  const names = ctx.g.entities.map((e) => e.name);
  for (const r of ctx.g.relations) {
    if (!r.foreignKeyProperty) continue;
    const q = mcq(ctx, {
      id: `entity.fk.${r.id}`,
      generator: "fk-target",
      prompt: `In ${r.dependent}, which entity does the foreign key ${r.foreignKeyProperty} point to?`,
      answer: r.principal,
      distractors: names.filter((n) => n !== r.principal && n !== r.dependent),
      subjects: [r.dependent, r.principal],
      rationale: `${r.dependent}.${r.foreignKeyProperty} is the foreign key of relation ${r.id} (${r.source}).`,
    });
    if (q) out.push(q);
  }
  return out;
}

/** "What is the cardinality between A and B?" */
function cardinality(ctx: Ctx): Question[] {
  const out: Question[] = [];
  const labels: Record<string, string> = {
    "one-to-many": "One-to-many",
    "one-to-one": "One-to-one",
    "many-to-many": "Many-to-many",
  };
  for (const r of ctx.g.relations) {
    const answer = `${labels[r.cardinality]} (one ${r.principal} to many ${plural(r.dependent)})`;
    const distractors = [
      `One-to-many (one ${r.dependent} to many ${plural(r.principal)})`,
      `One-to-one (one ${r.principal} to one ${r.dependent})`,
      `Many-to-many (many ${plural(r.principal)} to many ${plural(r.dependent)})`,
    ].filter((d) => d !== answer);
    const q = mcq(ctx, {
      id: `entity.card.${r.id}`,
      generator: "cardinality",
      prompt: `What is the relationship between ${r.principal} and ${r.dependent}?`,
      answer,
      distractors,
      subjects: [r.principal, r.dependent],
      rationale: `Relation ${r.id} is ${r.cardinality}, read from ${r.source} configuration.`,
    });
    if (q) out.push(q);
  }
  return out;
}

/**
 * "Which property is NOT on entity X?"
 *
 * The wrong options must be real properties of X, and the answer must be a
 * property of a different entity that X does not also declare. Inherited
 * members count as X's own, which is why extraction expands base classes.
 */
function notAProperty(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const e of ctx.g.entities) {
    const own = e.properties.filter((p) => !p.isNavigation).map((p) => p.name);
    if (own.length < 3) continue;
    const ownSet = new Set(e.properties.map((p) => p.name));
    const foreign = ctx.g.entities
      .filter((o) => o.name !== e.name)
      .flatMap((o) => o.properties.filter((p) => !p.isNavigation).map((p) => p.name))
      .filter((n) => !ownSet.has(n));
    if (foreign.length === 0) continue;

    const answer = ctx.rnd.pick([...new Set(foreign)].sort());
    const q = mcq(ctx, {
      id: `entity.notprop.${e.name}`,
      generator: "not-a-property",
      prompt: `Which of these is NOT a property of ${e.name}?`,
      answer,
      distractors: ctx.rnd.sample(own, 8),
      subjects: [e.name],
      rationale: `${e.name} declares ${own.length} scalar properties in ${e.file}; ${answer} is not one of them.`,
    });
    if (q) out.push(q);
  }
  return out;
}

/** "Which property of X is optional?" */
function requiredness(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const e of ctx.g.entities) {
    const nullable = e.properties.filter((p) => !p.isNavigation && p.nullable && !p.isPrimaryKey);
    const required = e.properties.filter((p) => !p.isNavigation && !p.nullable && !p.isPrimaryKey);
    if (nullable.length === 0 || required.length < 3) continue;

    const answer = ctx.rnd.pick(nullable).name;
    const q = mcq(ctx, {
      id: `entity.optional.${e.name}`,
      generator: "optional-property",
      prompt: `Which property of ${e.name} is optional (nullable)?`,
      answer,
      distractors: required.map((p) => p.name),
      subjects: [e.name],
      rationale: `${e.name}.${answer} is declared nullable; the other options are required.`,
    });
    if (q) out.push(q);
  }
  return out;
}

/** "What happens to X when its parent Y is deleted?" */
function deleteBehavior(ctx: Ctx): Question[] {
  const out: Question[] = [];
  const explain: Record<string, string> = {
    Cascade: "The dependent rows are deleted too",
    ClientSetNull: "The foreign key is set to null",
    SetNull: "The foreign key is set to null in the database",
    Restrict: "The delete is blocked",
    NoAction: "The database takes no action",
  };
  for (const r of ctx.g.relations) {
    // Only ask when the repo actually wrote the rule. Convention-derived
    // behavior is a defensible default, not a fact the reader could have read.
    // Written down, either way: EF's fluent API or a raw DDL ON DELETE clause.
    if (r.deleteBehaviorSource !== "fluent" && r.deleteBehaviorSource !== "declared") continue;
    const answer = explain[r.deleteBehavior]!;
    const q = mcq(ctx, {
      id: `entity.delete.${r.id}`,
      generator: "delete-behavior",
      prompt: `${r.dependent} references ${r.principal}. When a ${r.principal} row is deleted, what happens to the related ${plural(r.dependent)}?`,
      answer,
      distractors: Object.values(explain).filter((v) => v !== answer),
      subjects: [r.principal, r.dependent],
      rationale: `Relation ${r.id} declares OnDelete(DeleteBehavior.${r.deleteBehavior}).`,
    });
    if (q) out.push(q);
  }
  return out;
}

/** "Which entity has the most relationships?" */
function mostConnected(ctx: Ctx): Question[] {
  const d = degrees(ctx.g);
  if (d.length < 4) return [];
  const top = d[0]!;
  // Skip when the top is tied; the question would have two right answers.
  if (d[1] && d[1].degree === top.degree) return [];
  const q = mcq(ctx, {
    id: "entity.hub",
    generator: "most-connected",
    prompt: "Which entity takes part in the most relationships?",
    answer: top.entity,
    distractors: d.slice(1).map((x) => x.entity),
    subjects: [top.entity],
    rationale: `${top.entity} touches ${top.degree} relations; the next highest is ${d[1]!.entity} with ${d[1]!.degree}.`,
  });
  return q ? [q] : [];
}

/** "What is the shortest path from A to B?" */
function pathBetween(ctx: Ctx): Question[] {
  const out: Question[] = [];
  const named = ctx.g.entities.map((e) => e.name);
  if (named.length < 5) return out;

  const pairs: Array<[string, string, string[]]> = [];
  for (const a of named) {
    for (const b of named) {
      if (a >= b) continue;
      const path = shortestPath(ctx.g, a, b);
      if (path && path.length >= 3) pairs.push([a, b, path]);
    }
  }
  if (pairs.length === 0) return out;

  for (const [a, b, path] of ctx.rnd.sample(pairs, 5)) {
    const answer = path.join(" -> ");
    const distractors: string[] = [];
    for (let i = 0; i < 12 && distractors.length < 6; i++) {
      const middle = ctx.rnd.sample(named.filter((n) => n !== a && n !== b), path.length - 2);
      const s = [a, ...middle, b].join(" -> ");
      if (s !== answer && !distractors.includes(s)) distractors.push(s);
    }
    const q = mcq(ctx, {
      id: `entity.path.${a}.${b}`,
      generator: "shortest-path",
      prompt: `What is the shortest relationship path from ${a} to ${b}?`,
      answer,
      distractors,
      subjects: [a, b],
      rationale: `Breadth-first search over the relation graph gives ${answer}.`,
    });
    if (q) out.push(q);
  }
  return out;
}

/** Composite-key and key-type questions. */
function keyShape(ctx: Ctx): Question[] {
  const out: Question[] = [];
  const composite = ctx.g.entities.filter((e) => e.keys.length > 1);
  const simple = ctx.g.entities.filter((e) => e.keys.length === 1);
  if (composite.length === 1 && simple.length >= 3) {
    const q = mcq(ctx, {
      id: "entity.compositekey",
      generator: "composite-key",
      prompt: "Which entity has a composite primary key?",
      answer: composite[0]!.name,
      distractors: simple.map((e) => e.name),
      subjects: [composite[0]!.name],
      rationale: `${composite[0]!.name} keys on (${composite[0]!.keys.join(", ")}).`,
    });
    if (q) out.push(q);
  }

  // Storage classes for a raw-DDL graph, C# types for everything else. The
  // else-branch covers "fullstack" as well as "efcore", and is correct there
  // only because a fullstack graph's entities come wholly from the .NET side —
  // `extract/src/merge.ts` warns loudly if both stacks ever contribute
  // entities, and that warning is what keeps this ternary honest. `invariants()`
  // does not check it: it only catches a name COLLISION between the two.
  const padding =
    ctx.g.provider === "sqlite-ddl"
      ? ["TEXT", "INTEGER", "REAL", "BLOB"]
      : ["string", "long", "Guid", "int"];

  for (const e of ctx.g.entities) {
    const key = e.keys.length === 1 ? e.properties.find((p) => p.name === e.keys[0]) : undefined;
    if (!key) continue;
    const others = [...new Set(
      ctx.g.entities
        .flatMap((o) => o.keys.map((k) => o.properties.find((p) => p.name === k)?.type))
        .filter((t): t is string => Boolean(t)),
    )];
    const q = mcq(ctx, {
      id: `entity.keytype.${e.name}`,
      generator: "key-type",
      prompt: `What is the type of ${e.name}'s primary key ${key.name}?`,
      answer: key.type,
      // Padding is provider-shaped. Offering `Guid` beside `TEXT` in a raw-DDL
      // graph tells the reader which option came from the schema.
      distractors: [...others, ...padding].filter((t) => t !== key.type),
      subjects: [e.name],
      rationale: `${e.name}.${key.name} is declared ${key.type}.`,
    });
    if (q) out.push(q);
  }
  return out;
}

/** "Which columns make up the unique index on X?" */
function uniqueIndexes(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const e of ctx.g.entities) {
    for (const idx of e.indexes.filter((i) => i.isUnique && i.properties.length > 0)) {
      const answer = idx.properties.join(", ");
      const scalars = e.properties.filter((p) => !p.isNavigation).map((p) => p.name);
      const distractors: string[] = [];
      for (let i = 0; i < 12 && distractors.length < 6; i++) {
        const fake = ctx.rnd.sample(scalars, idx.properties.length).join(", ");
        if (fake !== answer && fake.length > 0 && !distractors.includes(fake)) distractors.push(fake);
      }
      const q = mcq(ctx, {
        id: `entity.uniq.${e.name}.${idx.properties.join("-")}`,
        generator: "unique-index",
        prompt: `${e.name} has a unique index. Which column or columns does it cover?`,
        answer,
        distractors,
        subjects: [e.name],
        rationale: `${e.name} declares a unique index on (${answer}).`,
      });
      if (q) out.push(q);
    }
  }
  return out;
}

/** "Which navigation property is the many side?" */
function navigationType(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const e of ctx.g.entities) {
    const collections = e.properties.filter((p) => p.isNavigation && p.isCollection);
    const refs = e.properties.filter((p) => p.isNavigation && !p.isCollection);
    if (collections.length === 0 || refs.length < 2) continue;
    const answer = ctx.rnd.pick(collections).name;
    const q = mcq(ctx, {
      id: `entity.nav.${e.name}`,
      generator: "collection-navigation",
      prompt: `Which navigation property on ${e.name} is a collection (the "many" side)?`,
      answer,
      distractors: refs.map((p) => p.name),
      subjects: [e.name],
      rationale: `${e.name}.${answer} is declared as a collection navigation.`,
    });
    if (q) out.push(q);
  }
  return out;
}

const GENERATORS = [
  fkTarget, cardinality, notAProperty, requiredness, deleteBehavior,
  mostConnected, pathBetween, keyShape, uniqueIndexes, navigationType,
];

/**
 * Every entity-section multiple-choice question for a graph.
 * Deterministic: the same graph and seed always produce the same list.
 */
export function generateEntityMcq(g: EntityGraph, seed?: number): Question[] {
  const ctx: Ctx = { g, rnd: rng(seed ?? hashSeed(g.repo)) };
  const out: Question[] = [];
  for (const gen of GENERATORS) out.push(...gen(ctx));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
