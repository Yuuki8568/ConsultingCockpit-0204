import { createClient } from "@libsql/client";
const c = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
const q = async (s: string) => { const r = await c.execute(s); console.log(s, "=>", JSON.stringify(r.rows)); };
await q("select id,user_id,type,length(ciphertext) len,substr(ciphertext,1,20) head from record limit 12");
await q("select user_id,count(*) from record group by user_id");
await q("select id,email from user");
