import type { Token } from "./lex.js";

/**
 * Reads EF Core fluent configuration out of an OnModelCreating body.
 *
 * A statement like
 *   builder.Entity<Department>()
 *          .HasOne(d => d.County)
 *          .WithMany(c => c.Departments)
 *          .HasForeignKey(d => d.CountyId);
 * becomes { receiver: "builder", calls: [Entity<Department>, HasOne, WithMany,
 * HasForeignKey] } with the lambda bodies reduced to member names.
 */

export interface FluentCall {
  name: string;
  /** Generic arguments, e.g. ["Department"] for Entity<Department>(). */
  typeArgs: string[];
  /** Raw argument tokens, excluding the outer parentheses. */
  args: Token[];
}

export interface FluentChain {
  receiver: string;
  calls: FluentCall[];
  line: number;
}

function matchParen(tokens: Token[], open: number): number {
  const openText = tokens[open]!.text;
  const closeText = openText === "(" ? ")" : openText === "<" ? ">" : "}";
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i]!.text;
    if (t === openText) depth++;
    else if (t === closeText) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Split a body into top-level statements at `;`.
 * Depth tracking keeps `;` inside lambdas, initializers or nested blocks from
 * ending a statement early.
 */
export function splitStatements(body: Token[]): Token[][] {
  const out: Token[][] = [];
  let cur: Token[] = [];
  let depth = 0;
  for (const t of body) {
    if (t.text === "(" || t.text === "[" || t.text === "{") depth++;
    if (t.text === ")" || t.text === "]" || t.text === "}") depth--;
    if (t.text === ";" && depth <= 0) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Parse one statement as a method chain. Returns null when the statement is
 * not a chain (a local declaration, an if, a loop, ...).
 */
export function parseChain(stmt: Token[]): FluentChain | null {
  if (stmt.length === 0) return null;
  const first = stmt[0]!;
  if (first.kind !== "ident" && first.kind !== "keyword") return null;
  // Reject control flow and declarations outright.
  if (["if", "for", "foreach", "while", "return", "var", "switch", "using", "try"].includes(first.text)) {
    return null;
  }

  const receiver = first.text;
  const calls: FluentCall[] = [];
  let i = 1;

  while (i < stmt.length) {
    if (stmt[i]!.text !== ".") break;
    i++;
    const nameTok = stmt[i];
    if (!nameTok || (nameTok.kind !== "ident" && nameTok.kind !== "keyword")) break;
    const name = nameTok.text;
    i++;

    const typeArgs: string[] = [];
    if (stmt[i]?.text === "<") {
      const close = matchParen(stmt, i);
      if (close === -1) break;
      // split top-level commas inside the generic argument list
      let depth = 0;
      let cur: string[] = [];
      for (let k = i + 1; k < close; k++) {
        const t = stmt[k]!.text;
        if (t === "<") depth++;
        if (t === ">") depth--;
        if (t === "," && depth === 0) {
          typeArgs.push(cur.join(""));
          cur = [];
          continue;
        }
        cur.push(t);
      }
      if (cur.length) typeArgs.push(cur.join(""));
      i = close + 1;
    }

    let args: Token[] = [];
    if (stmt[i]?.text === "(") {
      const close = matchParen(stmt, i);
      if (close === -1) break;
      args = stmt.slice(i + 1, close);
      i = close + 1;
    } else {
      // property access rather than a call, e.g. `.Entity<X>().Metadata`
      calls.push({ name, typeArgs, args: [] });
      continue;
    }

    calls.push({ name, typeArgs, args });
  }

  if (calls.length === 0) return null;
  return { receiver, calls, line: first.line };
}

/**
 * Reduce a lambda argument to the member names it selects.
 *   d => d.CountyId                     -> ["CountyId"]
 *   uc => new { uc.UserId, uc.CountyId } -> ["UserId", "CountyId"]
 *   c => c.Slug                          -> ["Slug"]
 * Returns [] when the argument is not a member-selecting lambda.
 */
export function lambdaMembers(args: Token[]): string[] {
  const arrow = args.findIndex((t) => t.text === "=>");
  if (arrow === -1) return [];
  const param = args[0]?.text;
  const body = args.slice(arrow + 1);
  const members: string[] = [];

  for (let i = 0; i < body.length; i++) {
    // `param . Member`
    if (body[i]!.text === param && body[i + 1]?.text === "." ) {
      const m = body[i + 2];
      if (m && (m.kind === "ident" || m.kind === "keyword")) {
        members.push(m.text);
        i += 2;
      }
    }
  }
  return members;
}

/** The single type argument of a call, or null. */
export function soleTypeArg(call: FluentCall): string | null {
  return call.typeArgs.length === 1 ? call.typeArgs[0]! : null;
}

/** Read `DeleteBehavior.Cascade` style arguments down to "Cascade". */
export function enumMemberArg(args: Token[]): string | null {
  const dot = args.findIndex((t) => t.text === ".");
  if (dot === -1) {
    const only = args.find((t) => t.kind === "ident");
    return only ? only.text : null;
  }
  const after = args[dot + 1];
  return after ? after.text : null;
}

/** Extract every fluent chain from a method body. */
export function chainsOf(body: Token[]): FluentChain[] {
  const out: FluentChain[] = [];
  for (const stmt of splitStatements(body)) {
    const chain = parseChain(stmt);
    if (chain) out.push(chain);
  }
  return out;
}

/**
 * EF accepts two equivalent configuration styles, and real repos use both:
 *
 *   flat    builder.Entity<Department>().HasOne(...).WithMany(...);
 *   nested  builder.Entity<User>(entity => { entity.HasOne(...)...; ... });
 *
 * Corpus repo A is entirely flat; corpus repo B is entirely nested.
 * Reading only one style silently loses every relationship in the other repo,
 * so both normalize to the same shape here: the entity being configured, plus
 * one call chain per configuration statement.
 */
export interface EntityConfig {
  entity: string;
  calls: FluentCall[];
  line: number;
}

/** Locate a `param => { ... }` block inside an argument list. */
function lambdaBlock(args: Token[]): Token[] | null {
  const arrow = args.findIndex((t) => t.text === "=>");
  if (arrow === -1) return null;
  const brace = args.findIndex((t, i) => i > arrow && t.text === "{");
  if (brace === -1) return null;
  let depth = 0;
  for (let i = brace; i < args.length; i++) {
    const t = args[i]!.text;
    if (t === "{") depth++;
    else if (t === "}") {
      depth--;
      if (depth === 0) return args.slice(brace + 1, i);
    }
  }
  return null;
}

/** Every entity configuration in a method body, with both styles flattened. */
export function entityConfigs(body: Token[]): EntityConfig[] {
  const out: EntityConfig[] = [];

  for (const chain of chainsOf(body)) {
    const entityIdx = chain.calls.findIndex(
      (c) => c.name === "Entity" && c.typeArgs.length === 1,
    );
    if (entityIdx === -1) continue;
    const entityCall = chain.calls[entityIdx]!;
    const entity = entityCall.typeArgs[0]!;

    // nested style: recurse into the configuration lambda
    const block = lambdaBlock(entityCall.args);
    if (block) {
      for (const inner of chainsOf(block)) {
        out.push({ entity, calls: inner.calls, line: inner.line });
      }
    }

    // flat style: whatever follows .Entity<T>() on the same chain
    const rest = chain.calls.slice(entityIdx + 1);
    if (rest.length > 0) out.push({ entity, calls: rest, line: chain.line });
  }

  return out;
}
