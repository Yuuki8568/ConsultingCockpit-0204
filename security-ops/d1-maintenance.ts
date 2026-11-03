/** Reviewed deployment candidate only. Never imported by the production entry point.
 * Deploying this in place of the main Worker is a full maintenance window:
 * every HTTP route returns 503 and the usual audit cron is replaced by this one-shot job.
 */
import { createClient } from "@libsql/client/web";
import type { Client } from "@libsql/client";
import type { D1Database } from "@cloudflare/workers-types";
import { copyToEmptyD1 } from "../packages/web/src/api/database/d1/migration";
const EXPECTED_SITE = "https://cockpit.yamashirogyomukaizen.com";
export const RUN_ID = "cockpit-d1-cutover-v1";
export const RECEIPT_SCHEMA = `CREATE TABLE IF NOT EXISTS cockpit_cutover_receipt(id TEXT PRIMARY KEY,status TEXT NOT NULL,at_ms INTEGER NOT NULL,manifest TEXT)`;
/** Target business schema and assertion schema must already exist. Receipt is internal.
 * A crash leaves running, and failure leaves failed. Neither is silently retried/activated.
 */
export async function runMigrationOnce(source: Client, target: D1Database, ownerEmails: string[]) {
  const claim = await target
    .prepare(
      "INSERT INTO cockpit_cutover_receipt(id,status,at_ms) VALUES (?,'running',?) ON CONFLICT(id) DO NOTHING RETURNING id",
    )
    .bind(RUN_ID, Date.now())
    .first();
  if (!claim) return { started: false };
  try {
    const result = await copyToEmptyD1(source, target, { maintenanceConfirmed: true, ownerEmails });
    await target
      .prepare(
        "UPDATE cockpit_cutover_receipt SET status='verified',at_ms=?,manifest=? WHERE id=? AND status='running'",
      )
      .bind(
        Date.now(),
        JSON.stringify({ tables: result.manifest, sha256: result.sha256, cutover: false }),
        RUN_ID,
      )
      .run();
    return { started: true, verified: true };
  } catch {
    await target
      .prepare(
        "UPDATE cockpit_cutover_receipt SET status='failed',at_ms=? WHERE id=? AND status='running'",
      )
      .bind(Date.now(), RUN_ID)
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
  async scheduled(_controller: unknown, env: { MIGRATION_TARGET: D1Database }) {
    if (
      process.env.WEBSITE_URL !== EXPECTED_SITE ||
      !process.env.DATABASE_URL?.startsWith("libsql://") ||
      !process.env.DATABASE_AUTH_TOKEN ||
      !process.env.OWNER_EMAILS
    )
      throw Error("MIGRATION_CONFIGURATION_INVALID");
    const owners = process.env.OWNER_EMAILS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!owners.length) throw Error("MIGRATION_CONFIGURATION_INVALID");
    const source = createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
    try {
      return await runMigrationOnce(source, env.MIGRATION_TARGET, owners);
    } finally {
      source.close();
    }
  },
};
