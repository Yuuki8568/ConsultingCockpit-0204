/** 本人金庫の変更確認: レコード長・監査イベント・ログインイベントを照会（読み取りのみ） */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL!;
const authToken = process.env.DATABASE_AUTH_TOKEN!;
const db = createClient({ url, authToken });

const USER = "R4PGCk91chpfub7fTrxoFmkFoko12KLk";

async function show(label: string, sql: string, args: any[] = []) {
  const r = await db.execute({ sql, args });
  console.log(`\n== ${label} ==`);
  for (const row of r.rows) console.log(JSON.stringify(row));
}

await show(
  "record（本人）",
  "select id,type,length(ciphertext) len from record where user_id=? order by id",
  [USER],
);
await show(
  "audit_event 直近25件（本人）",
  "select seq,action,datetime(at_ms/1000,'unixepoch','+9 hours') jst,device_id from audit_event where user_id=? order by at_ms desc limit 25",
  [USER],
);
await show(
  "login_event 直近10件（本人）",
  "select kind,platform,datetime(at_ms/1000,'unixepoch','+9 hours') jst from login_event where user_id=? order by at_ms desc limit 10",
  [USER],
);
await show("vault（本人）", "select user_id,length(ciphertext) len,updated_at from vault where user_id=?", [USER]).catch(() => {});
