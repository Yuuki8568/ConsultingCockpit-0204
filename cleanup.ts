import { createClient } from "@libsql/client";
const db = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
const keep = "R4PGCk91chpfub7fTrxoFmkFoko12KLk";
const users = (await db.execute("select id, email from user")).rows;
console.log("users before:", users);
for (const u of users) {
  const id = String(u.id);
  if (id === keep) continue;
  for (const t of ["record", "device", "audit_event", "login_event", "vault"]) {
    const r = await db.execute({ sql: `delete from ${t} where user_id = ?`, args: [id] });
    if (r.rowsAffected) console.log("del", t, id, r.rowsAffected);
  }
  for (const t of ["session", "account"]) {
    const r = await db.execute({ sql: `delete from ${t} where user_id = ?`, args: [id] });
    if (r.rowsAffected) console.log("del", t, id, r.rowsAffected);
  }
  const r = await db.execute({ sql: `delete from user where id = ?`, args: [id] });
  console.log("del user", id, r.rowsAffected);
}
console.log("users after:", (await db.execute("select id, email from user")).rows);
for (const t of ["record", "device", "audit_event", "login_event", "vault", "session", "account"]) {
  console.log(t, (await db.execute(`select count(*) c from ${t}`)).rows[0].c);
}
