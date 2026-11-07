/** Reviewed deployment candidate only. Never imported by the production entry point.
 * Deploying this in place of the main Worker is a full maintenance window:
 * every HTTP route returns 503 and the usual audit cron is replaced by this one-shot job.
 */
import { createClient } from "@libsql/client/web";
import type { Client } from "@libsql/client";
import type { D1Database } from "@cloudflare/workers-types";
import { copyToEmptyD1 } from "../packages/web/src/api/database/d1/migration";
import type { WitnessService } from "../packages/web/src/api/database/d1/witness";
const EXPECTED_SITE = "https://cockpit.yamashirogyomukaizen.com";
export const RUN_ID = "cockpit-d1-cutover-v1";
export const RECEIPT_SCHEMA = `CREATE TABLE IF NOT EXISTS cockpit_cutover_receipt(id TEXT PRIMARY KEY,status TEXT NOT NULL,at_ms INTEGER NOT NULL,manifest TEXT)`;
/** Target business schema and assertion schema must already exist. Receipt is internal.
 * A crash leaves running, and failure leaves failed. Neither is silently retried/activated.
 */
const errorCodes = new Set([
  "MAINTENANCE_REQUIRED",
  "OWNER_MISMATCH",
  "MIGRATION_CAPACITY_EXCEEDED",
  "APPLICATION_CAPACITY_EXCEEDED",
  "D1_ROW_TOO_LARGE",
  "UNSUPPORTED_SOURCE_VALUE",
  "DESTINATION_SCHEMA_MISMATCH",
  "DESTINATION_NOT_EMPTY",
  "SOURCE_FOREIGN_KEY_MISMATCH",
  "DESTINATION_FOREIGN_KEY_MISMATCH",
  "READBACK_MISMATCH",
  "SOURCE_CHANGED",
  "WITNESS_UNAVAILABLE",
  "AUDIT_OWNER_MISMATCH",
  "AUDIT_CHAIN_INVALID",
  "AUDIT_HEAD_MISMATCH",
  "AUDIT_WITNESS_MISMATCH",
  "RECEIPT_UPDATE_FAILED",
]);
function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("SOURCE_SCHEMA_MISMATCH:")) return "SOURCE_SCHEMA_MISMATCH";
  return errorCodes.has(message) ? message : "MIGRATION_FAILED";
}
export async function runMigrationOnce(
  source: Client,
  target: D1Database,
  ownerEmails: string[],
  witness: WitnessService,
) {
  const claim = await target
    .prepare(
      "INSERT INTO cockpit_cutover_receipt(id,status,at_ms) VALUES (?,'running',?) ON CONFLICT(id) DO NOTHING RETURNING id",
    )
    .bind(RUN_ID, Date.now())
    .first();
  if (!claim) return { started: false };
  try {
    const result = await copyToEmptyD1(source, target, {
      maintenanceConfirmed: true,
      ownerEmails,
      witness,
    });
    const written = await target
      .prepare(
        "UPDATE cockpit_cutover_receipt SET status='verified',at_ms=?,manifest=? WHERE id=? AND status='running'",
      )
      .bind(
        Date.now(),
        JSON.stringify({ tables: result.manifest, sha256: result.sha256, cutover: false }),
        RUN_ID,
      )
      .run();
    if (written.meta.changes !== 1) throw Error("RECEIPT_UPDATE_FAILED");
    return { started: true, verified: true };
  } catch (error) {
    await target
      .prepare(
        "UPDATE cockpit_cutover_receipt SET status='failed',at_ms=?,manifest=? WHERE id=? AND status='running'",
      )
      .bind(
        Date.now(),
        JSON.stringify({ error_code: safeErrorCode(error), cutover: false }),
        RUN_ID,
      )
      .run();
    return { started: true, verified: false };
  }
}
export default {
  async fetch() {
    return new Response(
      "Cockpitは保存先の切替準備中です。端末内の未送信データは保持されます。しばらく待って再読み込みしてください。",
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": "60",
        },
      },
    );
  },
  async scheduled(
    _controller: unknown,
    env: { MIGRATION_TARGET: D1Database; AUDIT_WITNESS: WitnessService },
  ) {
    const notBefore = Number(process.env.MIGRATION_NOT_BEFORE);
    if (
      !Number.isFinite(notBefore) ||
      notBefore <= 0 ||
      process.env.WEBSITE_URL !== EXPECTED_SITE ||
      !process.env.DATABASE_URL?.startsWith("libsql://") ||
      !process.env.DATABASE_AUTH_TOKEN ||
      !process.env.OWNER_EMAILS ||
      !env.AUDIT_WITNESS
    )
      throw Error("MIGRATION_CONFIGURATION_INVALID");
    if (Date.now() < notBefore) return { waiting: true };
    const owners = process.env.OWNER_EMAILS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!owners.length) throw Error("MIGRATION_CONFIGURATION_INVALID");
    const source = createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
    try {
      return await runMigrationOnce(source, env.MIGRATION_TARGET, owners, env.AUDIT_WITNESS);
    } finally {
      source.close();
    }
  },
};
