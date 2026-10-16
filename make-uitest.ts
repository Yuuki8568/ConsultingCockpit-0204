import { createClient } from "@libsql/client";
import { scrypt, randomBytes } from "node:crypto";

// UI検証用の一時利用者を直接DBに作る（サインアップ画面は閉じているため）。
// 終わったら cleanup.ts で消す。
const db = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
const email = "uitest@local.test";
const password = "UiTestPass!2026";

const existing = await db.execute({ sql: "select id from user where email = ?", args: [email] });
let uid: string;
if (existing.rows.length > 0) {
  uid = String(existing.rows[0].id);
  console.log("exists:", uid);
} else {
  uid = randomBytes(12).toString("hex");
  await db.execute({
    sql: "insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)",
    args: [uid, "UI検証", email, Date.now(), Date.now()],
  });
  console.log("inserted user:", uid);
}

const salt = randomBytes(16).toString("hex");
const key = await new Promise<Buffer>((resolve, reject) => {
  scrypt(password.normalize("NFKC"), salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }, (e, k) =>
    e ? reject(e) : resolve(k),
  );
});
const hashed = `${salt}:${key.toString("hex")}`;

const a = await db.execute({
  sql: "select id from account where user_id = ? and provider_id = 'credential'",
  args: [uid],
});
if (a.rows.length > 0) {
  await db.execute({ sql: "update account set password = ?, updated_at = ? where id = ?", args: [hashed, Date.now(), String(a.rows[0].id)] });
  console.log("updated account");
} else {
  await db.execute({
    sql: "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values (?, ?, 'credential', ?, ?, ?, ?)",
    args: [randomBytes(12).toString("hex"), uid, uid, hashed, Date.now(), Date.now()],
  });
  console.log("inserted account");
}
