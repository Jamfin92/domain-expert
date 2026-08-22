/**
 * Name normalization shared by every extractor.
 *
 * The same domain concept is spelled differently at each layer: a table is
 * `chat_messages`, its EF entity is `ChatMessage`, its DbSet is `ChatMessages`,
 * its row interface is `ChatMessageRow` and its DTO is `ChatMessage`. Pairing a
 * shape with an entity means deciding those are one thing — so the rule that
 * decides it lives in one place and is used by every reader.
 */

/**
 * Naive English pluralization, matching EF's DbSet naming closely enough.
 *
 * Idempotent, because a raw-DDL graph names its entities after its tables and
 * tables are already plural. Pluralizing `packets` again produced `packetses`,
 * which is not a word and told the reader they were being asked about a table
 * by a tool that could not read.
 */
export function plural(name: string): string {
  if (singular(name) !== name) return name;
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

export function singular(name: string): string {
  if (/ies$/i.test(name)) return `${name.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(name)) return name.slice(0, -2);
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.slice(0, -1);
  return name;
}

/**
 * Reduce an identifier to the letters that carry meaning. `project_id`,
 * `projectId` and `ProjectID` all become `projectid`, so a row column and a DTO
 * field can be compared without either spelling winning.
 */
export function fieldKey(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/** Suffixes that mark a shape as a view of something else, not a thing itself. */
const SHAPE_SUFFIXES = ["dto", "row", "record", "response", "request", "payload", "model"];

/**
 * The key a shape and an entity are matched on: strip a view suffix, drop
 * separators and case, then singularize. `TaskRow`, `tasks` and `TaskDto` all
 * reduce to `task`.
 */
export function conceptKey(name: string): string {
  let t = fieldKey(name);
  for (const suffix of SHAPE_SUFFIXES) {
    if (t.length > suffix.length && t.endsWith(suffix)) {
      t = t.slice(0, -suffix.length);
      break;
    }
  }
  return singular(t);
}
