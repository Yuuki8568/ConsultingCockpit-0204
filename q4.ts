/** 新組込雛形を暗号化したときの ciphertext 長を予測し、本番DBの実測値と照合する（読み取りのみ） */
import { createClient } from "@libsql/client";
import { BUILT_IN_TEMPLATES } from "./packages/web/src/web/domain/data/doc-templates";

const db = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});
const USER = "R4PGCk91chpfub7fTrxoFmkFoko12KLk";

const enc = new TextEncoder();
const predict = (key: string, body: string) => {
  const plainBytes = enc.encode(JSON.stringify({ key, body })).length;
  return 4 * Math.ceil((plainBytes + 16) / 3); // AES-GCM tag 16B + base64
};

const r = await db.execute({
  sql: "select id,length(ciphertext) len from record where user_id=? and type='template'",
  args: [USER],
});
const actual = new Map(r.rows.map((x: any) => [x.id.replace("template:", ""), x.len]));

console.log("key                 predicted  actual  match");
let ok = 0,
  ng = 0;
for (const [key, body] of Object.entries(BUILT_IN_TEMPLATES)) {
  const p = predict(key, body as string);
  const a = actual.get(key);
  const m = p === a;
  m ? ok++ : ng++;
  console.log(
    `${key.padEnd(20)} ${String(p).padStart(8)}  ${String(a).padStart(7)}  ${m ? "OK" : "NG"}`,
  );
}
console.log(`\n一致: ${ok} / 不一致: ${ng}`);
