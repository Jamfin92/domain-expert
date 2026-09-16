import type { EntityRef, RefVia } from "@psq/schema";
import type { FileParse, TypeDecl } from "./structure.js";

/**
 * Every mention of an entity inside a C# method body.
 *
 * Named `entity-refs` and not `refs` to keep it clearly distinct from
 * `src/node/refs.ts`, which is a symbol-level TypeScript reference finder and
 * shares nothing with this but the word.
 *
 * ## Why this runs at extraction time
 *
 * `MethodDecl.body` is a `Token[]` hanging off a `FileParse` that lives only
 * inside `extractDotnet`. The graph keeps no tokens, so this cannot be a
 * post-hoc query over an `EntityGraph` — it has to happen while the parse is
 * still in hand.
 *
 * ## What it is and is not
 *
 * A linear scan over the body tokens of every method of every type, with two
 * exact-text rules and no symbol table. It reports MENTIONS, not calls: see
 * the `EntityRef` doc comment for the full list of what that includes and the
 * blind spots it inherits from the lexer and the structural reader.
 */

export interface EntityRefTarget {
  /** `Entity.name` — the C# class name. */
  name: string;
  /** `Entity.dbSetName` — the DbContext property name, when it has one. */
  dbSetName: string | null;
}

export interface EntityRefOptions {
  /**
   * The detected DbContext declaration. Its `OnModelCreating` is skipped:
   * those mentions are already consumed by `entityConfigs` and modelled as
   * relations, keys and indexes, so re-reporting them as references would say
   * that configuring an entity is a use of it.
   *
   * Compared by object identity, not by name — a second class called
   * `AppDbContext` in another namespace is not the detected context.
   */
  contextDecl: TypeDecl | null;
}

/**
 * Compare two strings by UTF-16 code unit.
 *
 * NOT `localeCompare`, which is ICU-dependent and returns 0 for distinct
 * strings (NFC vs NFD). `dotnet.ts` sorts entities, relations and shapes with
 * `localeCompare` four lines from where this result is sorted; that is the
 * neighbour, and it is deliberately not copied.
 */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `entity -> file -> line -> via -> method`, total over the emitted tuple. */
export function compareEntityRefs(a: EntityRef, b: EntityRef): number {
  return (
    cmp(a.entity, b.entity) ||
    cmp(a.file, b.file) ||
    a.line - b.line ||
    cmp(a.via, b.via) ||
    cmp(a.method, b.method)
  );
}

export function collectEntityRefs(
  parses: FileParse[],
  entities: EntityRefTarget[],
  opts: EntityRefOptions,
): EntityRef[] {
  // Two name-keyed indexes. Name-keying is the stated imprecision (D-Hb-13):
  // with no symbol table on the C# side, a class of the same name in a
  // namespace the context never imports is reported as a ref to the entity.
  // `resolveType` exists to defeat exactly that collision for the entity set
  // itself, and this walker deliberately does not route through it.
  const byEntityName = new Map<string, string>();
  const byDbSetName = new Map<string, string>();
  for (const e of entities) {
    byEntityName.set(e.name, e.name);
    if (e.dbSetName !== null) byDbSetName.set(e.dbSetName, e.name);
  }

  const out: EntityRef[] = [];
  const seen = new Set<string>();

  for (const parse of parses) {
    for (const decl of parse.types) {
      for (const method of decl.methods) {
        if (decl === opts.contextDecl && method.name === "OnModelCreating") continue;

        const body = method.body;
        for (let i = 0; i < body.length; i++) {
          const tok = body[i]!;

          // No `kind` filter, deliberately. `KEYWORDS` is an exact lowercase
          // set, so the only names this could wrongly admit are entities
          // literally called `record`/`get`/`set`/`where` and friends; and
          // string tokens carry their delimiters (`lex.ts:133,157,212`), so
          // `"Student"` can never equal `Student`. Recorded, not gated —
          // neither case has a mutant that could redden a fixture.
          let via: RefVia | null = null;
          let entity: string | undefined;

          // The DbSet rule first: `_db.Students` is a use of the set, whereas
          // a bare `Students` is a local that happens to share the name.
          const prev = i > 0 ? body[i - 1]! : null;
          if (prev !== null && prev.kind === "punct" && prev.text === ".") {
            entity = byDbSetName.get(tok.text);
            if (entity !== undefined) via = "dbSetName";
          }
          if (via === null) {
            entity = byEntityName.get(tok.text);
            if (entity !== undefined) via = "entityName";
          }
          if (via === null || entity === undefined) continue;

          const ref: EntityRef = {
            entity,
            // The REFERENCING file. Already repo-relative — `parseCSharp` is
            // handed `repoRelative(repoRoot, f)` at `dotnet.ts:270`.
            file: parse.file,
            // The matched token's own line, not the method's declaration
            // line: a 200-line method would otherwise report one line for
            // every reference in it.
            line: tok.line,
            type: decl.name,
            method: method.name,
            via,
          };

          // Two mentions on one line collapse; two on different lines do not.
          // The key is the whole emitted tuple, so nothing is deduped away
          // that a consumer could have told apart.
          const key = [ref.entity, ref.file, ref.line, ref.type, ref.method, ref.via].join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(ref);
        }
      }
    }
  }

  return out.sort(compareEntityRefs);
}
