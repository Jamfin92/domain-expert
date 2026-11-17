import type {
  Coverage, CoverageStatus, RepoSummary, SkipEntry, SkipReason, WarningCode,
} from "@/lib/api";

/**
 * View-model for what psq read: the coverage card, the no-entities banner and
 * the Dashboard's warning list. Pure, no React. It derives no fact of its own;
 * it only decides which coverage rows are worth a reader's attention.
 */

export interface CoverageRow {
  facet: keyof Coverage;
  status: CoverageStatus;
  filesRead: number;
  readers: string[];
  reason: string | null;
  skipped: SkipEntry[];
}

/**
 * Skips that mean psq knowingly left input unread. `test-file`, `migrations`
 * and `declaration` are policy exclusions, not gaps, so they are not listed.
 */
const CAVEAT_SKIPS: ReadonlySet<SkipReason> = new Set<SkipReason>(["walk-limit", "unreadable", "other-project"]);

/**
 * One row per facet, in the order the coverage object delivers its keys. The
 * server's JSON keeps the schema's order, and no facet list is hardcoded here,
 * so a tenth facet shows up without a web change.
 */
export function coverageRows(c: Coverage): CoverageRow[] {
  return (Object.keys(c) as (keyof Coverage)[]).map((facet) => {
    const f = c[facet];
    return {
      facet,
      status: f.status,
      filesRead: f.filesRead,
      readers: f.readers,
      reason: f.reason,
      skipped: f.skipped,
    };
  });
}

/**
 * The rows a reader should be told about: a `partial` read, or a skip that
 * left input unread. NOT caveats: `none-found` (the reader ran to completion),
 * `not-read` (that facet was not read; counted in the headline instead) and policy skips.
 */
export function coverageCaveats(c: Coverage): CoverageRow[] {
  return coverageRows(c).filter(
    (r) => r.status === "partial" || r.skipped.some((s) => CAVEAT_SKIPS.has(s.why)),
  );
}

/** `routes: partial — <reason> (skipped 1 walk-limit, 2 other-project)`; only caveat skips are listed. */
export function coverageCaveatText(row: CoverageRow): string {
  const skips = row.skipped.filter((s) => CAVEAT_SKIPS.has(s.why));
  return (
    `${row.facet}: ${row.status}` +
    (row.reason ? ` — ${row.reason}` : "") +
    (skips.length > 0 ? ` (skipped ${skips.map((s) => `${s.count} ${s.why}`).join(", ")})` : "")
  );
}

/** `read` = complete + none-found: both ran over every eligible file. */
export function coverageSummary(c: Coverage): { read: number; partial: number; notRead: number } {
  const out = { read: 0, partial: 0, notRead: 0 };
  for (const r of coverageRows(c)) {
    if (r.status === "partial") out.partial += 1;
    else if (r.status === "not-read") out.notRead += 1;
    else out.read += 1;
  }
  return out;
}

export function coverageHeadline(c: Coverage): string {
  const { read, partial, notRead } = coverageSummary(c);
  const total = coverageRows(c).length;
  // No cause is stated for `not-read`: it is not always the provider (on
  // real repos `pairing` is not-read because one side has nothing to pair).
  return `Read ${read} of ${total} facets in full · ${partial} partial · ${notRead} not read`;
}

/** At most this many warnings are listed on the Dashboard. */
const WARNING_CAP = 6;

/**
 * The Dashboard's warning list: records first (they carry a code), else the
 * strings with `code: null`. The server only sends records when there is one
 * per string (`recordsOf`), so the two never disagree on count.
 */
export function warningItems(
  repo: Pick<RepoSummary, "warnings" | "warningRecords">,
): { code: WarningCode | null; text: string }[] {
  const items =
    // `!= null`: an older server sends no `warningRecords` key at all.
    repo.warningRecords != null
      ? repo.warningRecords.map((r) => ({ code: r.code as WarningCode | null, text: r.text }))
      : repo.warnings.map((text) => ({ code: null, text }));
  return items.slice(0, WARNING_CAP);
}
