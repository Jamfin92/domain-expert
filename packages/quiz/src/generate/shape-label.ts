import type { EntityGraph, Shape } from "@psq/schema";

/** `shape.name` when the name is unique in `g.shapes`, else
 *  `"<name> (<file>)"`. Extraction keys shapes by `file:name`, so the
 *  labelled form is unique whenever the shape is. Exact, case-sensitive
 *  match — selftest keys on raw text, so `Foo` and `foo` never collide. */
export function shapeLabel(g: EntityGraph, shape: Shape): string {
  let n = 0;
  for (const s of g.shapes) if (s.name === shape.name && ++n > 1) break;
  return n > 1 ? `${shape.name} (${shape.file})` : shape.name;
}
