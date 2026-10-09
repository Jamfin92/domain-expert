import path from "node:path";
import ts from "typescript";
import type { Route } from "@psq/schema";
import { repoRelative } from "../files.js";

/**
 * Which code an express registration dispatches to.
 *
 * The handler is the LAST argument of `app.get(path, mw, handler)`. An inline
 * function is the handler at the route's own line; a reference is followed
 * through the checker to its one declaration. Anything else — a call wrapper
 * (`wrap(h)`), `h.bind(x)`, an array, an overloaded or declaration-less
 * symbol, a declaration outside the repo — yields no handler. Nothing is
 * guessed and nothing is warned about: a missing handler costs one join.
 */

type Handler = NonNullable<Route["handler"]>;

export const INLINE = "<inline>";

const moduleName = (fileName: string): string =>
  path.basename(fileName).replace(/(\.d)?\.[cm]?[jt]sx?$/, "");

function isFunctionLike(node: ts.Node | undefined): boolean {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    node = node.expression;
  }
  return node;
}

export function resolveHandler(
  root: string,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  rel: string,
  routeLine: number,
  args: readonly ts.Expression[],
): Handler | undefined {
  const last = args.length > 1 ? unwrap(args[args.length - 1]!) : undefined;
  if (!last) return undefined;

  if (isFunctionLike(last)) {
    return { type: moduleName(source.fileName), method: INLINE, file: rel, line: routeLine };
  }
  if (!ts.isIdentifier(last) && !ts.isPropertyAccessExpression(last)) return undefined;

  let symbol = checker.getSymbolAtLocation(ts.isIdentifier(last) ? last : last.name);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const decls = symbol?.declarations;
  if (!decls || decls.length !== 1) return undefined;
  const decl = decls[0]!;

  const file = decl.getSourceFile();
  if (file.isDeclarationFile || file.fileName.includes("/node_modules/")) return undefined;
  const declRel = repoRelative(root, file.fileName);
  if (declRel.startsWith("..")) return undefined;

  const at = (name: ts.Node): number => file.getLineAndCharacterOfPosition(name.getStart(file)).line + 1;

  if (ts.isFunctionDeclaration(decl) && decl.name) {
    return { type: moduleName(file.fileName), method: decl.name.text, file: declRel, line: at(decl.name) };
  }
  if (ts.isMethodDeclaration(decl) && ts.isIdentifier(decl.name)) {
    const owner = decl.parent;
    if (ts.isClassDeclaration(owner) && owner.name) {
      return { type: owner.name.text, method: decl.name.text, file: declRel, line: at(decl.name) };
    }
    if (ts.isObjectLiteralExpression(owner)) return member(owner, decl.name, file, declRel, at);
    return undefined;
  }
  if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) && isFunctionLike(decl.initializer)) {
    return { type: moduleName(file.fileName), method: decl.name.text, file: declRel, line: at(decl.name) };
  }
  if (ts.isPropertyAssignment(decl) && ts.isIdentifier(decl.name) && isFunctionLike(decl.initializer)) {
    if (ts.isObjectLiteralExpression(decl.parent)) return member(decl.parent, decl.name, file, declRel, at);
  }
  return undefined;
}

/** `const ctl = { list() {} }` -> type `ctl`; a literal held by nothing nameable has no owner. */
function member(
  literal: ts.ObjectLiteralExpression,
  name: ts.Identifier,
  file: ts.SourceFile,
  declRel: string,
  at: (n: ts.Node) => number,
): Handler | undefined {
  const holder = literal.parent;
  if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) {
    return { type: holder.name.text, method: name.text, file: declRel, line: at(name) };
  }
  return undefined;
}
