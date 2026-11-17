/** Internal read-only checks. No schema repair, migration or activation entry.
 * Results certify one table at one observation only, never a global snapshot.
 */
import { BUSINESS_SCHEMA_CONTRACT } from "./d1-schema-contract";

type Query = (sql: string, args: (string | number)[]) => Promise<readonly Record<string, unknown>[]>;
const MAX_SQL_BYTES = 16 * 1024;

/** Exactly match the reviewed table and all its indexes, including implicit PK
 * indexes. Extra indexes, views, triggers and changed DDL fail closed. SQL is
 * bounded and hex encoded before leaving the DB; names and SQL never escape.
 * Does not inspect unrelated provider tables or prove absence of other writers.
 */
export async function assertBusinessSchema(query: Query, table: string) {
  const contract = BUSINESS_SCHEMA_CONTRACT.find(c => c.table === table);
  if (!contract) throw Error("SCHEMA_UNKNOWN_TABLE");
  try {
    const rows = await query(
      `SELECT CASE WHEN length(CAST(type AS BLOB))<=16 THEN type END AS type,CASE WHEN length(CAST(name AS BLOB))<=128 THEN name END AS name,sql IS NULL AS implicit_sql,CASE WHEN length(CAST(sql AS BLOB))<=? THEN hex(CAST(sql AS BLOB)) END AS ddl FROM main.sqlite_schema WHERE tbl_name=? COLLATE NOCASE OR name=? COLLATE NOCASE ORDER BY type COLLATE BINARY,name COLLATE BINARY LIMIT ?`,
      [MAX_SQL_BYTES, table, table, contract.objects.length + 1]);
    if (rows.length !== contract.objects.length) throw Error("SCHEMA_DEFINITION_MISMATCH");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], expected = contract.objects[i];
      if (row.type !== expected.type || row.name !== expected.name ||
          ![0, 1, 0n, 1n].includes(row.implicit_sql as number | bigint)) throw Error("SCHEMA_DEFINITION_MISMATCH");
      if (expected.sqlSha256 === null) {
        if (Number(row.implicit_sql) !== 1 || row.ddl !== null) throw Error("SCHEMA_DEFINITION_MISMATCH");
        continue;
      }
      if (Number(row.implicit_sql) !== 0 || typeof row.ddl !== "string" || row.ddl.length > MAX_SQL_BYTES * 2 ||
          !row.ddl.length || row.ddl.length % 2 || !/^[0-9A-F]+$/.test(row.ddl))
        throw Error("SCHEMA_DEFINITION_MISMATCH");
      const bytes = new Uint8Array(row.ddl.length / 2);
      for (let j = 0; j < bytes.length; j++) bytes[j] = parseInt(row.ddl.slice(j * 2, j * 2 + 2), 16);
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        b => b.toString(16).padStart(2, "0")).join("");
      if (sha256 !== expected.sqlSha256) throw Error("SCHEMA_DEFINITION_MISMATCH");
    }
  } catch (error) {
    throw Error(error instanceof Error && error.message === "SCHEMA_DEFINITION_MISMATCH" ? error.message : "SCHEMA_QUERY_FAILED");
  }
}

/** Called once at a table boundary, not per business row. Only a boolean leaves
 * the engine; violation rows/IDs are never materialized. LIMIT bounds output,
 * not SQLite work: real CPU and account usage still need measurement.
 * Call after assertBusinessSchema, with all writers stopped by the future runner.
 */
export async function assertBusinessForeignKeys(query: Query, table: string) {
  if (!BUSINESS_SCHEMA_CONTRACT.some(c => c.table === table)) throw Error("SCHEMA_UNKNOWN_TABLE");
  try {
    const rows = await query("SELECT 1 AS mismatch FROM pragma_foreign_key_check(?, 'main') LIMIT 1", [table]);
    if (rows.length) throw Error("SCHEMA_FOREIGN_KEY_MISMATCH");
  } catch (error) {
    throw Error(error instanceof Error && error.message === "SCHEMA_FOREIGN_KEY_MISMATCH" ? error.message : "SCHEMA_QUERY_FAILED");
  }
}
