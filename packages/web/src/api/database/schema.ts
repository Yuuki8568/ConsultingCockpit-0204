import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export * from "./auth-schema";

/**
 * ゼロ知識設計の要点
 * ------------------------------------------------------------------
 * サーバーが保持するのは「暗号文」と「復号に必要だが鍵そのものではない値」だけ。
 * - vault: 鍵導出パラメータ（salt / 反復回数）と、パスフレーズ照合用の検証トークン。
 *          検証トークンは「既知の平文を金庫鍵で暗号化したもの」なので、
 *          これ自体からパスフレーズも鍵も復元できない。
 * - record: ciphertext + iv のみ。type すら暗号化対象にしたいところだが、
 *           同期の差分計算に必要なため、種別と更新時刻だけは平文で持つ。
 *           中身（企業名・金額・面談メモ）はすべて ciphertext の中。
 * サーバー側に復号処理は一切存在しない。
 */

/** 利用者ごとの金庫メタ。1ユーザー1金庫。 */
export const vault = sqliteTable("vault", {
  userId: text("user_id").primaryKey(),
  /** PBKDF2 の salt（base64）。秘密ではないので平文で保持して良い。 */
  kdfSalt: text("kdf_salt").notNull(),
  /** 鍵導出アルゴリズム識別子。将来 Argon2 等へ移行できるよう版を持つ。 */
  kdfAlgo: text("kdf_algo").notNull().default("PBKDF2-SHA256"),
  kdfIterations: integer("kdf_iterations").notNull().default(600000),
  /** パスフレーズ照合用: 既知の平文を金庫鍵で AES-GCM 暗号化した結果（base64） */
  verifierCiphertext: text("verifier_ciphertext").notNull(),
  verifierIv: text("verifier_iv").notNull(),
  /** 金庫の世代。パスフレーズ変更・全消去のたびに +1 して端末に再同期を促す。 */
  generation: integer("generation").notNull().default(1),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export type RecordType = "case" | "lead" | "profile" | "template" | "meta" | "log";

/** 暗号化レコード。1案件・1リード・プロフィール等が1行。 */
export const record = sqliteTable(
  "record",
  {
    /**
     * 論理ID。利用者ごとに一意。
     * 主キーは (user_id, id) の複合。id 単独を主キーにすると、
     * 同じデータベースを複数の利用者で使う場合に profile:main のような
     * 決まったIDが衝突して保存できなくなる。
     */
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    /** case | lead | profile | template | meta | log */
    type: text("type").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    /** クライアントの論理更新時刻（ミリ秒）。競合解決の後勝ち判定に使う。 */
    updatedAtMs: integer("updated_at_ms").notNull(),
    /** レコード単位の版番号。単調増加。 */
    version: integer("version").notNull().default(1),
    /** 論理削除。復元と同期のため物理削除しない。 */
    deletedAt: integer("deleted_at"),
    /** 保存を行った端末 */
    deviceId: text("device_id"),
    /** サーバー到着順の通し番号。差分同期のカーソルに使う。 */
    seq: integer("seq")
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("record_user_seq_idx").on(t.userId, t.seq),
    index("record_user_type_idx").on(t.userId, t.type),
  ],
);

/** 端末管理。一覧表示と失効に使う。 */
export const device = sqliteTable(
  "device",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    label: text("label").notNull(),
    platform: text("platform").notNull(),
    userAgent: text("user_agent"),
    createdAtMs: integer("created_at_ms").notNull(),
    lastSeenAtMs: integer("last_seen_at_ms").notNull(),
    /** 失効済み端末は同期を拒否する */
    revokedAtMs: integer("revoked_at_ms"),
  },
  (t) => [index("device_user_idx").on(t.userId)],
);

/**
 * 監査イベント。誰が・いつ・何をしたかの記録。
 * 詳細（対象企業名など）は payloadCiphertext に入れて暗号化する。
 * action と at は集計・改ざん検知のため平文。
 */
export const auditEvent = sqliteTable(
  "audit_event",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    seq: integer("seq").notNull(),
    action: text("action").notNull(),
    atMs: integer("at_ms").notNull(),
    deviceId: text("device_id"),
    payloadCiphertext: text("payload_ciphertext"),
    payloadIv: text("payload_iv"),
    /** 直前エントリのハッシュ。連鎖が切れていれば改ざんと判定できる。 */
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [
    uniqueIndex("audit_user_seq_uidx").on(t.userId, t.seq),
    index("audit_user_at_idx").on(t.userId, t.atMs),
  ],
);

/** ログイン試行の記録（ロックアウト判定と履歴表示） */
export const loginEvent = sqliteTable(
  "login_event",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    atMs: integer("at_ms").notNull(),
    kind: text("kind").notNull(),
    platform: text("platform"),
    userAgent: text("user_agent"),
    deviceId: text("device_id"),
  },
  (t) => [index("login_user_at_idx").on(t.userId, t.atMs)],
);
