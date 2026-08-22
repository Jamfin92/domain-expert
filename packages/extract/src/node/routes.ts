import ts from "typescript";
import type { Route } from "@psq/schema";
import { isTestFile, repoRelative } from "../files.js";

/**
 * The express surface, extracted as facts.
 *
 * Routes are read now because M5's cross-layer link needs them and because the
 * shape of an API is worth seeing, but M4 asks no questions about them: every
 * question worth asking about a route ("which components break if this
 * changes?") is really a client-side question.
 *
 * Two things make a syntactic reader necessary. Most routes on this machine are
 * registered inside a factory body (`createApp()`), not at the top level, so
 * walking statements is not enough. And corpus-repo-c's factory is declared to
 * return `unknown` and cast at the call site, so the checker knows less about
 * the receiver than the source plainly shows.
 */

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all"]);

function importsExpress(source: ts.SourceFile): boolean {
  return source.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === "express",
  );
}

/** Identifiers in this file that hold an express app or router. */
function receivers(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  const fromCall = (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node)) return false;
    const callee = node.expression;
    if (ts.isIdentifier(callee) && callee.text === "express") return true;
    return (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "express" &&
      callee.name.text === "Router"
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.initializer && fromCall(node.initializer)) names.add(node.name.text);
      // `const app = createApp(deps) as express.Express`
      else if (node.initializer && ts.isAsExpression(node.initializer)) {
        if (/\bExpress\b|\bApplication\b|\bRouter\b/.test(node.initializer.type.getText())) {
          names.add(node.name.text);
        }
      }
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type) {
      if (/\bExpress\b|\bApplication\b|\bRouter\b/.test(node.type.getText())) {
        names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // A file that imports express and calls `app.get(...)` is registering a
  // route, whatever the local binding was inferred as.
  if (importsExpress(source)) {
    for (const name of ["app", "router", "api"]) names.add(name);
  }
  return names;
}

export function readRoutes(
  root: string,
  sources: readonly ts.SourceFile[],
  warnings: string[],
): Route[] {
  const out: Route[] = [];

  for (const source of sources) {
    const rel = repoRelative(root, source.fileName);
    if (isTestFile(rel) || !importsExpress(source)) continue;

    const holders = receivers(source);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const { expression: receiver, name } = node.expression;
        const method = name.text;
        if (
          ts.isIdentifier(receiver) &&
          holders.has(receiver.text) &&
          METHODS.has(method) &&
          node.arguments.length > 0
        ) {
          const first = node.arguments[0]!;
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
            out.push({ method: method.toUpperCase(), path: first.text, file: rel, line: line + 1 });
          } else if (ts.isRegularExpressionLiteral(first)) {
            warnings.push(`${rel}:${line + 1}: ${method.toUpperCase()} route matched by a regular expression; no path recorded`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return out.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}
