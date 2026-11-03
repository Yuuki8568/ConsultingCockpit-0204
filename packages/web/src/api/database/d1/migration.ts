/** Internal cutover helper. No public route. Run ONLY while all source API/auth/cron
 * writers are stopped and destination is detached from the application.
 * Credentials and rows stay inside the runtime; the result contains counts/digests only.
 */
import type { Client, Transaction } from "@libsql/client";
import type { D1Database } from "@cloudflare/workers-types";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as s from "../schema";
import { auditHash } from "../../security/audit";
import { witnessHeadD1, type WitnessService } from "./witness";
import { atomicCheckedBatch } from "../../../../../../cloudflare/d1/atomic-batch";

// Foreign-key parents first. Identifiers are exclusively schema-owned, never user SQL.
const tables = [
  s.user,
  s.account,
  s.session,
  s.verification,
  s.rateLimit,
  s.vault,
  s.record,
  s.device,
  s.deviceSession,
  s.loginEvent,
  s.auditEvent,
  s.auditHead,
  s.passkeyCredential,
  s.securityChallenge,
  s.stepUpTicket,
  s.securityCounter,
  s.writeIdentity,
  s.recordRevision,
];
const definitions = tables.map((t) => {
  const c = getTableConfig(t);
  return {
    name: c.name,
    columns: c.columns.map((x) => x.name),
    keys: [
      ...c.columns.filter((x) => x.primary).map((x) => x.name),
      ...c.primaryKeys.flatMap((k) => k.columns.map((x) => x.name)),
    ],
  };
});
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
type Cell = string | number | null;
type Snapshot = { name: string; columns: string[]; keys: string[]; rows: Cell[][]; digest: string };
const encode = new TextEncoder();
const ROW_LIMIT = 1900000,
  TOTAL_BYTES = 16 * 1024 * 1024,
  TOTAL_ROWS = 2000;
async function digest(value: unknown) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(JSON.stringify(value)))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function normalize(value: unknown): Cell {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "bigint") {
    const n = Number(value);
    if (Number.isSafeInteger(n)) return n;
  }
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
    return value;
  throw Error("UNSUPPORTED_SOURCE_VALUE");
}
async function collect(tx: Transaction, owners: ReadonlySet<string>): Promise<Snapshot[]> {
  const snapshots: Snapshot[] = [];
  let bytes = 0,
    count = 0;
  for (const def of definitions) {
    const info = await tx.execute(`PRAGMA table_info(${quote(def.name)})`);
    if (
      info.rows.length !== def.columns.length ||
      !def.columns.every((c) => info.rows.some((r) => r.name === c))
    )
      throw Error("SOURCE_SCHEMA_MISMATCH:" + def.name);
    // Count/size gate before materializing potentially large or unexpected tables.
    const size = await tx.execute(
      `SELECT count(*) n,coalesce(sum(${def.columns.map((c) => `coalesce(length(CAST(${quote(c)} AS BLOB)),0)`).join("+")}),0) bytes FROM ${quote(def.name)}`,
    );
    if (
      Number(size.rows[0].n) + count > TOTAL_ROWS ||
      Number(size.rows[0].bytes) + bytes > TOTAL_BYTES
    )
      throw Error("MIGRATION_CAPACITY_EXCEEDED");
    const source = await tx.execute(
      `SELECT ${def.columns.map(quote).join(",")} FROM ${quote(def.name)} ORDER BY ${def.keys.map(quote).join(",")}`,
    );
    const rows = source.rows.map((row) => def.columns.map((c) => normalize(row[c])));
    for (const row of rows) {
      const n = encode.encode(JSON.stringify(row)).byteLength;
      if (n > ROW_LIMIT) throw Error("D1_ROW_TOO_LARGE");
      bytes += n;
      if (bytes > TOTAL_BYTES) throw Error("MIGRATION_CAPACITY_EXCEEDED");
    }
    count += rows.length;
    if (def.name === "user") {
      const email = def.columns.indexOf("email"),
        verified = def.columns.indexOf("email_verified");
      if (
        !rows.length ||
        rows.some(
          (r) =>
            typeof r[email] !== "string" ||
            !owners.has(String(r[email]).trim().toLowerCase()) ||
            r[verified] !== 1,
        )
      )
        throw Error("OWNER_MISMATCH");
    }
    if (def.name === "record" && rows.length > 1000) throw Error("APPLICATION_CAPACITY_EXCEEDED");
    if (def.name === "session" && rows.length > 100) throw Error("APPLICATION_CAPACITY_EXCEEDED");
    snapshots.push({ ...def, rows, digest: await digest([def.columns, rows]) });
  }
  const fk = await tx.execute("PRAGMA foreign_key_check");
  if (fk.rows.length) throw Error("SOURCE_FOREIGN_KEY_MISMATCH");
  return snapshots;
}

async function readSource(source: Client, owners: ReadonlySet<string>) {
  const tx = await source.transaction("read");
  try {
    const snapshots = await collect(tx, owners);
    await tx.commit();
    return snapshots;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

/** Verify the exact snapshot to be copied, including independently stored tail anchors. */
async function verifyAudit(snapshots: Snapshot[], witness: WitnessService) {
  if (!witness) throw Error("WITNESS_UNAVAILABLE");
  const rows = (name: string) => {
    const table = snapshots.find((t) => t.name === name)!;
    return table.rows.map((r) => Object.fromEntries(table.columns.map((c, i) => [c, r[i]])));
  };
  const users = new Set(rows("user").map((r) => String(r.id)));
  const events = rows("audit_event"),
    heads = rows("audit_head");
  if ([...events, ...heads].some((r) => !users.has(String(r.user_id))))
    throw Error("AUDIT_OWNER_MISMATCH");
  for (const uid of users) {
    const chain = events
      .filter((r) => r.user_id === uid)
      .sort((a, b) => Number(a.seq) - Number(b.seq));
    let seq = 0,
      hash = "GENESIS";
    for (const r of chain) {
      if (r.seq !== seq + 1 || r.prev_hash !== hash) throw Error("AUDIT_CHAIN_INVALID");
      const computed = await auditHash({
        hashVersion: Number(r.hash_version),
        userId: uid,
        seq: Number(r.seq),
        action: String(r.action),
        atMs: Number(r.at_ms),
        deviceId: r.device_id === null ? null : String(r.device_id),
        payloadCiphertext: r.payload_ciphertext === null ? null : String(r.payload_ciphertext),
        payloadIv: r.payload_iv === null ? null : String(r.payload_iv),
        prevHash: hash,
      });
      if (computed !== r.hash) throw Error("AUDIT_CHAIN_INVALID");
      seq = Number(r.seq);
      hash = computed;
    }
    const head = heads.find((r) => r.user_id === uid);
    if ((head?.seq ?? 0) !== seq || (head?.hash ?? "GENESIS") !== hash)
      throw Error("AUDIT_HEAD_MISMATCH");
    let anchor;
    try {
      anchor = await witnessHeadD1(witness, uid);
    } catch {
      throw Error("WITNESS_UNAVAILABLE");
    }
    if (anchor.seq === 0) {
      if (anchor.hash !== "GENESIS") throw Error("AUDIT_WITNESS_MISMATCH");
    } else if (chain.find((r) => r.seq === anchor.seq)?.hash !== anchor.hash)
      throw Error("AUDIT_WITNESS_MISMATCH");
  }
}

/** No UPDATE/DELETE is ever executed against source or existing destination records.
 * Failure after the import leaves a detached, unverified destination: never auto-cut over.
 */
export async function copyToEmptyD1(
  source: Client,
  destination: D1Database,
  options: { maintenanceConfirmed: boolean; ownerEmails: string[]; witness: WitnessService },
) {
  if (!options.maintenanceConfirmed || !options.ownerEmails.length)
    throw Error("MAINTENANCE_REQUIRED");
  const owners = new Set(options.ownerEmails.map((x) => x.trim().toLowerCase()));
  const snapshots = await readSource(source, owners);
  await verifyAudit(snapshots, options.witness);
  // Schema and emptiness check includes tables with zero rows in the source.
  const metadata = await destination.batch<{ name: string }>(
    definitions.map((d) => destination.prepare(`PRAGMA table_info(${quote(d.name)})`)),
  );
  for (let i = 0; i < definitions.length; i++) {
    const columns = metadata[i].results.map((r) => r.name);
    if (
      columns.length !== definitions[i].columns.length ||
      !definitions[i].columns.every((c) => columns.includes(c))
    )
      throw Error("DESTINATION_SCHEMA_MISMATCH");
  }
  const counts = await destination.batch<{ n: number }>(
    definitions.map((d) => destination.prepare(`SELECT count(*) n FROM ${quote(d.name)}`)),
  );
  if (counts.some((r) => r.results[0].n !== 0)) throw Error("DESTINATION_NOT_EMPTY");
  const allEmpty = definitions
    .map((d) => `NOT EXISTS(SELECT 1 FROM ${quote(d.name)})`)
    .join(" AND ");
  const sentinel = crypto.randomUUID();
  const ops = [
    {
      statement: destination
        .prepare(`INSERT INTO cockpit_atomic_assertion(id,ok) SELECT ?,1 WHERE ${allEmpty}`)
        .bind(sentinel),
      expectedChanges: 1,
    },
  ];
  for (const table of snapshots) {
    const sql = `INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`;
    for (const row of table.rows)
      ops.push({ statement: destination.prepare(sql).bind(...row), expectedChanges: 1 });
  }
  ops.push({
    statement: destination
      .prepare("DELETE FROM cockpit_atomic_assertion WHERE id=?")
      .bind(sentinel),
    expectedChanges: 1,
  });
  await atomicCheckedBatch(destination, ops);
  // Read back independently; never accept a successful write response alone.
  for (const table of snapshots) {
    const rows = await destination
      .prepare(
        `SELECT ${table.columns.map(quote).join(",")} FROM ${quote(table.name)} ORDER BY ${table.keys.map(quote).join(",")}`,
      )
      .all();
    const values = rows.results.map((row) => table.columns.map((c) => normalize(row[c])));
    if (
      values.length !== table.rows.length ||
      (await digest([table.columns, values])) !== table.digest
    )
      throw Error("READBACK_MISMATCH");
  }
  if ((await destination.prepare("PRAGMA foreign_key_check").all()).results.length)
    throw Error("DESTINATION_FOREIGN_KEY_MISMATCH");
  // Detect in-flight old Worker/cron writes after the first snapshot. Maintenance is
  // still required: this comparison does not replace the external write freeze.
  const after = await readSource(source, owners);
  if (after.some((table, i) => table.digest !== snapshots[i].digest)) throw Error("SOURCE_CHANGED");
  await verifyAudit(after, options.witness);
  const manifest = snapshots.map((t) => ({ table: t.name, rows: t.rows.length, sha256: t.digest }));
  return {
    verified: true as const,
    manifest,
    sha256: await digest(manifest),
    sourceModified: false as const,
    cutover: false as const,
  };
}
