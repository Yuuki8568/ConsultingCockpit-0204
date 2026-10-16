// 金庫内の見積書雛形に「支援内容」が入っているか復号して確認
import { createClient } from "@libsql/client";
import { webcrypto } from "node:crypto";

const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const r = await db.execute({ sql: "select id, user_id, data from record order by id", args: [] });
console.log("rows:", r.rows.length);
for (const row of r.rows) {
  console.log(row.id, String(row.user_id).slice(0,8), String(row.data).length);
}
// レコードの構造確認（最初の1件の先頭部分）
if (r.rows[0]) console.log("sample keys:", Object.keys(r.rows[0] as object));
db.close();
