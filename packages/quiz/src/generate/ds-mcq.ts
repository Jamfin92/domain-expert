import type { Entity, EntityGraph, Question, Shape } from "@psq/schema";
import { drift } from "@psq/extract";
import { hashSeed, rng, type Rng } from "../rng.js";
import { shapeLabel } from "./shape-label.js";

/**
 * Multiple-choice questions about the shapes beside the tables.
 *
 * The one that earns its keep is drift. A field on a table with no field of
 * that name on the DTO that carries it — or the other way round — is where a
 * service stops lining up with its own storage, and it is invisible while
 * reading either file alone. psq can ask about it only because it holds both.
 *
 * The comparison is by name, and the questions say so. `published_ts` and
 * `publishedAt` are reported as a gap in both directions, which is what psq
 * actually knows: it can see the two names do not match, and it cannot see
 * whether a mapper reconciles them. Claiming the field was "dropped" would be
 * asserting the half psq did not read.
 *
 * Same rules as the entity generators: the answer is read from the graph, the
 * distractors are real siblings, and a question that cannot find enough
 * plausible distractors is not asked.
 */

const MIN_CHOICES = 3;

interface Ctx {
  g: EntityGraph;
  rnd: Rng;
  entities: Map<string, Entity>;
}

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
    section: "ds",
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

function paired(ctx: Ctx): Array<{ shape: Shape; entity: Entity }> {
  const out: Array<{ shape: Shape; entity: Entity }> = [];
  for (const shape of ctx.g.shapes) {
    if (!shape.mirrors) continue;
    const entity = ctx.entities.get(shape.mirrors);
    if (entity) out.push({ shape, entity });
  }
  return out;
}

/** "Which column of X does the DTO not carry?" */
function fieldDrift(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const { shape, entity } of paired(ctx)) {
    const { entityOnly, shared } = drift(entity, shape);
    // Several missing columns is not ambiguity: every distractor is drawn from
    // the fields the two share, so no wrong option is quietly also right.
    if (entityOnly.length === 0 || shared.length < MIN_CHOICES) continue;
    const answer = ctx.rnd.pick(entityOnly);
    const q = mcq(ctx, {
      id: `ds.drift.entity.${entity.name}.${shape.name}`,
      generator: "field-drift",
      prompt: `${shape.name} mirrors ${entity.name}. Which column of ${entity.name} has no field of that name on ${shape.name}?`,
      answer,
      distractors: shared.map((f) => f.column),
      subjects: [entity.name, shape.name],
      rationale: `${shape.name} (${shape.file}) declares no field named ${answer}. It may be dropped at the boundary, or carried under another name — either way the two do not line up.`,
    });
    if (q) out.push(q);
  }
  return out;
}

/** "Which field of the DTO has no column behind it?" */
function dtoOnlyField(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const { shape, entity } of paired(ctx)) {
    const { shapeOnly, shared } = drift(entity, shape);
    if (shapeOnly.length === 0 || shared.length < MIN_CHOICES) continue;
    const answer = ctx.rnd.pick(shapeOnly);
    const q = mcq(ctx, {
      id: `ds.drift.shape.${entity.name}.${shape.name}`,
      generator: "dto-only-field",
      prompt: `Which field of ${shape.name} has no column of that name in ${entity.name}?`,
      answer,
      distractors: shared.map((f) => f.field),
      subjects: [entity.name, shape.name],
      rationale: `${entity.name} declares no column named ${answer}. It is computed, joined, or renamed on the way out.`,
    });
    if (q) out.push(q);
  }
  return out;
}

/** "Which field of X is optional?" */
function optionalField(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const shape of ctx.g.shapes) {
    const optional = shape.fields.filter((f) => f.optional);
    const required = shape.fields.filter((f) => !f.optional);
    if (optional.length !== 1 || required.length < MIN_CHOICES) continue;
    const answer = optional[0]!;
    const label = shapeLabel(ctx.g, shape);
    const q = mcq(ctx, {
      id: `ds.optional.${shape.file}.${shape.name}`,
      generator: "field-optional",
      prompt: `Which field of ${label} is optional?`,
      answer: answer.name,
      distractors: required.map((f) => f.name),
      subjects: [shape.name],
      rationale: `${shape.name}.${answer.name} is declared ${answer.type}; the other options are required.`,
    });
    if (q) out.push(q);
  }
  return out;
}

/** "Which field of X holds many values rather than one?" */
function collectionField(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const shape of ctx.g.shapes) {
    const many = shape.fields.filter((f) => f.isCollection);
    const one = shape.fields.filter((f) => !f.isCollection);
    if (many.length !== 1 || one.length < MIN_CHOICES) continue;
    const answer = many[0]!;
    const label = shapeLabel(ctx.g, shape);
    const q = mcq(ctx, {
      id: `ds.collection.${shape.file}.${shape.name}`,
      generator: "field-collection",
      prompt: `Which field of ${label} holds many values rather than one?`,
      answer: answer.name,
      distractors: one.map((f) => f.name),
      subjects: [shape.name],
      rationale: `${shape.name}.${answer.name} is declared ${answer.type}.`,
    });
    if (q) out.push(q);
  }
  return out;
}

/**
 * "Which of these is NOT a member of X?"
 *
 * The wrong answer is drawn from another union in the same repo, so it reads
 * like something that could plausibly belong and cannot be spotted by tone.
 */
function notAMember(ctx: Ctx): Question[] {
  const out: Question[] = [];
  const withMembers = ctx.g.shapes.filter((s) => s.members.length >= MIN_CHOICES);

  for (const shape of withMembers) {
    const own = new Set(shape.members);
    const foreign = withMembers
      .filter((s) => s.name !== shape.name)
      .flatMap((s) => s.members)
      .filter((m) => !own.has(m));
    if (foreign.length === 0) continue;

    const answer = ctx.rnd.pick([...new Set(foreign)].sort());
    const label = shapeLabel(ctx.g, shape);
    const q = mcq(ctx, {
      id: `ds.member.${shape.file}.${shape.name}`,
      generator: "not-a-member",
      prompt: `Which of these is NOT a member of ${label}?`,
      answer,
      distractors: shape.members,
      subjects: [shape.name],
      rationale: `${shape.name} declares ${shape.members.length} members in ${shape.file}; ${answer} is not one of them.`,
    });
    if (q) out.push(q);
  }
  return out;
}

const GENERATORS = [fieldDrift, dtoOnlyField, optionalField, collectionField, notAMember];

export function generateDsMcq(g: EntityGraph, seed?: number): Question[] {
  const ctx: Ctx = {
    g,
    rnd: rng(seed ?? hashSeed(g.repo)),
    entities: new Map(g.entities.map((e) => [e.name, e])),
  };
  const out: Question[] = [];
  for (const gen of GENERATORS) out.push(...gen(ctx));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
