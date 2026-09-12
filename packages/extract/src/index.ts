export {
  extract,
  extractWithDigest,
  detectProvider,
  EXTRACTOR_VERSION,
  type Provider,
} from "./detect.js";
export { extractDotnet, type DotnetExtractOptions } from "./dotnet.js";
export { extractNode } from "./node.js";
export { parseCSharp } from "./csharp/structure.js";
// `DIGEST_EXTENSIONS` is deliberately NOT re-exported: it is an internal of
// `digestOf`, nothing outside the package consumes it, and `digest.test.ts`
// imports it from `../src/files.js` directly. Same reasoning as the note in
// `merge.test.ts` — a test is not a reason to widen public surface.
export { walk, repoRelative, digestOf } from "./files.js";
export { plural, singular, fieldKey, conceptKey } from "./names.js";
export { pairShapes, drift, type Drift } from "./pair.js";
export { DatabaseSync, type Database } from "./sqlite/driver.js";
