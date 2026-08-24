import ts from "typescript";
import type { Shape, ShapeField, ShapeKind } from "@psq/schema";
import { isTestFile, repoRelative } from "../files.js";

/**
 * Read declared structures with the TypeScript checker rather than by matching
 * syntax.
 *
 * The difference is not stylistic. Corpus repo E declares
 * `Omit<RefreshDecision, 'weight' | …> & { … }`; a syntactic reader sees three
 * properties where there are ten, and a question built on that is wrong rather
 * than merely absent. Asking the checker for the properties of the resolved
 * type gets inheritance, intersections and utility types right by construction.
 *
 * The same trick reads zod. `z.object({...}).extend({...})` carries its result
 * in the `_output` type, so a zod schema is read through zod's own type-level
 * machinery instead of by re-implementing it.
 */

function stripWrappers(typeText: string): string {
  let t = typeText.trim();
  t = t.replace(/\s*\|\s*(null|undefined)\b/g, "").trim();
  const array = /^(?:Readonly)?Array<(.+)>$/.exec(t);
  if (array) return array[1]!.trim();
  if (t.endsWith("[]")) return t.slice(0, -2).trim();
  return t;
}

function looksLikeCollection(typeText: string): boolean {
  const t = typeText.replace(/\s*\|\s*(null|undefined)\b/g, "").trim();
  return t.endsWith("[]") || /^(?:Readonly)?Array</.test(t);
}

function fieldsOf(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): ShapeField[] {
  return checker
    .getPropertiesOfType(type)
    .filter((prop) => !prop.getName().startsWith("_"))
    .map((prop) => {
      const propType = checker.getTypeOfSymbolAtLocation(prop, at);
      const text = checker.typeToString(propType);
      const declaredOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      return {
        name: prop.getName(),
        type: text,
        baseType: stripWrappers(text),
        // `?:`, `| null` and `| undefined` all say the same thing about the
        // field, and a row/DTO pair routinely disagrees about which to use.
        optional: declaredOptional || /\b(null|undefined)\b/.test(text),
        isCollection: looksLikeCollection(text),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The members of a union of string literals, in declared order. */
function literalMembers(type: ts.Type): string[] {
  if (type.isStringLiteral()) return [type.value];
  if (!type.isUnion()) return [];
  const out: string[] = [];
  for (const part of type.types) {
    if (!part.isStringLiteral()) return [];
    out.push(part.value);
  }
  return out;
}

/**
 * The property whose value tells the members of a union apart. Every member
 * must declare it, and every member's value must be a distinct string literal —
 * anything less is not a discriminant, and saying it is would be a guess.
 */
function discriminatorOf(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): string | null {
  if (!type.isUnion() || type.types.length < 2) return null;
  const first = type.types[0]!;
  if (first.isStringLiteral()) return null;

  for (const prop of checker.getPropertiesOfType(first)) {
    const name = prop.getName();
    const seen = new Set<string>();
    let ok = true;
    for (const part of type.types) {
      const member = checker.getPropertyOfType(part, name);
      if (!member) {
        ok = false;
        break;
      }
      const memberType = checker.getTypeOfSymbolAtLocation(member, at);
      if (!memberType.isStringLiteral() || seen.has(memberType.value)) {
        ok = false;
        break;
      }
      seen.add(memberType.value);
    }
    if (ok) return name;
  }
  return null;
}

function shapeFrom(
  checker: ts.TypeChecker,
  name: string,
  kind: ShapeKind,
  type: ts.Type,
  at: ts.Node,
  file: string,
  module: string | null,
): Shape | null {
  const members = literalMembers(type);
  const fields = members.length > 0 ? [] : fieldsOf(checker, type, at);
  if (fields.length === 0 && members.length === 0) return null;

  return {
    name,
    file,
    module,
    kind,
    fields,
    members,
    discriminator: members.length > 0 ? null : discriminatorOf(checker, type, at),
    mirrors: null,
    mirrorSource: "inferred",
  };
}

/**
 * A zod schema's resolved output type, or null when the declaration is not one.
 * Reading `_output` is what makes `.extend()`, `.optional()`, `.default()` and
 * a cross-file schema reference all resolve without psq modelling any of them.
 */
function zodOutput(checker: ts.TypeChecker, decl: ts.VariableDeclaration): ts.Type | null {
  if (!decl.initializer) return null;
  const type = checker.getTypeAtLocation(decl.name);
  const output = checker.getPropertyOfType(type, "_output");
  if (!output) return null;
  return checker.getTypeOfSymbolAtLocation(output, decl);
}

export function readShapes(
  root: string,
  checker: ts.TypeChecker,
  sources: readonly ts.SourceFile[],
  warnings: string[],
): Shape[] {
  const out: Shape[] = [];
  const seen = new Set<string>();

  const push = (shape: Shape | null): void => {
    if (!shape) return;
    const key = `${shape.file}:${shape.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(shape);
  };

  for (const source of sources) {
    const rel = repoRelative(root, source.fileName);
    if (isTestFile(rel)) continue;

    for (const statement of source.statements) {
      try {
        if (ts.isInterfaceDeclaration(statement)) {
          const name = statement.name.text;
          const symbol = checker.getSymbolAtLocation(statement.name);
          if (!symbol) continue;
          push(
            shapeFrom(
              checker, name, "interface",
              checker.getDeclaredTypeOfSymbol(symbol), statement, rel, null,
            ),
          );
        } else if (ts.isTypeAliasDeclaration(statement)) {
          const name = statement.name.text;
          const symbol = checker.getSymbolAtLocation(statement.name);
          if (!symbol) continue;
          push(
            shapeFrom(
              checker, name, "type-alias",
              checker.getDeclaredTypeOfSymbol(symbol), statement, rel, null,
            ),
          );
        } else if (ts.isEnumDeclaration(statement)) {
          push({
            name: statement.name.text,
            file: rel,
            module: null,
            kind: "enum",
            fields: [],
            members: statement.members.map((m) =>
              ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : m.name.getText(),
            ),
            discriminator: null,
            mirrors: null,
            mirrorSource: "inferred",
          });
        } else if (ts.isVariableStatement(statement)) {
          for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name)) continue;
            const output = zodOutput(checker, decl);
            if (!output) continue;
            push(shapeFrom(checker, decl.name.text, "zod", output, decl, rel, null));
          }
        }
      } catch (err) {
        const { line } = source.getLineAndCharacterOfPosition(statement.getStart());
        warnings.push(`${rel}:${line + 1}: could not resolve a declaration (${(err as Error).message})`);
      }
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
}
