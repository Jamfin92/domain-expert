import type { WarningCode, WarningRecord } from "@psq/schema";

/**
 * The one collector every reader fills (P2b).
 *
 * A warning is pushed as a typed record whose `text` is exactly the sentence
 * the site built before records existed. `strings` is DERIVED from the records,
 * so `graph.warnings[i] === graph.warningRecords[i].text` holds by
 * construction rather than by two lists kept in step by hand.
 *
 * No formatting happens here: the caller passes the finished text.
 */
export class Warnings {
  readonly records: WarningRecord[] = [];

  push(
    code: WarningCode,
    text: string,
    where: { file?: string | null; line?: number | null; about?: string | null } = {},
  ): void {
    this.records.push({
      code,
      file: where.file ?? null,
      line: where.line ?? null,
      about: where.about ?? null,
      text,
    });
  }

  get strings(): string[] {
    return this.records.map((r) => r.text);
  }

  append(other: Warnings | readonly WarningRecord[]): void {
    const from = other instanceof Warnings ? other.records : other;
    for (const r of from) this.records.push({ ...r });
  }

  /**
   * Copies of the records with every path re-prefixed by `prefix` (the node
   * root in a fullstack merge): `file`, the text's own `file:` prefix (only
   * when the text starts with `file + ":"`, so a body that merely embeds a path
   * is left alone), and `about` where it is a path-bearing key.
   */
  rebase(prefix: string): WarningRecord[] {
    return this.records.map((r) => rebaseRecord(prefix, r));
  }
}

/** Codes whose `about` embeds a node-relative path (`src/x.ts#Name`). */
const PATH_ABOUT: ReadonlySet<WarningCode> = new Set<WarningCode>(["ref-key-collision"]);

function prefixed(prefix: string, p: string): string {
  return prefix === "" ? p : `${prefix}/${p}`;
}

/**
 * The text of a warning about `file`, with its leading `file:` re-prefixed.
 * Shared by warning records and the node facet reasons that repeat a warning
 * word for word (`merge.ts` `prefixFacet`), so the two stay equal.
 */
export function rebaseText(prefix: string, text: string, file: string | null): string {
  if (prefix === "" || file === null || !text.startsWith(`${file}:`)) return text;
  return prefixed(prefix, file) + text.slice(file.length);
}

function rebaseRecord(prefix: string, r: WarningRecord): WarningRecord {
  if (prefix === "") return { ...r };
  return {
    ...r,
    file: r.file === null ? null : prefixed(prefix, r.file),
    about: r.about !== null && PATH_ABOUT.has(r.code) ? prefixed(prefix, r.about) : r.about,
    text: rebaseText(prefix, r.text, r.file),
  };
}

/**
 * `"1 file"` / `"2 files"`. Named `countNoun`, not `plural`: `names.ts`
 * already exports a `plural` (entity-name inflection, used by `@psq/quiz`).
 */
export function countNoun(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
