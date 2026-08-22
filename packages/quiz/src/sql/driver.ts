/**
 * The single node:sqlite loader lives in @psq/extract, because the DDL reader
 * needs it too and two copies of a workaround is one copy too many. See
 * `packages/extract/src/sqlite/driver.ts` for why it is not a plain import.
 */
export { DatabaseSync, type Database } from "@psq/extract";
