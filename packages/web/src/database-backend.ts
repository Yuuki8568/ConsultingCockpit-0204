import type { D1Database } from "@cloudflare/workers-types";
import { readV2Receipt } from "./d1-receipt-v2";

export interface DatabaseBindings {
  COCKPIT_DATABASE_BACKEND?: string;
  COCKPIT_D1?: D1Database;
  COCKPIT_D1_MANIFEST_SHA256?: string;
}
export type DatabaseBackend =
  | { kind: "libsql" }
  | { kind: "d1"; db: D1Database; manifestSha256: string };
const RECEIPT_ID = "cockpit-d1-cutover-v1";
const TABLES = [
  "account",
  "audit_event",
  "audit_head",
  "device",
  "device_session",
  "login_event",
  "passkey_credential",
  "rate_limit",
  "record",
  "record_revision",
  "security_challenge",
  "security_counter",
  "session",
  "step_up_ticket",
  "user",
  "vault",
  "verification",
  "write_identity",
];
const HASH = /^[0-9a-f]{64}$/;
const V2_PIN = /^v2:[0-9a-f]{64}$/;

/** An explicit invalid choice must fail closed, never silently use the old database. */
export function selectDatabaseBackend(env: DatabaseBindings): DatabaseBackend {
  const choice = env.COCKPIT_DATABASE_BACKEND ?? "libsql";
  if (choice === "libsql") return { kind: "libsql" };
  const pin = env.COCKPIT_D1_MANIFEST_SHA256 ?? "";
  if (choice !== "d1" || !env.COCKPIT_D1 || !(HASH.test(pin) || V2_PIN.test(pin)))
    throw Error("Database configuration incomplete");
  return { kind: "d1", db: env.COCKPIT_D1, manifestSha256: pin };
}

/** Recheck the private migration receipt on each invocation; do not cache a failed
 * or successful activation across requests. The environment pin binds this deployment
 * to the reviewed copy, while the target remains free to receive normal future writes.
 */
export async function assertD1MigrationVerified(backend: Extract<DatabaseBackend, { kind: "d1" }>) {
  if (V2_PIN.test(backend.manifestSha256)) {
    const receipt = await readV2Receipt(backend.db);
    if (!receipt || "v2:" + receipt.sha256 !== backend.manifestSha256) throw Error("D1 migration manifest mismatch");
    return;
  }
  const row = await backend.db
    .prepare(
      "SELECT status,manifest FROM cockpit_cutover_receipt r WHERE id=? AND length(manifest)<=16384 " +
      "AND NOT EXISTS(SELECT 1 FROM cockpit_cutover_receipt other WHERE other.id IS NOT r.id) " +
      "AND NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE name='cockpit_execution_control' COLLATE NOCASE)",
    )
    .bind(RECEIPT_ID)
    .first<{ status: string; manifest: string }>();
  if (!row || row.status !== "verified") throw Error("D1 migration is not verified");
  const manifest: unknown = JSON.parse(row.manifest);
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("sha256" in manifest) ||
    manifest.sha256 !== backend.manifestSha256 ||
    !("tables" in manifest) ||
    !Array.isArray(manifest.tables) ||
    manifest.tables.length !== TABLES.length
  )
    throw Error("D1 migration manifest mismatch");
  const names: string[] = [];
  for (const table of manifest.tables) {
    if (
      !table ||
      typeof table !== "object" ||
      typeof table.table !== "string" ||
      !Number.isSafeInteger(table.rows) ||
      table.rows < 0 ||
      typeof table.sha256 !== "string" ||
      !HASH.test(table.sha256)
    )
      throw Error("Invalid D1 migration manifest");
    names.push(table.table);
  }
  if (names.sort().some((name, i) => name !== TABLES[i]))
    throw Error("Invalid D1 migration table set");
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(manifest.tables)),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== backend.manifestSha256) throw Error("D1 migration manifest mismatch");
}
