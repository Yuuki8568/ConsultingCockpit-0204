/** Read-only classification of every main-schema object. No provider or business
 * payload is fetched. The source transaction and target primary session are
 * separate observations. A detached target and frozen writers remain necessary.
 */
import type { Client } from "@libsql/client";
import type { D1Database, D1DatabaseSession } from "@cloudflare/workers-types";
import { BUSINESS_SCHEMA_CONTRACT } from "./d1-schema-contract";
import { assertBusinessSchema } from "./d1-schema-guard";
import { COPY_CHECKPOINT_SCHEMA, COPY_VERIFICATION_SCHEMA } from "./d1-control-schema";
import { EXECUTION_CONTROL_SCHEMA } from "./d1-execution-schema";

type Query = (sql: string, args: (string | number)[]) => Promise<readonly Record<string, unknown>[]>;
type Side = "source" | "destination";
const businessObjects = BUSINESS_SCHEMA_CONTRACT.flatMap(table =>
  table.objects.map(object => ({ name: object.name, type: object.type, owner: table.table })));
const businessNames = BUSINESS_SCHEMA_CONTRACT.map(table => table.table);
const legacyRun = "CREATE TABLE cockpit_migration_run (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('copying','verified','failed')),row_count INTEGER NOT NULL,digest TEXT NOT NULL)";
const legacyRows = "CREATE TABLE cockpit_migration_row (run_id TEXT NOT NULL REFERENCES cockpit_migration_run(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,table_name TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,ordinal))";
const auxiliary = [
  { name: "cockpit_atomic_assertion", ddl: "CREATE TABLE cockpit_atomic_assertion (\n  id TEXT PRIMARY KEY,\n  ok INTEGER NOT NULL CHECK (ok = 1)\n)", pkIndex: true, role: "control" },
  { name: "cockpit_cutover_receipt", ddl: "CREATE TABLE cockpit_cutover_receipt(id TEXT PRIMARY KEY,status TEXT NOT NULL,at_ms INTEGER NOT NULL,manifest TEXT)", pkIndex: true, role: "control" },
  { name: "cockpit_migration_run", ddl: legacyRun, pkIndex: true, role: "control" },
  { name: "cockpit_migration_row", ddl: legacyRows, pkIndex: true, role: "control" },
  { name: "cockpit_copy_checkpoint", ddl: COPY_CHECKPOINT_SCHEMA, pkIndex: false, role: "control" },
  { name: "cockpit_copy_verification", ddl: COPY_VERIFICATION_SCHEMA, pkIndex: false, role: "control" },
  { name: "cockpit_execution_control", ddl: EXECUTION_CONTROL_SCHEMA, pkIndex: false, role: "control" },
  { name: "_cf_KV", ddl: "CREATE TABLE _cf_KV (\n        key TEXT PRIMARY KEY,\n        value BLOB\n      ) WITHOUT ROWID", pkIndex: false, role: "destination-provider" },
  { name: "_cf_METADATA", ddl: "CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )", pkIndex: false, role: "destination-provider" },
  { name: "sqlite_sequence", ddl: "CREATE TABLE sqlite_sequence(name,seq)", pkIndex: false, role: "sqlite" },
  { name: "sqlite_stat1", ddl: "CREATE TABLE sqlite_stat1(tbl,idx,stat)", pkIndex: false, role: "sqlite" },
  { name: "sqlite_stat4", ddl: "CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)", pkIndex: false, role: "sqlite" },
] as const;
const ownerIndex = { name: "cockpit_migration_owner", ddl: "CREATE INDEX cockpit_migration_owner ON cockpit_migration_run(user_id,created_at)" };
const maxObjects = businessObjects.length + auxiliary.length + auxiliary.filter(t => t.pkIndex).length + 1;
const definitions = [...auxiliary.map(t => t.ddl), ownerIndex.ddl];
const auxiliaryIdSql = definitions.map((_, i) => `WHEN CAST(? AS BLOB) THEN ${i}`).join(" ");
const catalogSql = `SELECT CASE WHEN length(CAST(name AS BLOB))<=128 THEN name END AS name,
  CASE WHEN length(CAST(tbl_name AS BLOB))<=128 THEN tbl_name END AS owner,
  type, CASE CAST(sql AS BLOB) ${auxiliaryIdSql} ELSE -1 END AS definition_id,
  sql IS NULL AS implicit_index FROM main.sqlite_schema`;
function mismatch(side: Side): never {
  throw Error(side === "source" ? "INVENTORY_SOURCE_MISMATCH" : "INVENTORY_DESTINATION_MISMATCH");
}
function safeInventoryError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return Error(["INVENTORY_SOURCE_MISMATCH", "INVENTORY_DESTINATION_MISMATCH",
    "INVENTORY_DESTINATION_OCCUPIED", "INVENTORY_CONTROL_MISSING"].includes(code) ? code : "INVENTORY_QUERY_FAILED");
}
export const queryInventorySession = (db: D1DatabaseSession): Query => async (sql, args) =>
  (await db.prepare(sql).bind(...args).all<Record<string, unknown>>()).results;

/** Inventory every name and owner, reject any extra view/index/table/trigger,
 * compare control/provider DDL inside SQLite and require all declared indexes.
 * Business definition hashes are checked separately by the existing table guard.
 * Only fixed allowlisted names flow into later SQL.
 */
export function inspectCatalog(query: Query, side: Side) {
  return inspectSchemaObjects(query, side, "all");
}

/** A mismatched business object must not hide a previously quarantined run.
 * Check the entire namespace attached to the control tables (including triggers,
 * indexes and same-name imitations) before reading or updating their progress.
 */
export async function assertVerificationControls(db: D1DatabaseSession) {
  const catalog = await inspectSchemaObjects(queryInventorySession(db), "destination", "controls");
  if (!["cockpit_atomic_assertion", "cockpit_copy_checkpoint", "cockpit_copy_verification"]
    .every(name => catalog.controls.includes(name))) throw Error("INVENTORY_DESTINATION_MISMATCH");
}

const controlNames = auxiliary.filter(table => table.role === "control").map(table => table.name);
const controlList = controlNames.map(() => "?").join(",");
const controlFilter = `WHERE tbl_name COLLATE NOCASE IN (${controlList}) OR name COLLATE NOCASE IN (${controlList})`;

async function inspectSchemaObjects(query: Query, side: Side, scope: "all" | "controls") {
  try {
    const controlOnly = scope === "controls";
    const filter = controlOnly ? controlFilter : "";
    const args = controlOnly ? [...definitions, ...controlNames, ...controlNames] : definitions;
    const rows = await query(`${catalogSql} ${filter} LIMIT ?`, [...args, maxObjects + 1]);
    if (rows.length > maxObjects || new Set(rows.map(r => r.name)).size !== rows.length) mismatch(side);
    const byName = new Map(rows.map(r => [r.name, r]));
    if (!controlOnly) {
      for (const object of businessObjects) {
        const row = byName.get(object.name);
        if (!row || row.type !== object.type || row.owner !== object.owner) mismatch(side);
        byName.delete(object.name);
      }
    }
    const controls: string[] = [];
    let providerTables = 0;
    for (const [i, table] of auxiliary.entries()) {
      const row = byName.get(table.name);
      if (!row) continue;
      if (side === "source" && table.role !== "sqlite") mismatch(side);
      if (row.type !== "table" || row.owner !== table.name || Number(row.definition_id) !== i) mismatch(side);
      byName.delete(table.name);
      if (table.pkIndex) {
        const pkName = `sqlite_autoindex_${table.name}_1`;
        const pk = byName.get(pkName);
        if (!pk || pk.type !== "index" || pk.owner !== table.name || Number(pk.implicit_index) !== 1) mismatch(side);
        byName.delete(pkName);
      }
      if (table.role === "control") controls.push(table.name);
      else providerTables++;
    }
    if (controls.includes("cockpit_migration_run") !== controls.includes("cockpit_migration_row")) mismatch(side);
    if (controls.includes("cockpit_migration_run")) {
      const index = byName.get(ownerIndex.name);
      if (!index || index.type !== "index" || index.owner !== "cockpit_migration_run" ||
          Number(index.definition_id) !== auxiliary.length) mismatch(side);
      byName.delete(ownerIndex.name);
    }
    if (byName.size) mismatch(side);
    return { controls, businessTables: controlOnly ? 0 : businessNames.length, businessObjects: controlOnly ? 0 : businessObjects.length, providerTables };
  } catch (error) { throw safeInventoryError(error); }
}

export function emptyTablesCondition(names: readonly string[]): string {
  // This helper only accepts names drawn from the source-controlled contracts.
  if (!names.every(name => businessNames.some(table => table === name) ||
      auxiliary.some(t => t.name === name && t.role === "control"))) throw Error("INVENTORY_QUERY_FAILED");
  return names.map(name => `NOT EXISTS(SELECT 1 FROM main."${name}")`).join(" AND ") || "1";
}

export async function requireEmptyTables(query: Query, names: readonly string[]) {
  try {
    const rows = await query(`SELECT ${emptyTablesCondition(names)} AS empty`, []);
    if (rows.length !== 1 || ![0, 1, 0n, 1n].includes(rows[0].empty as number | bigint)) throw Error("INVENTORY_QUERY_FAILED");
    if (!Number(rows[0].empty)) throw Error("INVENTORY_DESTINATION_OCCUPIED");
  } catch (error) { throw safeInventoryError(error); }
}

async function inspectBusinessDefinitions(query: Query, side: Side) {
  for (const name of businessNames) {
    try { await assertBusinessSchema(query, name); }
    catch (error) {
      if (error instanceof Error && error.message === "SCHEMA_DEFINITION_MISMATCH") mismatch(side);
      throw error;
    }
  }
}

async function withSourceRead<T>(source: Pick<Client, "transaction">, inspect: (query: Query) => Promise<T>) {
  const tx = await source.transaction("read").catch(() => { throw Error("INVENTORY_QUERY_FAILED"); });
  try {
    const result = await inspect(async (sql, args) => (await tx.execute({ sql, args })).rows);
    await tx.commit();
    return result;
  } catch (error) {
    try { await tx.rollback(); } catch { /* Preserve the sanitized error. */ }
    throw safeInventoryError(error);
  } finally {
    try { tx.close(); } catch { throw Error("INVENTORY_QUERY_FAILED"); }
  }
}

/** Standalone, source-only inventory. The only queried table is main.sqlite_schema. */
export function inspectSourceInventory(source: Pick<Client, "transaction">) {
  return withSourceRead(source, async query => {
    const catalog = await inspectCatalog(query, "source");
    await inspectBusinessDefinitions(query, "source");
    return { businessTables: catalog.businessTables, businessObjects: catalog.businessObjects,
      sourceProviderTables: catalog.providerTables, cutoverAllowed: false as const };
  });
}

/** Strict admission check before creating a controlled run. All necessary
 * control tables must already exist, and all business and control tables on
 * the destination must be empty. Provider metadata is never copied or emptied.
 */
export async function inspectMigrationInventory(source: Pick<Client, "transaction">, target: D1Database) {
  const sourceState = await inspectSourceInventory(source);
  try {
    const query = queryInventorySession(target.withSession("first-primary"));
    const destination = await inspectCatalog(query, "destination");
    for (const name of ["cockpit_copy_checkpoint", "cockpit_copy_verification", "cockpit_atomic_assertion", "cockpit_execution_control"]) {
      if (!destination.controls.includes(name)) throw Error("INVENTORY_CONTROL_MISSING");
    }
    await inspectBusinessDefinitions(query, "destination");
    await requireEmptyTables(query, [...businessNames, ...destination.controls]);
    return { ...sourceState, destinationProviderTables: destination.providerTables,
      destinationControlTables: destination.controls.length, destinationEmpty: true as const };
  } catch (error) { throw safeInventoryError(error); }
}
