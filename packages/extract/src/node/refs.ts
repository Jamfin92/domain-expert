import ts from "typescript";
import type { ClientCall, Component } from "@psq/schema";
import { isTestFile, repoRelative } from "../files.js";
import { importsExpress } from "./routes.js";

/**
 * Definitions, reference edges, and nearest-component attribution (M5b).
 *
 * The engine here is stack-agnostic symbol resolution: what the file-scope
 * definitions are, which definition references which, and what is reachable
 * backwards from a call site. The single stack-specific question — "is this
 * definition a UI component?" — is a pluggable predicate, with JSX+PascalCase
 * as detector #1, so another stack is a new detector rather than engine
 * surgery.
 *
 * Everything this module cannot prove is a skip, never a default:
 *   - an identifier the checker cannot resolve produces no edge
 *   - a resolved declaration outside the repo, in a .d.ts, or not indexed as
 *     a definition produces no edge
 *   - a call site outside every definition attributes to nothing
 *   - two definitions sharing one key keep the first and warn; the second is
 *     not indexed, so references to it resolve to no definition at all rather
 *     than to the wrong one
 */

/** "<repo-relative file>#<name>"; anonymous default exports use "default". */
type DefKey = string;

interface Def {
  key: DefKey;
  name: string;
  file: string;
  line: number;
  /** The canonical declaration node — what the checker reports for the symbol. */
  node: ts.Node;
  isComponent: boolean;
}

/**
 * Reference edges D -> E, carrying the referencing node: the deferred wrapper
 * phase needs the call site for argument-index propagation. Not exported to
 * the graph.
 */
interface Edge {
  from: DefKey;
  to: DefKey;
  site: ts.Node;
}

/**
 * The one stack-specific seam. Detector #1 (React): a PascalCase name whose
 * declaration subtree contains JSX. A PascalCase helper with no JSX is not a
 * component; a component whose JSX is produced indirectly is a catalogued
 * miss, never a guess.
 */
export type ComponentDetector = (name: string, declaration: ts.Node) => boolean;

function containsJsx(node: ts.Node): boolean {
  if (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  ) {
    return true;
  }
  return ts.forEachChild(node, containsJsx) === true;
}

export const reactComponentDetector: ComponentDetector = (name, declaration) =>
  /^[A-Z][A-Za-z0-9]*$/.test(name) && containsJsx(declaration);

/** Reverse-BFS depth cap; a deeper chain silently loses its component. */
const MAX_DEPTH = 8;

interface RefGraph {
  defs: Def[];
  /**
   * Index by declaration NODE, never by name: a name-keyed lookup invents
   * edges between same-named locals in different files or scopes.
   */
  byNode: Map<ts.Node, Def>;
  edges: Edge[];
  /** Reverse adjacency: for E, every D with an edge D -> E. */
  reverse: Map<DefKey, Set<DefKey>>;
  /**
   * Canonical nodes of collision LOSERS. A call or reference inside one must
   * resolve to no owner at all — never to the enclosing declaration, which
   * would re-create the fan-out the collision warning exists to prevent.
   */
  dropped: Set<ts.Node>;
}

/**
 * The expression under `as` / `satisfies` / parentheses. A service written
 * `const svc = {...} as const` still defines its members; without unwrapping,
 * the members would not be indexed and their calls would spill to `svc`.
 */
function unwrapExpression(expr: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  ) {
    expr = expr.expression;
  }
  return expr;
}

/**
 * A definition is a named binding whose statement is at SourceFile scope —
 * exactly that scope, or every `const handler = () => …` inside a component
 * becomes a definition. At that scope: function declarations; any
 * VariableDeclaration with an identifier name, whatever the initializer
 * (`const Button = React.forwardRef(...)` included); properties of an
 * object-literal initializer, recursively — a grouped client
 * `const api = { users: { list() {} } }` defines `api.users.list`, not just
 * `api.users`, or a call in `list` would fan out to every caller of every
 * sibling; classes and their methods; anonymous `export default`.
 */
function collectDefs(
  root: string,
  sources: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  detector: ComponentDetector,
  warnings: string[],
): RefGraph {
  const defs: Def[] = [];
  const byNode = new Map<ts.Node, Def>();
  const byKey = new Map<DefKey, Def>();
  const dropped = new Set<ts.Node>();

  const add = (name: string, nameNode: ts.Node | null, visited: ts.Node): void => {
    // Key on the exact node the checker reports for this symbol — whatever
    // `valueDeclaration ?? declarations[0]` returns — not the node we
    // happened to visit. Function overloads collapse onto ONE canonical
    // declaration instead of colliding with themselves — but that node is
    // the FIRST SIGNATURE, which is bodiless: an overloaded component is
    // therefore undetectable (no JSX in a signature) and calls in the
    // overload implementation are unattributed (the implementation node is
    // not indexed, and at statement level there is no outer holder to spill
    // to). Catalogued on the ClientCall schema.
    const sym = nameNode ? checker.getSymbolAtLocation(nameNode) : undefined;
    const canonical = sym?.valueDeclaration ?? sym?.declarations?.[0] ?? visited;
    if (byNode.has(canonical) || dropped.has(canonical)) return; // already decided
    // file and line BOTH derive from the canonical node, so the two can never
    // disagree even if a checker-reported declaration sat in another file.
    const source = canonical.getSourceFile();
    const file = repoRelative(root, source.fileName);
    const key: DefKey = `${file}#${name}`;
    const line = source.getLineAndCharacterOfPosition(canonical.getStart()).line + 1;
    const existing = byKey.get(key);
    if (existing) {
      // A duplicate key would make ClientCall.components resolve ambiguously
      // against components[]. First wins, and the loser is recorded as
      // DROPPED: references to it resolve to no definition, and calls inside
      // it get no owner (ownerDef stops there) — attributing either to the
      // winner or to the enclosing declaration would be a mis-attribution.
      warnings.push(
        `${file}: definitions at line ${existing.line} and line ${line} both produce the key "${key}"; keeping the first`,
      );
      dropped.add(canonical);
      return;
    }
    const def: Def = {
      key,
      name,
      file,
      line,
      node: canonical,
      isComponent: detector(name, canonical),
    };
    defs.push(def);
    byNode.set(canonical, def);
    byKey.set(key, def);
  };

  for (const sourceFile of sources) {
    const rel = repoRelative(root, sourceFile.fileName);
    // Same file set readClientCalls walks: a component defined in a test
    // file is not part of the repo's UI surface, and an express file's
    // handlers are routes, not client-side definitions.
    if (isTestFile(rel) || importsExpress(sourceFile)) continue;

    // Object-literal members are named `svc.getX`, qualified by the full
    // holder chain: `api.get` and `bus.get` in one file are two different
    // members of two different objects, not a collision. The qualification
    // RECURSES: in `const api = { users: { list() {} } }` the innermost
    // definition around list's body must be `api.users.list`, or a call in
    // one nested method would attribute through every sibling of the group.
    const addObjectMembers = (prefix: string, obj: ts.ObjectLiteralExpression): void => {
      for (const prop of obj.properties) {
        if (ts.isShorthandPropertyAssignment(prop)) {
          // The property's canonical declaration IS this node.
          add(`${prefix}.${prop.name.text}`, null, prop);
        } else if (
          (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) &&
          (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
        ) {
          add(`${prefix}.${prop.name.text}`, prop.name, prop);
          if (ts.isPropertyAssignment(prop)) {
            const inner = unwrapExpression(prop.initializer);
            if (ts.isObjectLiteralExpression(inner)) {
              addObjectMembers(`${prefix}.${prop.name.text}`, inner);
            } else if (ts.isClassExpression(inner)) {
              dropped.add(inner);
            }
          }
        } else {
          // Spreads, computed keys, accessors, exotic name kinds: not
          // provably a named member of this object, so not a definition —
          // and a call INSIDE one must not spill outward to the holder,
          // where it would fan out to every component touching any sibling.
          // Dropped: ownerDef stops here and the call stays unattributed.
          dropped.add(prop);
        }
      }
    };

    for (const stmt of sourceFile.statements) {
      if (ts.isFunctionDeclaration(stmt)) {
        if (stmt.name) add(stmt.name.text, stmt.name, stmt);
        // `export default function () {}`: anonymous, keyed "default".
        else add("default", null, stmt);
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue; // destructuring: skipped
          add(decl.name.text, decl.name, decl);
          const init = decl.initializer === undefined ? undefined : unwrapExpression(decl.initializer);
          if (init && ts.isObjectLiteralExpression(init)) {
            addObjectMembers(decl.name.text, init);
          } else if (init && ts.isClassExpression(init)) {
            // A class EXPRESSION's members are never indexed (the key scheme
            // covers class declarations), so any member body would spill to
            // the variable. The whole expression is dropped: calls inside it
            // are unattributed, never handed to the variable's referencers.
            dropped.add(init);
          }
        }
      } else if (ts.isClassDeclaration(stmt)) {
        if (stmt.name) add(stmt.name.text, stmt.name, stmt);
        else add("default", null, stmt); // export default class { }
        for (const member of stmt.members) {
          if (
            ts.isMethodDeclaration(member) &&
            (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
          ) {
            add(member.name.text, member.name, member);
          } else {
            // Constructors, property declarations (arrow-valued included),
            // accessors, computed-name methods, static blocks: not
            // definitions, and a call inside one must not spill to the
            // class — every component referencing the class would own it.
            // The constructor gets NO exception: a type annotation,
            // `instanceof`, a static access or `extends` are all plain
            // identifier references to the class that construct nothing,
            // and the edge walk cannot tell them from `new`. "The class is
            // the constructor's owner" was unprovable, so it is dropped
            // like every other non-method member.
            dropped.add(member);
          }
        }
      } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
        // `export default <expr>` — no name to interpolate.
        add("default", null, stmt);
        const expr = unwrapExpression(stmt.expression);
        // The same member handling as a variable initializer, or a call in a
        // default-exported object's method would spill to the whole export.
        if (ts.isObjectLiteralExpression(expr)) addObjectMembers("default", expr);
        else if (ts.isClassExpression(expr)) dropped.add(expr);
      }
    }
  }

  return { defs, byNode, edges: [], reverse: new Map(), dropped };
}

/**
 * The innermost enclosing definition of a node, or null outside every
 * definition. Innermost matters: for `const svc = { async getX() { … } }` the
 * ancestor chain holds both `svc.getX` and `svc`, and collapsing to `svc`
 * would merge every method into one node — every component touching any
 * method would then own every call. A different notion from
 * `ClientCall.enclosing` (nearest named function); both exist on purpose.
 */
function ownerDef(
  node: ts.Node,
  byNode: ReadonlyMap<ts.Node, Def>,
  dropped: ReadonlySet<ts.Node>,
): Def | null {
  for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
    const def = byNode.get(cur);
    if (def) return def;
    // Inside a collision loser: STOP, with no owner. Walking further out
    // would hand the loser's calls to the enclosing declaration (the class,
    // the holding object) — the schema promises "unattributed rather than
    // mis-attributed", and this is where that promise is kept.
    if (dropped.has(cur)) return null;
  }
  return null;
}

/**
 * A container whose members are SIBLINGS with potentially distinct callers:
 * an unindexed object literal with two or more members, or an array literal
 * with two or more elements. The discriminator is sibling-bearing, not
 * anonymity: `forwardRef(cb)` holds one callback and no siblings, so a call
 * in cb belongs to the definition; `createStore({ loadA, loadB })` holds
 * siblings, and handing loadA's call to the variable fans it out to every
 * component touching loadB. The count is ALL properties, not just
 * indexable-named ones: a computed-key or spread member is still a sibling
 * with its own potential callers — counting only named members would drop
 * such a member when the literal is indexed yet let it fan out when the
 * same literal sits inside a factory call.
 */
function isSiblingBearing(node: ts.Node): boolean {
  if (ts.isObjectLiteralExpression(node)) return node.properties.length >= 2;
  if (ts.isArrayLiteralExpression(node)) return node.elements.length >= 2;
  return false;
}

/**
 * The owning definition FOR A CALL. Same walk as ownerDef, plus the
 * sibling-bearing rule: when the walk crossed a sibling-bearing container
 * that is not itself a set of indexed definitions (a factory argument, a
 * factory return value, an IIFE result, an array of handlers), a
 * NON-COMPONENT owner is refused — attributing would fan the call out across
 * every sibling's callers — and the call is unattributed. A COMPONENT owner
 * is kept: a call inside a component's own options object (the
 * useMutation({ mutationFn, ... }) shape) is the component's call, and the
 * BFS stops at the component immediately, so no fan-out exists to prevent.
 * Deliberately NOT applied to reference-edge resolution (collectEdges): a
 * hook's `useQuery({ queryFn: svc.method })` reference is genuinely the
 * hook's — the hook's body executes it — and refusing it would sever every
 * hook-mediated chain.
 */
function owningDefForCall(callNode: ts.Node, graph: RefGraph): Def | null {
  let crossedSiblings = false;
  for (let cur: ts.Node | undefined = callNode.parent; cur; cur = cur.parent) {
    const def = graph.byNode.get(cur);
    if (def) {
      if (def.isComponent) return def;
      return crossedSiblings ? null : def;
    }
    if (graph.dropped.has(cur)) return null;
    if (isSiblingBearing(cur)) crossedSiblings = true;
  }
  return null;
}

/**
 * Every reference edge between definitions. Inside a definition, every
 * Identifier (property-access names and JSX tag names included — both are
 * Identifier nodes) is resolved through the checker; alias symbols (imports,
 * re-exports, barrels) are followed with getAliasedSymbol. An edge is
 * recorded only when the resolved declaration is under the repo root, is not
 * a .d.ts, and is an indexed definition — everything else is a skip. Bare
 * method references used as values (`queryFn: svc.getThings`) resolve the
 * same way as calls; nothing here requires a CallExpression.
 */
function collectEdges(
  root: string,
  sources: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  graph: RefGraph,
): void {
  const prefix = root.endsWith("/") ? root : `${root}/`;

  for (const sourceFile of sources) {
    const rel = repoRelative(root, sourceFile.fileName);
    if (isTestFile(rel) || importsExpress(sourceFile)) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const from = ownerDef(node, graph.byNode, graph.dropped);
        if (from) {
          let sym = checker.getSymbolAtLocation(node);
          if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
          const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
          if (
            decl &&
            !decl.getSourceFile().isDeclarationFile &&
            decl.getSourceFile().fileName.startsWith(prefix)
          ) {
            const to = graph.byNode.get(decl);
            if (to && to !== from) {
              graph.edges.push({ from: from.key, to: to.key, site: node });
              let set = graph.reverse.get(to.key);
              if (!set) graph.reverse.set(to.key, (set = new Set()));
              set.add(from.key);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

/**
 * Nearest-component attribution for one call node. If the innermost owning
 * definition is itself a component, that component and nothing else.
 * Otherwise BFS over REVERSE edges, recording each component reached and not
 * expanding past it — attributing to every reaching component would make the
 * root App own every call, which is true and useless. `visited` kills
 * cycles; depth is capped at MAX_DEPTH, silently (a catalogued miss).
 */
function attributeOne(callNode: ts.Node, graph: RefGraph, byKey: Map<DefKey, Def>): string[] {
  const owner = owningDefForCall(callNode, graph);
  if (!owner) return []; // module scope: genuinely unowned
  if (owner.isComponent) return [owner.key];

  const found = new Set<DefKey>();
  const visited = new Set<DefKey>([owner.key]);
  let frontier: DefKey[] = [owner.key];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: DefKey[] = [];
    for (const key of frontier) {
      for (const from of graph.reverse.get(key) ?? []) {
        if (visited.has(from)) continue;
        visited.add(from);
        const def = byKey.get(from);
        if (!def) continue;
        if (def.isComponent) found.add(from); // record, do not expand past it
        else next.push(from);
      }
    }
    frontier = next;
  }
  return [...found].sort();
}

/**
 * Build the definition/reference graph and attribute every client call to its
 * nearest component(s). Mutates each call's `components` (every call is
 * assigned, so an unattributed call holds [] because attribution SAID so, not
 * because nothing ran) and returns the component list for the graph.
 */
export function attributeComponents(
  root: string,
  sources: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  calls: readonly ClientCall[],
  callNodes: ReadonlyMap<ClientCall, ts.CallExpression>,
  warnings: string[],
  detector: ComponentDetector = reactComponentDetector,
): Component[] {
  const graph = collectDefs(root, sources, checker, detector, warnings);
  collectEdges(root, sources, checker, graph);
  const byKey = new Map(graph.defs.map((d) => [d.key, d]));

  for (const call of calls) {
    const node = callNodes.get(call);
    if (!node) {
      // Unreachable by construction — readClientCalls records a node for
      // every call it emits — but if it ever happens the honest answer is
      // "attribution could not run", which must not look like "no owner".
      warnings.push(`${call.file}:${call.line}: no AST node recorded for this call; not attributed`);
      call.components = [];
      continue;
    }
    call.components = attributeOne(node, graph, byKey);
  }

  return graph.defs
    .filter((d) => d.isComponent)
    .map(({ key, name, file, line }) => ({ key, name, file, line }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
