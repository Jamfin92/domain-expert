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
   * Compared by object identity, not by name. `_Stale/Student.cs` carries a
   * gutted class that shares the detected context's NAME and has its own
   * `OnModelCreating`; it is not the detected context and its mentions are
   * refs. G7 asserts both halves, so rewriting this to `decl.name ===
   * opts.contextDecl?.name` reddens — which it did not before review round 1.
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

/**
 * `entity -> file -> line -> via -> type -> method`.
 *
 * Six keys, which is every field of `EntityRef` — so the order really is
 * total over the emitted tuple, and the comparator's key set is exactly the
 * dedupe key's. Before review round 1 the comment said "total" over five
 * keys, with `type` deduped on but never compared: two refs differing only in
 * `type` tied completely and fell back to `Array.prototype.sort` stability,
 * i.e. to source order. `type` was inserted rather than appended so the
 * relative order of the five original keys is untouched.
 *
 * Each of the six has a deletion mutant that reddens the suite, and so does
 * deleting any one of them from the dedupe key. Neither claim is reasoning:
 * both were run.
 */
export function compareEntityRefs(a: EntityRef, b: EntityRef): number {
  return (
    cmp(a.entity, b.entity) ||
    cmp(a.file, b.file) ||
    a.line - b.line ||
    cmp(a.via, b.via) ||
    cmp(a.type, b.type) ||
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
          //
          // `prev.kind === "punct"` is RECORDED, NOT GATED, and measured
          // inert: the lexer never emits a bare `.` under any other kind —
          // the `.` in `1.5` is part of the number token — so dropping the
          // conjunct leaves the whole suite green. Kept for the reader, in
          // the same category as D-Hb-3's absent `kind` filter.
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

          // The receiver-position rule (H-e). Drop a candidate whose token is
          // a BARE identifier used as a receiver: `prev != "."` and
          // `next == "."`. Two conjuncts, each with its own mutant.
          //
          // MEASURED, across both .NET corpus repos, against the walker with
          // D-Hb-10 already in: 14 of 14 matches are one collision — a
          // framework property inherited from a base class whose name equals
          // an entity's — and 0 are genuine refs. That is 14 of the 303 refs
          // those two repos produce WITH D-Hb-10 and without this rule, i.e.
          // 4.6%; against the 289 that remain after it, 4.8%. The denominator
          // is named because "4.6%" alone is two different numbers.
          //
          // It cannot touch a `dbSetName` ref BY CONSTRUCTION, not by luck:
          // `via = "dbSetName"` is assigned at exactly one place above, inside
          // a guard that requires `prev.text === "."`, and this rule requires
          // `prev != "."`. The two are disjoint. The measured "0 of 101
          // dbSetName refs" is a consequence of that, not a corpus accident.
          //
          // STATED LIMITATIONS, not safety claims. The rule is purely
          // syntactic, so it is wrong in both directions:
          //
          //   OVER-REACH — a genuine static-member access on an entity type,
          //   `Student.Create(...)`, matches and is dropped. Measured
          //   occurrences in the corpus: 0. "0", not "impossible". The fixture
          //   deliberately carries no case asserting the wrong answer for it,
          //   and round 2 removed one that accidentally did.
          //
          //   UNDER-REACH — `?.` and `!.` escape the rule entirely. MEASURED:
          //   the lexer emits `Student?.Name` as `ident` + one `punct` token
          //   `?.`, and `Student!.Name` as `ident` + `punct !` + `punct .`, so
          //   `next.text === "."` is false in both and the ref survives. The
          //   exact corpus phenomenon written `User?.FindFirstValue(...)`
          //   would NOT be dropped. Harmless today because the corpus spells
          //   it `.`, and left alone rather than "fixed" unmeasured — but it
          //   is a hole, not an omission nobody noticed.
          //
          // And the drop is invisible downstream: the rejected alternative was
          // an `EntityRef` field for query-time filtering, which needs a
          // schema change. Nothing can report what was discarded here.
          //
          // This `continue` MUST stay above `seen.add(key)`. Below it, a
          // receiver-position occurrence would poison the dedupe key and
          // suppress a LATER legitimate ref sharing the same tuple.
          const next = i + 1 < body.length ? body[i + 1]! : null;
          const bareReceiver =
            !(prev !== null && prev.text === ".") && next !== null && next.text === ".";
          if (bareReceiver) continue;

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
          // that a consumer could have told apart. Each of the six components
          // has a deletion mutant that reddens — three of them did not until
          // review rounds 1 and 2 went looking.
          //
          // `join("|")` would alias if a component contained a `|`. Recorded,
          // not fixed. A C# identifier cannot contain one, so `entity`,
          // `type`, `method` and `via` are safe by the grammar; `line` is a
          // number. `file` is the soft one — POSIX permits `|` in a filename,
          // so this rests on no such path existing in a .NET repo psq reads,
          // which is weaker than the rest. Left alone because changing the
          // separator would be an unmeasured fix to a problem no input has;
          // said precisely so nobody later reads it as a guarantee.
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
