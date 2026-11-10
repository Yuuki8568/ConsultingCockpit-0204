/** Schema-owned identifiers shared by migration and read-only preflight. */
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as s from "../schema";

// Foreign-key parents first. Never accept table/column identifiers from a request.
export const migrationDefinitions = [
  s.user, s.account, s.session, s.verification, s.rateLimit, s.vault,
  s.record, s.device, s.deviceSession, s.loginEvent, s.auditEvent, s.auditHead,
  s.passkeyCredential, s.securityChallenge, s.stepUpTicket, s.securityCounter,
  s.writeIdentity, s.recordRevision,
].map((table) => {
  const c = getTableConfig(table);
  return {
    name: c.name,
    columns: c.columns.map((x) => x.name),
    keys: [
      ...c.columns.filter((x) => x.primary).map((x) => x.name),
      ...c.primaryKeys.flatMap((k) => k.columns.map((x) => x.name)),
    ],
  };
});
