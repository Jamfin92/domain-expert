import type { Property } from "@psq/schema";

/** SQLite storage class for a property, whether C# or raw DDL. */
export function sqliteType(p: Property): "INTEGER" | "REAL" | "TEXT" | "BLOB" {
  const t = p.baseType.replace(/\?$/, "");
  // A raw-DDL graph already carries SQLite storage classes; believe them.
  if (t === "INTEGER" || t === "REAL" || t === "TEXT" || t === "BLOB") return t;
  if (t === "NUMERIC") return "REAL";
  if (["int", "long", "short", "byte", "sbyte", "uint", "ulong", "ushort"].includes(t)) {
    return "INTEGER";
  }
  if (t === "bool") return "INTEGER";
  if (["decimal", "double", "float"].includes(t)) return "REAL";
  if (t === "byte[]") return "BLOB";
  return "TEXT";
}

/** True for types psq can invent a believable value for. */
export function isSeedable(p: Property): boolean {
  return !p.isNavigation;
}
