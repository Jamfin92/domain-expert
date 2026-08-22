import type { Shape, ShapeField, ShapeKind } from "@psq/schema";
import type { FileParse, TypeDecl } from "./structure.js";

/**
 * The classes an EF graph throws away.
 *
 * `extractDotnet` keeps only what is reachable from a `DbSet<T>`, which is what
 * stops corpus-repo-b's stale duplicates from being counted as entities.
 * Those discarded classes are not noise, though: the DTOs among them are the
 * other half of every drift question, so they are collected here instead of
 * dropped.
 *
 * The filter is "does this carry data" rather than "is this named like a DTO",
 * because a service with eight methods is not a shape and a record with three
 * properties is, whatever either is called.
 */

/** A data carrier: enough properties to describe something, few enough methods
 *  that describing something is what it is for. */
const MIN_PROPERTIES = 2;
const MAX_METHODS = 1;

function kindFor(decl: TypeDecl): ShapeKind {
  return decl.keyword === "interface" ? "interface" : "class";
}

export function csharpShapes(
  parses: readonly FileParse[],
  entityNames: ReadonlySet<string>,
  unwrap: (type: string) => { base: string; isCollection: boolean; nullable: boolean },
): Shape[] {
  const out: Shape[] = [];
  const seen = new Set<string>();

  for (const parse of parses) {
    for (const decl of parse.types) {
      if (entityNames.has(decl.name)) continue;
      if (decl.modifiers.includes("static")) continue;
      // Enum members are not part of what the C# reader records today, so an
      // enum here would be a shape with nothing in it. TS enums still produce
      // member questions; C# ones wait for the reader to grow.
      if (decl.keyword === "enum") continue;
      if (decl.bases.some((b) => /DbContext/.test(b))) continue;

      const properties = decl.properties.filter(
        (p) => !p.modifiers.includes("static") && !p.modifiers.includes("const"),
      );
      if (properties.length < MIN_PROPERTIES) continue;
      if (decl.methods.length > MAX_METHODS) continue;
      if (properties.some((p) => /^DbSet</.test(p.type))) continue;

      const key = `${parse.file}:${decl.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const fields: ShapeField[] = properties
        .map((p) => {
          const u = unwrap(p.type);
          return {
            name: p.name,
            type: p.type,
            baseType: u.base,
            optional: u.nullable,
            isCollection: u.isCollection,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      out.push({
        name: decl.name,
        file: parse.file,
        module: decl.namespace ?? parse.namespace,
        kind: kindFor(decl),
        fields,
        members: [],
        discriminator: null,
        mirrors: null,
        mirrorSource: "inferred",
      });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
}
