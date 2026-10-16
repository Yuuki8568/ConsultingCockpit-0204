/**
 * IndexedDB の薄いラッパ。
 * ここに入るのは暗号文だけ。復号済みの平文はディスクに書かない。
 * オフライン中の作業はここに溜め、復帰時に送信キューを流す。
 */

const DB_NAME = "cockpit-v4";
const DB_VERSION = 2;

export const STORE_RECORDS = "records"; // { id, type, ciphertext, iv, updatedAtMs, deleted, seq, dirty }
export const STORE_QUEUE = "queue"; // 送信待ち { id (=recordId), enqueuedAtMs }
export const STORE_META = "meta"; // { key, value } 同期カーソル・端末ID等
// 録画・録音の暗号化チャンク { id (=mediaId:index), mediaId, index, iv, data }。
// 中身は AES-GCM の暗号文（バイナリのまま）。この端末にだけ置き、サーバーには送らない。
export const STORE_MEDIA = "media";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        const s = db.createObjectStore(STORE_RECORDS, { keyPath: "id" });
        s.createIndex("type", "type");
        s.createIndex("dirty", "dirty");
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        const m = db.createObjectStore(STORE_MEDIA, { keyPath: "id" });
        m.createIndex("mediaId", "mediaId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export interface LocalRecord {
  id: string;
  type: string;
  ciphertext: string;
  iv: string;
  updatedAtMs: number;
  deleted: boolean;
  seq: number;
  /** true = まだサーバーへ送っていない */
  dirty: 0 | 1;
  /**
   * 平文の指紋（暗号ではないハッシュ）。
   * 「中身が変わったか」を判定するために置く。これがあると
   * 変更判定のたびに全レコードを復号する必要がなくなる。
   * 指紋だけでは中身を復元できないため、端末内に置いても実害はない。
   */
  hash?: string;
}

/** 録画・録音の暗号化チャンク行。data は AES-GCM の暗号文（base64 化せずバイナリのまま） */
export interface MediaChunkRow {
  id: string; // `${mediaId}:${index}`
  mediaId: string;
  index: number;
  iv: ArrayBuffer;
  data: ArrayBuffer;
}

export const idb = {
  async putRecord(r: LocalRecord): Promise<void> {
    await tx(STORE_RECORDS, "readwrite", (s) => s.put(r));
  },
  async putRecords(rs: LocalRecord[]): Promise<void> {
    if (rs.length === 0) return;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_RECORDS, "readwrite");
      const s = t.objectStore(STORE_RECORDS);
      rs.forEach((r) => s.put(r));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  getRecord(id: string): Promise<LocalRecord | undefined> {
    return tx<LocalRecord | undefined>(STORE_RECORDS, "readonly", (s) => s.get(id));
  },
  allRecords(): Promise<LocalRecord[]> {
    return tx<LocalRecord[]>(STORE_RECORDS, "readonly", (s) => s.getAll());
  },
  async dirtyRecords(): Promise<LocalRecord[]> {
    const all = await idb.allRecords();
    return all.filter((r) => r.dirty === 1);
  },
  async deleteRecord(id: string): Promise<void> {
    await tx(STORE_RECORDS, "readwrite", (s) => s.delete(id));
  },
  async clearRecords(): Promise<void> {
    await tx(STORE_RECORDS, "readwrite", (s) => s.clear());
  },
  async getMeta<T = unknown>(key: string): Promise<T | undefined> {
    const row = await tx<{ key: string; value: T } | undefined>(
      STORE_META,
      "readonly",
      (s) => s.get(key),
    );
    return row?.value;
  },
  async setMeta(key: string, value: unknown): Promise<void> {
    await tx(STORE_META, "readwrite", (s) => s.put({ key, value }));
  },
  async clearAll(): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction([STORE_RECORDS, STORE_QUEUE, STORE_META, STORE_MEDIA], "readwrite");
      t.objectStore(STORE_RECORDS).clear();
      t.objectStore(STORE_QUEUE).clear();
      t.objectStore(STORE_META).clear();
      t.objectStore(STORE_MEDIA).clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  // ---- 録画・録音の暗号化チャンク ----------------------------------
  async putMediaChunk(row: MediaChunkRow): Promise<void> {
    await tx(STORE_MEDIA, "readwrite", (s) => s.put(row));
  },
  async putMediaChunks(rows: MediaChunkRow[]): Promise<void> {
    if (rows.length === 0) return;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_MEDIA, "readwrite");
      const s = t.objectStore(STORE_MEDIA);
      rows.forEach((r) => s.put(r));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  /**
   * 保存されている mediaId の一覧（重複なし）。
   * データ本体は読まず、キーだけをたどるので大きな録画があっても軽い。
   * 鍵変更時の封じ直し対象の列挙に使う。
   */
  async listMediaIds(): Promise<string[]> {
    const db = await openDb();
    return new Promise<string[]>((resolve, reject) => {
      const out: string[] = [];
      const t = db.transaction(STORE_MEDIA, "readonly");
      const req = t.objectStore(STORE_MEDIA).index("mediaId").openKeyCursor(undefined, "nextunique");
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push(String(cursor.key));
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },
  /** mediaId の全チャンクを index 順で返す */
  async mediaChunks(mediaId: string): Promise<MediaChunkRow[]> {
    const db = await openDb();
    const rows = await new Promise<MediaChunkRow[]>((resolve, reject) => {
      const t = db.transaction(STORE_MEDIA, "readonly");
      const req = t.objectStore(STORE_MEDIA).index("mediaId").getAll(mediaId);
      req.onsuccess = () => resolve(req.result as MediaChunkRow[]);
      req.onerror = () => reject(req.error);
    });
    return rows.sort((a, b) => a.index - b.index);
  },
  async deleteMediaChunks(mediaId: string): Promise<void> {
    const rows = await idb.mediaChunks(mediaId);
    if (rows.length === 0) return;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_MEDIA, "readwrite");
      const s = t.objectStore(STORE_MEDIA);
      rows.forEach((r) => s.delete(r.id));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
};

/** 保存領域が永続化されているか（ブラウザに勝手に消されない設定か）を確認 */
export async function ensurePersistentStorage(): Promise<{
  supported: boolean;
  persisted: boolean;
}> {
  if (!navigator.storage || !navigator.storage.persist) {
    return { supported: false, persisted: false };
  }
  const already = await navigator.storage.persisted();
  if (already) return { supported: true, persisted: true };
  const granted = await navigator.storage.persist();
  return { supported: true, persisted: granted };
}
