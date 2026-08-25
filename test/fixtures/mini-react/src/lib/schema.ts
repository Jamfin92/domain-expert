/**
 * The schema the imagined server runs. It lives in the client fixture so the
 * extractor finds entities and the "shapes but no schema" warning cannot fire
 * underneath the attribution assertions.
 */
export const SCHEMA = `
CREATE TABLE things (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL
);
`;
