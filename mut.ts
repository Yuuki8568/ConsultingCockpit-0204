import { createClient } from "@libsql/client";
const c = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
console.log(JSON.stringify((await c.execute(process.argv[2])).rowsAffected));
