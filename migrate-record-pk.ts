import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";
const db = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });

const before = await db.execute("select * from record");
writeFileSync("/tmp/record-backup.json", JSON.stringify(before.rows, null, 2));
console.log("backed up rows:", before.rows.length);
console.log("current DDL:", (await db.execute("select sql from sqlite_master where name='record'")).rows[0].sql);

await db.execute("pragma foreign_keys=off");
await db.execute(`create table record_new (
  id text not null,
  user_id text not null,
  type text not null,
  ciphertext text not null,
  iv text not null,
  updated_at_ms integer not null,
  version integer not null default 1,
  deleted_at integer,
  device_id text,
  seq integer not null default (unixepoch('subsec') * 1000),
  primary key (user_id, id)
)`);
await db.execute(`insert into record_new (id,user_id,type,ciphertext,iv,updated_at_ms,version,deleted_at,device_id,seq)
  select id,user_id,type,ciphertext,iv,updated_at_ms,version,deleted_at,device_id,seq from record`);
const moved = (await db.execute("select count(*) c from record_new")).rows[0].c;
console.log("moved:", moved);
if (Number(moved) !== before.rows.length) throw new Error("件数不一致。中止します");
await db.execute("drop table record");
await db.execute("alter table record_new rename to record");
await db.execute("create index if not exists record_user_seq_idx on record (user_id, seq)");
await db.execute("create index if not exists record_user_type_idx on record (user_id, type)");
await db.execute("pragma foreign_keys=on");

console.log("new DDL:", (await db.execute("select sql from sqlite_master where name='record'")).rows[0].sql);
console.log("rows after:", (await db.execute("select count(*) c from record")).rows[0].c);
console.log("indexes:", (await db.execute("select name from sqlite_master where type='index' and tbl_name='record'")).rows);
