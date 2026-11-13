/** Internal, read-only building block for a future resumable migration.
 * Not imported by production, HTTP or cron. The row/cursor are PRIVATE data;
 * never log them or include them in a public preflight/activation response.
 * One transaction covers one row, not the migration. A write freeze, full
 * schema/owner/audit checks and independent digest passes remain necessary.
 */
import type { Client } from "@libsql/client";
import { migrationDefinitions } from "../packages/web/src/api/database/d1/migration-schema";

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export const BOUNDED_ROW_JSON_BYTES = 64 * 1024;
type Cell = string | number | null;
export type BoundedRow =
  | { done: true }
  | { done: false; columns: string[]; values: Cell[]; cursor: string[]; jsonBytes: number };

function normalize(value: unknown): Cell {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "bigint" && Number.isSafeInteger(Number(value))) return Number(value);
  if (typeof value === "number" && Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  throw Error("BOUNDED_UNSUPPORTED_VALUE");
}

function decodeText(value: unknown, rawLimit: number): string {
  // Hex avoids native libSQL's truncation of TEXT results at embedded NUL.
  // Fatal UTF-8 decoding rejects malformed SQLite TEXT rather than repairing it.
  if (typeof value !== "string" || value.length > rawLimit * 2 || value.length % 2 ||
      !/^[0-9A-F]*$/.test(value)) throw Error("BOUNDED_UNSUPPORTED_VALUE");
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  try { return decoder.decode(bytes); } catch { throw Error("BOUNDED_UNSUPPORTED_VALUE"); }
}

/** Reads the immediate next row, never skips an oversized/unsupported row.
 * BINARY, ascending, non-null TEXT primary keys only (the current schema).
 * The SQL guards every returned cell before it crosses the DB boundary.
 * 64KiB is a payload ceiling, NOT proof of Workers Free CPU compliance.
 */
export async function readBoundedMigrationRow(
  source: Pick<Client, "transaction">,
  table: string,
  after: readonly string[] | null,
  maxJsonBytes = BOUNDED_ROW_JSON_BYTES,
): Promise<BoundedRow> {
  const def = migrationDefinitions.find((d) => d.name === table);
  if (!def) throw Error("BOUNDED_UNKNOWN_TABLE");
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes < def.columns.length * 6 + 2 ||
      maxJsonBytes > BOUNDED_ROW_JSON_BYTES) throw Error("BOUNDED_INVALID_LIMIT");
  if (after !== null && (!Array.isArray(after) || after.length !== def.keys.length ||
      after.some((v) => typeof v !== "string" || v.length > BOUNDED_ROW_JSON_BYTES) ||
      encoder.encode(JSON.stringify(after)).byteLength > BOUNDED_ROW_JSON_BYTES ||
      after.some((v) => decoder.decode(encoder.encode(v)) !== v)))
    throw Error("BOUNDED_INVALID_CURSOR");
  // Copy caller-owned state before the first await. Retrying the same cursor
  // repeats the same read; durable progress must be committed with the copy.
  const cursor = after === null ? null : [...after];
  const tx = await source.transaction("read").catch(() => { throw Error("BOUNDED_QUERY_FAILED"); });
  try {
    const info = await tx.execute({ sql: "SELECT name,type,pk,\"notnull\",hidden FROM pragma_table_xinfo(?) LIMIT ?", args: [def.name, def.columns.length + 1] });
    const keys = info.rows.filter((r) => Number(r.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk));
    if (info.rows.length !== def.columns.length ||
        !def.columns.every((c) => info.rows.some((r) => r.name === c && Number(r.hidden) === 0)) ||
        JSON.stringify(keys.map((r) => r.name)) !== JSON.stringify(def.keys) ||
        keys.some((r) => String(r.type).toUpperCase() !== "TEXT" || Number(r.notnull) !== 1))
      throw Error("BOUNDED_SCHEMA_MISMATCH");
    const indices = await tx.execute({ sql: "SELECT name,\"unique\",partial FROM pragma_index_list(?) WHERE origin='pk' LIMIT 2", args: [def.name] });
    if (indices.rows.length !== 1 || typeof indices.rows[0].name !== "string" ||
        Number(indices.rows[0].unique) !== 1 || Number(indices.rows[0].partial) !== 0)
      throw Error("BOUNDED_SCHEMA_MISMATCH");
    const index = await tx.execute({ sql: "SELECT name,coll,desc FROM pragma_index_xinfo(?) WHERE key=1 ORDER BY seqno LIMIT ?", args: [indices.rows[0].name, def.keys.length + 1] });
    if (index.rows.length !== def.keys.length || index.rows.some((r, i) =>
      r.name !== def.keys[i] || r.coll !== "BINARY" || Number(r.desc) !== 0))
      throw Error("BOUNDED_SCHEMA_MISMATCH");

    const bytes = def.columns.map((c) => `coalesce(length(CAST(${quote(c)} AS BLOB)),0)`).join("+");
    const unsupported = def.columns.map((c) => `typeof(${quote(c)}) NOT IN ('null','text','integer','real')`).join(" OR ");
    const validKeys = def.keys.map((c) => `typeof(${quote(c)})='text'`).join(" AND ");
    // Six output bytes per source byte plus per-cell overhead bounds JSON
    // escapes and nulls conservatively. Numeric safety is checked below.
    const rawLimit = Math.floor((maxJsonBytes - def.columns.length * 6 - 2) / 6);
    const guard = `((${bytes})<=${rawLimit} AND NOT (${unsupported}) AND (${validKeys}))`;
    // Qualify original keys so ORDER BY cannot resolve to the encoded output
    // aliases. Put explicit collation on the RHS: wrapping the LHS inhibits
    // SQLite's composite-key seek optimization.
    const keySql = def.keys.map((c) => `_source.${quote(c)}`).join(",");
    const order = def.keys.map((c) => `_source.${quote(c)} COLLATE BINARY`).join(",");
    const where = cursor === null ? "" : ` WHERE (${keySql})>(${def.keys.map(() => "? COLLATE BINARY").join(",")})`;
    const statement = {
      sql: `SELECT (${bytes}) AS _bytes,(${unsupported}) AS _unsupported,(${validKeys}) AS _valid_keys,${def.columns.map((c, i) => `typeof(${quote(c)}) AS _type_${i},CASE WHEN ${guard} THEN CASE WHEN typeof(${quote(c)})='text' THEN hex(CAST(${quote(c)} AS BLOB)) ELSE ${quote(c)} END ELSE NULL END AS ${quote(c)}`).join(",")} FROM ${quote(def.name)} AS _source${where} ORDER BY ${order} LIMIT 1`,
      args: cursor ?? [],
    };
    const result = await tx.execute(statement);
    if (result.rows.length > 1) throw Error("BOUNDED_QUERY_FAILED");
    let answer: BoundedRow = { done: true };
    if (result.rows.length) {
      const row = result.rows[0], rawBytes = Number(row._bytes);
      if (!Number.isSafeInteger(rawBytes) || rawBytes < 0) throw Error("BOUNDED_UNSUPPORTED_VALUE");
      if (Number(row._unsupported) !== 0 || Number(row._valid_keys) !== 1)
        throw Error("BOUNDED_UNSUPPORTED_VALUE");
      if (rawBytes > rawLimit) throw Error("BOUNDED_ROW_TOO_LARGE");
      const values = def.columns.map((c, i) => row[`_type_${i}`] === "text" ? decodeText(row[c], rawLimit) : normalize(row[c]));
      const nextCursor = def.keys.map((c) => values[def.columns.indexOf(c)]);
      if (nextCursor.some((v) => typeof v !== "string")) throw Error("BOUNDED_UNSUPPORTED_VALUE");
      const jsonBytes = encoder.encode(JSON.stringify(values)).byteLength;
      if (jsonBytes > maxJsonBytes) throw Error("BOUNDED_ROW_TOO_LARGE");
      answer = { done: false, columns: [...def.columns], values, cursor: nextCursor as string[], jsonBytes };
    }
    await tx.commit();
    return answer;
  } catch (error) {
    try { await tx.rollback(); } catch { /* Never expose SQL/credentials/row contents. */ }
    const safe = new Set(["BOUNDED_SCHEMA_MISMATCH", "BOUNDED_UNSUPPORTED_VALUE", "BOUNDED_ROW_TOO_LARGE"]);
    throw Error(error instanceof Error && safe.has(error.message) ? error.message : "BOUNDED_QUERY_FAILED");
  } finally {
    try { tx.close(); } catch { throw Error("BOUNDED_QUERY_FAILED"); }
  }
}
