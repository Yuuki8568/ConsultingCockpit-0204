/**
 * 金庫ストア。アプリの状態はすべてここを通る。
 *
 * 役割
 * ------------------------------------------------------------------
 * 1. 解錠時：サーバーから暗号文を取り、金庫鍵で開いて VaultState に組み立てる
 * 2. 編集時：レコード単位で封をして IndexedDB に置き、送信キューに載せる
 * 3. 同期時：dirty なレコードを push し、返ってきた差分を取り込む
 * 4. 施錠時：メモリ上の鍵と平文を捨てる
 *
 * レコード分割の方針
 * - 案件1件 = 1レコード（case:<caseId>）
 * - リード1件 = 1レコード（lead:<leadId>）
 * - プロフィール = profile:main
 * - 書類雛形 = template:<docType>（雛形は大きいので個別に分ける）
 * - それ以外の小物（goals / salesKpi / referrals / UI状態） = meta:app
 * こうすると1案件を直しただけで全データを送り直すことがなくなる。
 */
import { MAX_SYNC_RECORDS } from "../../../shared/sync-limits";
import type { CaseRecord, LeadRecord, VaultState } from "../../domain/types";
import { assertUniqueImportIds, normalizeVaultState } from "../../domain/logic/state";
import { client } from "../api";
import {
  hmacHex,
  open,
  openBytes,
  seal,
  sealBytes,
  type Sealed,
} from "../crypto/vault-crypto";
import { idb, type LocalRecord, type MediaChunkRow } from "./idb";
import { docViewer } from "./doc-viewer-store";

export type RecordType = "case" | "lead" | "profile" | "template" | "meta" | "log";

export interface SyncStatus {
  state: "idle" | "syncing" | "offline" | "error" | "locked";
  pending: number;
  lastSyncedAtMs: number | null;
  lastError: string | null;
  conflicts: number;
}

async function digestBytes(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

const META_CURSOR = "syncCursor";
const META_DEVICE = "deviceId";
/** サーバー側 sync.push の ciphertext 上限（1MB）と必ず一致させる */
const MAX_SYNC_CIPHERTEXT = 1_048_576;
const META_LAST_SYNC = "lastSyncedAtMs";

/**
 * 暗号文と「どのレコードのものか」を結び付ける付帯情報（AAD）。
 * これを付けて封をすると、暗号文を別のレコードへ差し替えても復号が失敗する。
 * 差し替え・種別の書き換え・他人のレコードへの付け替えを検知できる。
 */
export function recordAad(type: string, id: string): string {
  return `cc4r|${type}|${id}`;
}

/** 録画チャンク用の付帯情報 */
export function mediaAad(mediaId: string, index: number): string {
  return `cc4m|${mediaId}|${index}`;
}

/** 鍵変更の途中に置く仮チャンクの目印（mediaId の後ろに付ける） */
export const REKEY_TEMP_SUFFIX = "__rekey__";

/**
 * 行が指す「本来のレコード」の AAD を作る。
 * 競合コピー（__conflict_…）は、元レコードの id・種別で封をした暗号文を
 * そのまま移したものなので、AAD も元のものを組み立て直す。
 */
function aadForRow(row: { id: string; type: string }): string {
  const baseId = row.id.split("__conflict")[0];
  const baseType = row.id.includes("__conflict") ? baseId.split(":")[0] : row.type;
  return recordAad(baseType, baseId);
}

/**
 * レコード行を開ける。AAD 付きの新形式をまず試し、
 * 開けなければ AAD 導入前の旧形式として開く（次回保存時に新形式へ封じ直される）。
 * 鍵違い・改ざん・別レコードへの差し替えはどちらでも失敗する。
 */
async function openRecord<T = unknown>(
  key: CryptoKey,
  row: { id: string; type: string; ciphertext: string; iv: string },
): Promise<T> {
  return open<T>(key, row, aadForRow(row), true);
}

export function deviceIdFor(): string {
  let id = localStorage.getItem("cockpit.deviceId");
  if (!id) {
    id = "dev_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    localStorage.setItem("cockpit.deviceId", id);
  }
  return id;
}

export function recordIdFor(type: RecordType, key: string): string {
  return `${type}:${key}`;
}

/** VaultState → 保存レコード群に分解 */
export function splitState(state: VaultState): { id: string; type: RecordType; value: unknown }[] {
  const out: { id: string; type: RecordType; value: unknown }[] = [];
  state.cases.forEach((c) => out.push({ id: recordIdFor("case", c.id), type: "case", value: c }));
  state.leads.forEach((l) => out.push({ id: recordIdFor("lead", l.id), type: "lead", value: l }));
  out.push({ id: recordIdFor("profile", "main"), type: "profile", value: state.profile });
  Object.entries(state.docTemplates).forEach(([k, v]) =>
    out.push({ id: recordIdFor("template", k), type: "template", value: { key: k, body: v } }),
  );
  out.push({
    id: recordIdFor("meta", "app"),
    type: "meta",
    value: {
      leadCounter: state.leadCounter,
      referrals: state.referrals,
      goals: state.goals,
      salesKpi: state.salesKpi,
      retentionDays: state.retentionDays ?? 0,
      notifyEmail: state.notifyEmail ?? "",
      currentCaseId: state.currentCaseId,
      currentLeadId: state.currentLeadId,
      currentTab: state.currentTab,
      currentLeadTab: state.currentLeadTab,
      currentMode: state.currentMode,
      office: state.office ?? { months: {} },
      knowledge: state.knowledge ?? [],
      services: state.services ?? [],
    },
  });
  return out;
}

/** 保存レコード群 → VaultState に組み立て */
export function assembleState(
  parts: { id: string; type: string; value: unknown }[],
): VaultState {
  const cases: CaseRecord[] = [];
  const leads: LeadRecord[] = [];
  const docTemplates: Record<string, string> = {};
  let profile: unknown = null;
  let meta: Record<string, unknown> = {};
  for (const p of parts) {
    if (p.type === "case") cases.push(p.value as CaseRecord);
    else if (p.type === "lead") leads.push(p.value as LeadRecord);
    else if (p.type === "profile") profile = p.value;
    else if (p.type === "template") {
      const t = p.value as { key: string; body: string };
      if (t && t.key) docTemplates[t.key] = t.body;
    } else if (p.type === "meta") meta = (p.value as Record<string, unknown>) ?? {};
  }
  cases.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  leads.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return normalizeVaultState({
    cases,
    leads,
    docTemplates,
    profile,
    ...meta,
  });
}

type Listener = () => void;

export class VaultStore {
  private epoch = 0;
  private rekeying = false;
  private releaseWriter: (() => void) | null = null;
  private async acquireWriter(): Promise<void> {
    if (this.releaseWriter) return;
    if (typeof navigator === "undefined" || !navigator.locks)
      throw new Error("安全な複数タブ制御に対応するブラウザで開いてください");
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request("cockpit-v4-writer", { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error("別タブで金庫が開いています。先に施錠してください")); return; }
        await new Promise<void>(release => { this.releaseWriter = release; resolve(); });
      }).catch(reject);
    });
  }
  private generation = 1;
  setGeneration(value: number) { this.generation = value; }
  private backupKdf: { salt: string; iterations: number } | null = null;
  setBackupKdf(salt: string, iterations: number): void { this.backupKdf = { salt, iterations }; }
  getBackupKdf() {
    if (!this.isUnlocked() || !this.backupKdf) throw new Error("バックアップの鍵情報がありません。再度解錠してください");
    return { ...this.backupKdf };
  }
  async backupFingerprint(state: VaultState): Promise<string> {
    const epoch = this.epoch;
    const key = this.macKey;
    if (!key || !this.key) throw new Error("金庫が施錠されています");
    const result = await hmacHex(key, 'cc-backup-state-v1|' + JSON.stringify(state));
    this.assertSession(epoch);
    return result;
  }
  private assertSession(epoch: number): void {
    if (!this.key || epoch !== this.epoch) throw new Error("金庫の状態が変わりました。再度解錠してください");
  }
  async sealAudit(value: unknown): Promise<Sealed> {
    const epoch = this.epoch;
    if (!this.key) throw new Error("金庫が施錠されています");
    const result = await seal(this.key, value);
    this.assertSession(epoch);
    return result;
  }
  private key: CryptoKey | null = null;
  /** 平文の指紋（HMAC）を作るための鍵。メモリ上にだけ置く */
  private macKey: CryptoKey | null = null;
  private state: VaultState | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<Listener>();
  private status: SyncStatus = {
    state: "locked",
    pending: 0,
    lastSyncedAtMs: null,
    lastError: null,
    conflicts: 0,
  };
  /**
   * 変更回数。state を作り直さずに現物を編集する方式なので、
   * React 側は参照の変化で再描画を判断できない。この数字を購読させて再描画させる。
   */
  private revision = 0;
  private syncing = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 書き込み系処理の直列化キュー。
   * 永続化（persistPartial）と同期（syncCritical）が同時に走ると、
   * 同期側が読んだ古い行で新しい行を上書きしたり、受信差分の取り込み
   * （state のまるごと作り直し）が保存途中の編集を巻き込んで消したりする。
   * 2026-09-15 に「書類を生成した直後にモーダルごと新規書類が消える」
   * 不具合として再現したため、idb への書き込みと state 置換は必ず
   * このキューを通して一つずつ実行する。
   */
  private opQueue: Promise<unknown> = Promise.resolve();
  private online = typeof navigator === "undefined" ? true : navigator.onLine;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.online = true;
        void this.sync();
      });
      window.addEventListener("offline", () => {
        this.online = false;
        this.setStatus({ state: "offline" });
      });
    }
  }

  // ---- 購読 -------------------------------------------------------
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  subscribeStatus(fn: Listener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
  private emit() {
    this.revision++;
    this.listeners.forEach((f) => f());
  }
  /** 書き込み系処理を1件ずつ順番に実行する。job の中で再度 enqueue してはいけない。 */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    this.enqueuedCount++;
    const p = this.opQueue.then(async () => {
      try {
        return await job();
      } finally {
        this.doneCount++;
      }
    });
    this.opQueue = p.catch(() => undefined);
    return p;
  }
  /** enqueue された回数と、終わった回数。差から「自分の後ろに溜まっている処理数」が分かる */
  private enqueuedCount = 0;
  private doneCount = 0;

  getRevision(): number {
    return this.revision;
  }
  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.statusListeners.forEach((f) => f());
  }
  getStatus(): SyncStatus {
    return this.status;
  }
  getState(): VaultState | null {
    return this.state;
  }
  isUnlocked(): boolean {
    return this.key != null && this.state != null;
  }

  /** 平文の指紋。金庫を解錠していないと作れない（HMAC） */
  private async fingerprint(json: string): Promise<string> {
    if (!this.macKey) throw new Error("金庫が施錠されています");
    return hmacHex(this.macKey, json);
  }

  // ---- 解錠・施錠 --------------------------------------------------
  /** 金庫鍵を受け取り、サーバー＋ローカルから状態を復元する */
  async unlock(key: CryptoKey, macKey: CryptoKey): Promise<void> {
    const epoch = ++this.epoch;
    await this.flushPending();
    await this.acquireWriter();
    if (epoch !== this.epoch) throw new Error("解錠が取り消されました");
    this.key = key;
    this.macKey = macKey;
    this.setStatus({ state: "syncing", lastError: null });
    // まずローカルの暗号文で即座に開く（オフラインでも起動できる）
    await this.recoverRekey();
    await this.rebuildFromLocal();
    this.assertSession(epoch);
    this.setStatus({ state: this.online ? "idle" : "offline" });
    // 鍵変更の途中で止まった録画チャンクがあれば、ここで結末を付ける
    await this.settleMediaRekey();
    // 続けてサーバーと同期
    this.assertSession(epoch);
    if (this.online) void this.sync();
  }

  lock(): void {
    this.epoch++;
    const release = this.releaseWriter;
    this.releaseWriter = null;
    void this.opQueue.finally(() => release?.());
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.backupKdf = null;
    this.key = null;
    this.macKey = null;
    this.state = null;
    // 開いていた書類の本文・編集状態・保存経路もここで捨てる。
    // 施錠後に表示や書き出しが残らないようにするための決まり。
    docViewer.discard();
    this.setStatus({ state: "locked" });
    this.emit();
  }

  /**
   * 永続化キューに溜まった書き込みがすべて終わるのを待つ。
   * 手動施錠の直前に呼び、書類の未保存分が消えないようにする。
   */
  async flushPending(): Promise<void> {
    await this.enqueue(() => Promise.resolve());
  }

  /** 新規金庫：空の状態を作って保存する */
  async initializeEmpty(key: CryptoKey, macKey: CryptoKey, initial: VaultState): Promise<void> {
    const epoch = ++this.epoch;
    await this.acquireWriter();
    if (epoch !== this.epoch) throw new Error("操作が取り消されました");
    this.key = key;
    this.macKey = macKey;
    this.state = initial;
    await this.persistAll(initial);
    this.assertSession(epoch);
    this.emit();
    this.setStatus({ state: this.online ? "idle" : "offline" });
    if (this.online) await this.sync();
  }

  private async rebuildFromLocal(): Promise<void> {
    const key = this.key;
    const epoch = this.epoch;
    if (!key) return;
    const rows = await idb.allRecords();
    const parts: { id: string; type: string; value: unknown }[] = [];
    for (const r of rows) {
      if (r.deleted || r.id.includes("__conflict")) continue;
      let value: unknown;
      try { value = await openRecord(key, r); }
      catch {
        this.assertSession(epoch);
        this.lock();
        throw new Error("復号できない原本があります。データは保持されており、編集・同期を停止しました。復旧前に保存領域を消去しないでください");
      }
      this.assertSession(epoch);
      if ((r.type === "case" || r.type === "lead") &&
          (!value || typeof value !== "object" || !("id" in value) || r.id !== `${r.type}:${value.id}`)) {
        this.lock();
        throw new Error("レコードIDが一致しません。原本を保持して停止しました");
      }
      parts.push({ id: r.id, type: r.type, value });
    }
    this.assertSession(epoch);
    const fingerprints = new Map<string, string>();
    for (const p of parts) fingerprints.set(p.id, await this.fingerprint(JSON.stringify(p.value)));
    this.assertSession(epoch);
    const upgraded = rows.map(r => {
      const { hash: _oldHash, ...rest } = r;
      return fingerprints.has(r.id) ? { ...rest, hash: fingerprints.get(r.id) } : rest;
    });
    if (JSON.stringify(rows) !== JSON.stringify(upgraded)) await idb.replaceRecords(rows, upgraded);
    this.assertSession(epoch);
    this.state = assembleState(parts);
    this.emit();
  }

  // ---- 書き込み ---------------------------------------------------
  /**
   * 状態を書き換える。変更のあったレコードだけを封して保存する。
   * fn の中で state を直接触ってよい（immer は使わない。案件データが大きく
   * 構造も深いので、まるごと差し替えるより現物を編集するほうが速い）
   */
  async mutate(fn: (s: VaultState) => void, touched?: string[]): Promise<void> {
    if (!this.state || !this.key || this.rekeying) throw new Error("金庫が施錠中または鍵変更中です");
    // 画面反映は待たせないので fn と emit は同期的に行い、
    // 永続化だけをキューに載せる（同期処理と衝突させないため）。
    fn(this.state);
    this.emit();
    const snapshot = structuredClone(this.state);
    const key = this.key;
    const macKey = this.macKey!;
    // An already accepted edit may finish encrypted local persistence after lock.
    // No public key/state is retained and no network operation is required.
    await this.enqueue(() => this.persistPartial(snapshot, touched, key, macKey));
    this.scheduleSync();
  }

  /** レコードIDを明示せず全件保存（初回・取込時） */
  private async persistAll(state: VaultState): Promise<void> {
    if (!this.key) return;
    const parts = splitState(state);
    const now = Date.now();
    const rows: LocalRecord[] = [];
    for (const p of parts) {
      const json = JSON.stringify(p.value);
      const sealed = await seal(this.key, p.value, recordAad(p.type, p.id));
      rows.push({
        id: p.id,
        type: p.type,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        updatedAtMs: now,
        deleted: false,
        seq: 0,
        dirty: 1,
        hash: await this.fingerprint(json),
      });
    }
    await idb.putRecords(rows);
    this.setStatus({ pending: rows.length });
  }

  /**
   * 変更されたレコードだけ保存する。
   *
   * 何が変わったかは「平文の指紋」の比較で判定する。
   * 以前は判定のために全レコードを復号していたため、タブを切り替えるだけで
   * 12本の雛形（十数万文字）を復号・再暗号化していて、目に見えて重かった。
   * 指紋を持たせることで、実際に変わったものだけを暗号化する。
   * 指紋は HMAC（金庫を解錠しないと作れない）なので、
   * 保存領域だけを読む相手は指紋の一致から中身の候補を確かめられない。
   */
  private async persistPartial(state: VaultState, touched: string[] | undefined, key: CryptoKey, macKey: CryptoKey): Promise<void> {
    assertUniqueImportIds(state);
    const parts = splitState(state);
    const now = Date.now();
    const rows: LocalRecord[] = [];
    const force = touched && touched.length > 0 ? new Set(touched) : null;
    const before = await idb.allRecords();
    const existing = new Map(before.map((r) => [r.id, r]));

    for (const p of parts) {
      const prev = existing.get(p.id);
      const json = JSON.stringify(p.value);
      const hash = await hmacHex(macKey, json);
      // 指紋が同じで、削除されておらず、明示指定もなければ触らない
      if (prev && prev.hash === hash && !prev.deleted && !(force && force.has(p.id))) continue;
      const sealed = await seal(key, p.value, recordAad(p.type, p.id));
      rows.push({
        id: p.id,
        type: p.type,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        updatedAtMs: now,
        deleted: false,
        seq: prev?.seq ?? 0,
        dirty: 1,
        hash,
      });
    }

    // state から消えたレコードは論理削除する
    const alive = new Set(parts.map((p) => p.id));
    for (const r of existing.values()) {
      // 競合コピーは state に現れないので対象外
      if (r.id.includes("__conflict")) continue;
      if (!alive.has(r.id) && !r.deleted) {
        rows.push({ ...r, deleted: true, updatedAtMs: now, dirty: 1 });
      }
    }

    if (rows.length > 0) {
      for (const row of rows) existing.set(row.id, row);
      await idb.replaceRecords(before, [...existing.values()]);
    }
    const pending = (await idb.dirtyRecords()).length;
    this.setStatus({ pending });
  }

  /** 状態をまるごと差し替える（v3 JSON 取込・復元） */
  async replaceState(state: VaultState): Promise<void> {
    if (!this.isUnlocked() || this.rekeying) throw new Error("金庫が施錠中または鍵変更中です");
    assertUniqueImportIds(state);
    const snapshot = structuredClone(state);
    const key = this.key!;
    const macKey = this.macKey!;
    const epoch = this.epoch;
    await this.enqueue(async () => {
      this.assertSession(epoch);
      const before = await idb.allRecords();
      const rows = new Map(before.map(r => [r.id, r]));
      const alive = new Set<string>();
      for (const p of splitState(snapshot)) {
        alive.add(p.id);
        const sealed = await seal(key, p.value, recordAad(p.type, p.id));
        rows.set(p.id, { id: p.id, type: p.type, ...sealed, updatedAtMs: Date.now(),
          deleted: false, seq: rows.get(p.id)?.seq ?? 0, dirty: 1,
          hash: await hmacHex(macKey, JSON.stringify(p.value)) });
      }
      for (const r of before) {
        if (!alive.has(r.id) && !r.id.includes("__conflict") && !r.deleted)
          rows.set(r.id, { ...r, deleted: true, dirty: 1, updatedAtMs: Date.now() });
      }
      this.assertSession(epoch);
      await idb.replaceRecords(before, [...rows.values()]);
      this.assertSession(epoch);
      this.state = snapshot;
      this.emit();
    });
    this.scheduleSync();
  }

  // ---- 同期 -------------------------------------------------------
  private scheduleSync(delayMs = 1200) {
    if (!this.isUnlocked()) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.sync(), delayMs);
  }

  async sync(): Promise<void> {
    if (!this.key || this.syncing || this.rekeying) return;
    if (!this.online) {
      this.setStatus({ state: "offline" });
      return;
    }
    this.syncing = true;
    this.setStatus({ state: "syncing", lastError: null });
    try {
      await this.enqueue(() => this.syncCritical());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (this.key) this.setStatus({ state: "error", lastError: msg });
    } finally {
      this.syncing = false;
    }
  }

  /**
   * 同期の本体。必ず enqueue 経由で呼ぶ（persistPartial などと絶対に並行させない）。
   *
   * 受信差分の取り込みは state を idb の内容でまるごと作り直すため、
   * 通信中にローカル編集（まだ idb に書かれていないもの）があると
   * その編集を巻き込んで消してしまう。通信の前後で revision / キューの
   * 変化を見て、編集が挟まっていたら取り込みを次回に回す。
   */
  private async syncCritical(): Promise<void> {
    const key = this.key;
    const epoch = this.epoch;
    if (!key) return;
    {
      const revBefore = this.revision;
      // 1回の送信数をサーバーと揃え、外部通信の回数に余裕を残す。
      // 取り込み直後などは送信待ちが多くなるので、残りは続けて送る。
      //
      // サーバーの1件あたり上限（1MB）を超えるレコードは送ると
      // バッチ全体が 400 で捨てられ、他の正常なレコードまで
      // 永久に同期されなくなる。超過分は除外して残りだけ送り、
      // ステータスで明示する（静かに溜まり続ける状態を防ぐ）。
      const allDirty = await idb.dirtyRecords();
      const oversized = allDirty.filter((r) => r.ciphertext.length > MAX_SYNC_CIPHERTEXT);
      const sendable = allDirty.filter((r) => r.ciphertext.length <= MAX_SYNC_CIPHERTEXT);
      const dirty = sendable.slice(0, MAX_SYNC_RECORDS);
      const moreDirty = sendable.length > dirty.length;
      const since = (await idb.getMeta<number>(META_CURSOR)) ?? 0;
      const deviceId = deviceIdFor();

      this.assertSession(epoch);
      const res = await client.sync.push({
        generation: this.generation,
        deviceId,
        since,
        records: dirty.map((r) => ({
          id: r.id,
          type: r.type as "case" | "lead" | "profile" | "template" | "meta" | "log",
          ciphertext: r.ciphertext,
          iv: r.iv,
          updatedAtMs: r.updatedAtMs,
          deleted: r.deleted,
          // この編集が元にしたサーバー版。これが一致していれば競合扱いにしない。
          baseSeq: r.seq,
        })),
      }, { signal: AbortSignal.timeout(15000) });

      this.assertSession(epoch);
      // 送信できたものは dirty を落とす
      const acceptedSet = new Set(res.accepted);
      const cleared: LocalRecord[] = dirty
        .filter((r) => acceptedSet.has(r.id))
        .map((r) => ({ ...r, seq: res.acceptedVersions[r.id] ?? r.seq, dirty: 0 as const }));
      if (cleared.length > 0) await idb.putRecords(cleared);

      // 自分の後ろに溜まっている書き込み（= まだ idb に反映されていない編集）
      // があるか。キューはFIFOなので、自分より前に並んだ分は開始時点で終わっている。
      const pendingBehind = this.enqueuedCount - this.doneCount - 1;
      if (this.revision !== revBefore || pendingBehind > 0) {
        // 通信中にローカル編集が入った（まだ idb に書かれていない）。
        // ここで受信差分を適用すると state のまるごと作り直しに巻き込まれて
        // その編集が消えるため、適用は次回に回す。cursor も進めないので
        // 同じ差分は次回また受け取れる。dirty 落としは済んでいて問題ない
        // （新しい編集分は後続の persist が dirty=1 で書き直す）。
        this.setStatus({ state: "idle" });
        this.scheduleSync(800);
        return;
      }

      // 競合：負けた版を「競合コピー」として残す
      let conflictCount = this.status.conflicts;
      for (const cf of res.conflicts) {
        const copyId = `${cf.id}__conflict_${cf.serverUpdatedAtMs}`;
        const existing = await idb.getRecord(copyId);
        if (existing) continue;
        if (cf.losingSide === "server") {
          await idb.putRecord({
            id: copyId,
            type: "log",
            ciphertext: cf.serverCiphertext,
            iv: cf.serverIv,
            updatedAtMs: cf.serverUpdatedAtMs,
            deleted: false,
            seq: 0,
            dirty: 0,
          });
          conflictCount++;
        } else {
          // クライアント版が負け：自分の版を控えとして残し、サーバー版を採用する
          const mine = dirty.find((d) => d.id === cf.id);
          if (mine) {
            await idb.putRecord({
              id: `${cf.id}__conflict_local_${mine.updatedAtMs}`,
              type: "log",
              ciphertext: mine.ciphertext,
              iv: mine.iv,
              updatedAtMs: mine.updatedAtMs,
              deleted: false,
              seq: 0,
              dirty: 0,
            });
            conflictCount++;
          }
        }
      }

      const resolvedConflicts = new Set(res.conflicts.map(c => c.id));
      // 受信差分を取り込む
      if (res.changed.length > 0) {
        const incoming: LocalRecord[] = [];
        for (const c of res.changed) {
          // A later batch may still contain local edits. Do not replace those
          // with an older server row; the next push resolves their baseSeq.
          const local = await idb.getRecord(c.id);
          if (local?.dirty && !resolvedConflicts.has(c.id)) continue;
          // 受け取った暗号文の指紋を取るために一度開く（他端末の変更だけなので件数は少ない）
          let hash: string | undefined;
          try {
            hash = await this.fingerprint(JSON.stringify(await openRecord(key, c)));
          } catch {
            if (!c.deleted) throw new Error("受信データを復号できません。ローカル原本は保持されています");
            hash = undefined;
          }
          this.assertSession(epoch);
          incoming.push({
            id: c.id,
            type: c.type,
            ciphertext: c.ciphertext,
            iv: c.iv,
            updatedAtMs: c.updatedAtMs,
            deleted: c.deleted,
            seq: c.seq,
            dirty: 0,
            hash,
          });
        }
        await idb.putRecords(incoming);
      }
      await idb.setMeta(META_CURSOR, res.cursor);
      const now = Date.now();
      await idb.setMeta(META_LAST_SYNC, now);
      await idb.setMeta(META_DEVICE, deviceId);

      if (res.changed.length > 0 || res.conflicts.length > 0) {
        await this.rebuildFromLocal();
      }
      const pending = (await idb.dirtyRecords()).length;
      if (oversized.length > 0) {
        this.setStatus({
          state: "error",
          pending,
          lastSyncedAtMs: now,
          conflicts: conflictCount,
          lastError:
            `レコードが同期上限（1MB）を超えているため送信できません: ${oversized
              .map((r) => r.id)
              .join(", ")}。` +
            "案件に溜まった生成済み書類を古いものから削除してください。",
        });
      } else {
        this.setStatus({
          state: "idle",
          pending,
          lastSyncedAtMs: now,
          conflicts: conflictCount,
        });
      }
      if (res.hasMore || moreDirty) this.scheduleSync(200);
    }
  }

  // ---- 録画・録音（この端末にだけ置く暗号化バイナリ） ---------------
  /**
   * 録画・録音をチャンクに分けて封をし、IndexedDB に置く。
   * サーバーには送らない（容量・帯域の両面で sync 経路に乗せない）。
   * 1チャンクずつ暗号化するため、大きなファイルでもメモリの山を抑えられる。
   * 戻り値は書き込んだチャンク数。
   */
  async saveMediaBlob(
    mediaId: string,
    blob: Blob,
    onProgress?: (doneBytes: number, totalBytes: number) => void,
  ): Promise<number> {
    const key = this.key;
    const epoch = this.epoch;
    if (!key) throw new Error("金庫が施錠されています");
    const CHUNK = 8 * 1024 * 1024;
    const rows: MediaChunkRow[] = [];
    const hashes: string[] = [];
    for (let offset = 0, index = 0; offset < blob.size; offset += CHUNK, index++) {
      const plain = await blob.slice(offset, offset + CHUNK).arrayBuffer();
      hashes.push(await digestBytes(plain));
      const sealed = await sealBytes(key, plain, mediaAad(mediaId, index));
      this.assertSession(epoch);
      rows.push({ id: `${mediaId}:${index}`, mediaId, index, ...sealed });
      onProgress?.(Math.min(offset + CHUNK, blob.size), blob.size);
    }
    const manifest = new TextEncoder().encode(JSON.stringify({ format: 1, mediaId,
      count: rows.length, size: blob.size, hashes }));
    const sealed = await sealBytes(key, manifest.buffer, mediaAad(mediaId, -1));
    rows.push({ id: `${mediaId}:-1`, mediaId, index: -1, ...sealed });
    this.assertSession(epoch);
    await idb.replaceMedia(mediaId, rows);
    this.assertSession(epoch);
    return hashes.length;
  }

  /** A manifest authenticates completeness as well as the individual chunks. */
  async readMediaBlob(mediaId: string, mimeType: string): Promise<Blob> {
    const key = this.key;
    const epoch = this.epoch;
    if (!key) throw new Error("金庫が施錠されています");
    const rows = await idb.mediaChunks(mediaId);
    const manifestRow = rows.find(r => r.index === -1);
    if (!manifestRow) {
      const meta = this.state?.cases.flatMap(c => c.recordings ?? []).find(m => m.id === mediaId);
      if (!meta || rows.length !== meta.chunkCount) throw new Error("録画の台帳またはチャンクが不足しています。原本は保持されています");
      const parts: ArrayBuffer[] = [];
      for (const [index, row] of rows.entries()) {
        if (row.index !== index) throw new Error("録画のチャンク順序が不正です");
        parts.push(await openBytes(key, row, mediaAad(mediaId, index), true));
        this.assertSession(epoch);
      }
      const blob = new Blob(parts, { type: mimeType });
      if (blob.size !== meta.size) throw new Error("録画サイズが台帳と一致しません");
      // Legacy data remains untouched; new writes always use a manifest.
      return blob;
    }
    const manifest = JSON.parse(new TextDecoder().decode(await openBytes(key,
      manifestRow, mediaAad(mediaId, -1))));
    const chunks = rows.filter(r => r.index !== -1);
    if (manifest.format !== 1 || manifest.mediaId !== mediaId || manifest.count !== chunks.length ||
        !Array.isArray(manifest.hashes) || manifest.hashes.length !== chunks.length)
      throw new Error("録画のチャンクが不足または不正です");
    const parts: ArrayBuffer[] = [];
    for (const [index, row] of chunks.entries()) {
      if (row.index !== index || row.id !== `${mediaId}:${index}`) throw new Error("録画の順序が不正です");
      const plain = await openBytes(key, row, mediaAad(mediaId, index));
      this.assertSession(epoch);
      if (await digestBytes(plain) !== manifest.hashes[index]) throw new Error("録画の内容が一致しません");
      parts.push(plain);
    }
    this.assertSession(epoch);
    const blob = new Blob(parts, { type: mimeType });
    if (blob.size !== manifest.size) throw new Error("録画のサイズが一致しません");
    return blob;
  }

  async deleteMediaBlob(mediaId: string): Promise<void> {
    if (!this.isUnlocked()) throw new Error("金庫が施錠されています");
    await idb.deleteMediaChunks(mediaId);
    // 鍵変更の途中に置いた仮チャンクがあれば、それも消す
    await idb.deleteMediaChunks(mediaId + REKEY_TEMP_SUFFIX);
  }

  /** 競合コピーを読む（差分確認画面用） */
  async listConflicts(): Promise<{ id: string; at: number; value: unknown }[]> {
    if (!this.key) return [];
    const epoch = this.epoch;
    const all = await idb.allRecords();
    const out: { id: string; at: number; value: unknown }[] = [];
    for (const r of all) {
      if (!r.id.includes("__conflict")) continue;
      try {
        out.push({ id: r.id, at: r.updatedAtMs, value: await openRecord(this.key, r) });
      } catch {
        /* 開けないものは飛ばす */
      }
    }
    this.assertSession(epoch);
    return out.sort((a, b) => b.at - a.at);
  }

  async dismissConflict(id: string): Promise<void> {
    await idb.deleteRecord(id);
    const all = await idb.allRecords();
    this.setStatus({ conflicts: all.filter((r) => r.id.includes("__conflict")).length });
  }

  /** 端末からローカル控えを消す（サーバー側は消さない） */
  async wipeLocal(): Promise<void> {
    await idb.clearAll();
    this.lock();
  }

  /** 現在の状態をそのまま JSON にする（バックアップ書き出し用・平文） */
  exportJson(): string {
    if (!this.isUnlocked()) throw new Error("金庫が施錠されています");
    return JSON.stringify(
      { app: "consulting-cockpit", version: 4, exportedAt: new Date().toISOString(), state: this.state },
      null,
      2,
    );
  }

  /**
   * 控え（バックアップ）の封と開封。金庫と同じ鍵を使い、
   * 「控え」という用途を AAD として結び付ける（レコードの暗号文を
   * 控えとして開く、あるいはその逆はできない）。
   * 復元にはこの金庫のパスフレーズが要る。
   */
  async sealBackup(value: unknown): Promise<Sealed> {
    if (!this.key) throw new Error("金庫が施錠されています");
    const epoch = this.epoch;
    const result = await seal(this.key, value, "cc4-backup");
    this.assertSession(epoch);
    return result;
  }

  async openBackup<T = unknown>(sealed: Sealed): Promise<T> {
    if (!this.key) throw new Error("金庫が施錠されています");
    const epoch = this.epoch;
    const result = await open<T>(this.key, sealed, "cc4-backup");
    this.assertSession(epoch);
    return result;
  }

  /** Stage encrypted records/media and a durable journal before the idempotent server request.
   * Never infer rollback from a lost response. Unlock resumes the journal using the new key. */
  async prepareReencrypt(
    newKey: CryptoKey,
    newMacKey: CryptoKey,
    onProgress?: (label: string) => void,
  ): Promise<RekeyPrepared> {
    if (!this.key) throw new Error("金庫が施錠されています");
    if (this.rekeying || await idb.getMeta("rekeyJournal")) throw new Error("未完了の鍵変更があります。再解錠して復旧してください");
    await this.sync();
    await this.flushPending();
    if ((await idb.dirtyRecords()).length) throw new Error("未同期の編集があります。同期を完了してから変更してください");
    this.rekeying = true;
    const oldKey = this.key!;
    const epoch = this.epoch;

    // レコード：開いて新しい鍵で封じ直す（まだ書き込まない）
    const all = await idb.allRecords();
    const records: { id: string; ciphertext: string; iv: string; baseSeq: number }[] = [];
    const rows: LocalRecord[] = [];
    for (const r of all) {
      if (r.deleted || r.id.includes("__conflict")) continue;
      let plain: unknown;
      try {
        plain = await openRecord(oldKey, r);
      } catch {
        throw new Error("復号できない原本があるため鍵変更を停止しました");
      }
      this.assertSession(epoch);
      const aad = aadForRow(r);
      const sealed: Sealed = await seal(newKey, plain, aad);
      records.push({ id: r.id, ciphertext: sealed.ciphertext, iv: sealed.iv, baseSeq: r.seq });
      rows.push({
        ...r,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        dirty: 0,
        hash: await hmacHex(newMacKey, JSON.stringify(plain)),
      });
    }

    // 録画：仮チャンク（__rekey__）として新しい鍵で封じ直して置く。
    // 正式採用はコミット時。AAD は本来の mediaId のものを付けるので、
    // 採用時は名前を戻すだけでよい（封じ直しは不要）。
    const mediaIds = (await idb.listMediaIds()).filter((id) => !id.endsWith(REKEY_TEMP_SUFFIX));
    for (const mediaId of mediaIds) {
      onProgress?.(mediaId);
      const chunks = await idb.mediaChunks(mediaId);
      const tempRows: MediaChunkRow[] = [];
      for (const c of chunks) {
        const plain = await openBytes(oldKey, { iv: c.iv, data: c.data }, mediaAad(mediaId, c.index), true);
        const sealed = await sealBytes(newKey, plain, mediaAad(mediaId, c.index));
        tempRows.push({
          id: `${mediaId}${REKEY_TEMP_SUFFIX}:${c.index}`,
          mediaId: mediaId + REKEY_TEMP_SUFFIX,
          index: c.index,
          iv: sealed.iv,
          data: sealed.data,
        });
      }
      await idb.putMediaChunks(tempRows);
    }
    this.assertSession(epoch);
    const prepared = { records, rows, mediaIds, before: all, generation: this.generation };
    await idb.setMeta("rekeyJournal", { ...prepared, marker: await seal(newKey, "rekey-ready", "cc4-rekey-journal") });
    return prepared;
  }

  async saveRekeyRequest(request: Parameters<typeof client.vault.rekey>[0]): Promise<void> {
    const journal = await idb.getMeta<Record<string, unknown>>("rekeyJournal");
    if (!journal) throw new Error("鍵変更の復旧情報がありません");
    await idb.setMeta("rekeyJournal", { ...journal, request });
  }

  /** サーバー側の切り替えが成功したあとに呼ぶ。ローカルを新しい鍵へ切り替える */
  async commitReencrypt(
    newKey: CryptoKey,
    newMacKey: CryptoKey,
    prepared: RekeyPrepared,
  ): Promise<void> {
    if (!this.key) throw new Error("再度解錠して鍵変更を復旧してください");
    const epoch = this.epoch;
    await this.applyRekey(prepared);
    this.assertSession(epoch);
    this.epoch++;
    this.key = newKey;
    this.macKey = newMacKey;
    this.generation = prepared.generation + 1;
    this.rekeying = false;
  }

  /** A transport error cannot prove a server rollback. Preserve both encrypted versions. */
  async abortReencrypt(): Promise<void> {
    this.lock();
    this.rekeying = false;
  }

  private async applyRekey(prepared: RekeyPrepared): Promise<void> {
    // Journal remains until every step is durable, so interrupted adoption is resumable.
    const current = await idb.allRecords();
    const newById = new Map(prepared.rows.map(r => [r.id, r]));
    const expected = new Map(prepared.before.map(r => [r.id, r]));
    for (const row of current) {
      if (JSON.stringify(row) !== JSON.stringify(expected.get(row.id)) &&
          JSON.stringify(row) !== JSON.stringify(newById.get(row.id)))
        throw new Error("別タブの変更を検知しました。復旧原本は保持されています");
    }
    for (const mediaId of prepared.mediaIds) await this.adoptMediaTemps(mediaId);
    await idb.replaceRecords(current, current.map(row => newById.get(row.id) ?? row));
    await idb.setMeta("lastRekeyRecovery", prepared);
    await idb.setMeta("rekeyJournal", null);
  }

  private async recoverRekey(): Promise<void> {
    const journal = await idb.getMeta<RekeyPrepared & { marker: Sealed; request?: Parameters<typeof client.vault.rekey>[0] }>("rekeyJournal");
    if (!journal) return;
    if (!this.key) throw new Error("金庫が施錠されています");
    try { await open(this.key, journal.marker, "cc4-rekey-journal"); }
    catch {
      if (journal.request && this.generation === journal.generation) {
        await client.vault.rekey(journal.request, { signal: AbortSignal.timeout(15000) });
      }
      throw new Error("未完了の鍵変更を再送しました。変更先の新パスフレーズで再解錠してください。旧原本と復旧情報は保持されています");
    }
    await this.applyRekey(journal);
    this.rekeying = false;
  }

  /** 仮チャンクを正式に採用する（元のチャンクを消して名前を戻す） */
  private async adoptMediaTemps(mediaId: string): Promise<void> {
    const temps = await idb.mediaChunks(mediaId + REKEY_TEMP_SUFFIX);
    if (temps.length === 0) return;
    await idb.replaceMedia(mediaId, temps.map((t) => ({ ...t, id: `${mediaId}:${t.index}`, mediaId })), mediaId + REKEY_TEMP_SUFFIX);
  }

  /**
   * 鍵変更の途中で止まった録画の結末を付ける（解錠時に必ず呼ぶ）。
   * 仮チャンクがいまの鍵で開ける = サーバー側は新しい鍵に切り替わっている
   * → 仮チャンクを採用する。開けない = 切り替わっていない → 仮チャンクを捨てる。
   */
  private async settleMediaRekey(): Promise<void> {
    const ids = await idb.listMediaIds();
    if (ids.some(id => id.endsWith(REKEY_TEMP_SUFFIX)))
      throw new Error("旧版の鍵変更一時データがあります。原本を消去せず、復旧確認を行ってください");
  }

}

/** prepareReencrypt の結果 */
export interface RekeyPrepared {
  records: { id: string; ciphertext: string; iv: string; baseSeq: number }[];
  before: LocalRecord[];
  generation: number;
  rows: LocalRecord[];
  mediaIds: string[];
}

export const vaultStore = new VaultStore();
