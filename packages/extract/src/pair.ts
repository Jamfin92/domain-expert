import type { Entity, Shape } from "@psq/schema";
import { conceptKey, fieldKey } from "./names.js";

/**
 * How much of the smaller side must be accounted for by the larger before the
 * two are called the same concept. Below this, a name collision is just a name
 * collision — `Market` the DTO and `markets` the table may be unrelated, and
 * inventing the pairing would invent drift that is not there.
 *
 * Measured against the smaller side on purpose. A DTO that drops half the
 * columns and adds three computed fields is still that table's DTO, and the
 * gap in both directions is exactly what a drift question asks about.
 */
const MIN_OVERLAP = 0.6;

/** One shared field name is a coincidence. Two is a shape. */
const MIN_SHARED = 2;

/**
 * Decide which shapes mirror which entities.
 *
 * A pairing is the premise of every drift question, so it is refused twice
 * over: the names must reduce to the same concept AND the fields must
 * substantially overlap. An ambiguous name is a warning, never a coin toss.
 */
export function pairShapes(entities: Entity[], shapes: Shape[], warnings: string[]): Shape[] {
  const byConcept = new Map<string, Entity[]>();
  for (const e of entities) {
    for (const key of new Set([conceptKey(e.name), conceptKey(e.tableName)])) {
      const bucket = byConcept.get(key);
      if (bucket) bucket.push(e);
      else byConcept.set(key, [e]);
    }
  }

  return shapes.map((shape) => {
    if (shape.fields.length === 0) return shape;

    const candidates = byConcept.get(conceptKey(shape.name));
    if (!candidates || candidates.length === 0) return shape;
    if (candidates.length > 1) {
      warnings.push(
        `${shape.file}: ${shape.name} could mirror ${candidates.map((c) => c.name).join(" or ")}; not paired`,
      );
      return shape;
    }

    const entity = candidates[0]!;
    const columns = new Set(
      entity.properties.filter((p) => !p.isNavigation).map((p) => fieldKey(p.column)),
    );
    const hits = shape.fields.filter((f) => columns.has(fieldKey(f.name))).length;
    const smaller = Math.min(shape.fields.length, columns.size);
    if (hits < MIN_SHARED || smaller === 0 || hits / smaller < MIN_OVERLAP) return shape;

    return { ...shape, mirrors: entity.name, mirrorSource: "inferred" as const };
  });
}

export interface Drift {
  /** Columns with no field of that name on the shape. */
  entityOnly: string[];
  /** Fields with no column of that name on the entity. */
  shapeOnly: string[];
  /**
   * Fields present on both, carrying each side's spelling.
   *
   * Both spellings, because a question's distractors have to come from the
   * same side as its answer. `cost_usd` sitting beside `publishedAt` in one
   * list of options identifies the odd one out by casing, and a question that
   * can be answered without knowing the codebase measures nothing.
   */
  shared: Array<{ column: string; field: string }>;
}

/** Fields on the entity that its paired shape does not carry, and the inverse. */
export function drift(entity: Entity, shape: Shape): Drift {
  const columns = entity.properties.filter((p) => !p.isNavigation);
  const fieldsByKey = new Map(shape.fields.map((f) => [fieldKey(f.name), f.name]));
  const columnKeys = new Set(columns.map((p) => fieldKey(p.column)));

  const shared: Array<{ column: string; field: string }> = [];
  const entityOnly: string[] = [];
  for (const p of columns) {
    const field = fieldsByKey.get(fieldKey(p.column));
    if (field === undefined) entityOnly.push(p.column);
    else shared.push({ column: p.column, field });
  }

  return {
    entityOnly,
    shapeOnly: shape.fields.filter((f) => !columnKeys.has(fieldKey(f.name))).map((f) => f.name),
    shared,
  };
}
