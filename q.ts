import { createClient } from "@libsql/client";
const c = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
const q = process.argv[2];
const r = await c.execute(q);
console.log(JSON.stringify(r.rows, null, 1).slice(0, 4000));
