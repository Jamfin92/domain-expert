import type { Property } from "@psq/schema";

/** SQLite storage class for a C# property type. */
export function sqliteType(p: Property): "INTEGER" | "REAL" | "TEXT" | "BLOB" {
  const t = p.baseType.replace(/\?$/, "");
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
