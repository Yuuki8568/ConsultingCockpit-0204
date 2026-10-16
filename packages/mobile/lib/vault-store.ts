/**
 * モバイル版の金庫ストア。
 *
 * ブラウザ版と同じレコード分割（case: / lead: / profile: / template: / meta:）で
 * サーバーから暗号文を受け取り、この端末の中だけで開く。
 * サーバーには暗号文と初期化ベクトルしか置かれていないので、
 * 鍵がなければ何も読めない状態は変わらない。
 *
 * 外出先での確認と記録に絞るため、書き戻すのは案件・リード・meta のみ。
 * 書類雛形の編集はブラウザ版で行う。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { client } from "./api";
import { open, seal, type Sealed } from "./vault-crypto";

const CACHE_KEY = "cockpit.records.v1";
const CURSOR_KEY = "cockpit.cursor.v1";
const DEVICE_KEY = "cockpit.deviceId.v1";

export interface LocalRecord {
  id: string;
  type: string;
  ciphertext: string;
  iv: string;
  updatedAtMs: number;
  deleted: boolean;
  seq: number;
  dirty: boolean;
}

/** 案件（必要な範囲だけ型を持つ。中身はブラウザ版と同じ形） */
export interface MobileCase {
  id: string;
  createdAt: string;
  name?: string;
  settings: {
    companyName: string;
    industry: string;
    meetingDate: string;
    keywords: string;
    [k: string]: unknown;
  };
  memo: Record<string, string>;
  nextActions: NextAction[];
  maturity: { currentStage: string; [k: string]: unknown };
  gartner: { stage: string; [k: string]: unknown };
  sheet: unknown;
  flowAnalysis: { result?: unknown } | null;
  pricing: { result?: { recommended?: number } } | null;
  execution: { contractEnd?: string; tasks?: { name: string; status: string }[] } | null;
  reports: unknown[];
  support: { contract?: { monthlyFee?: number; billingDay?: string } } | null;
  invoice: { dueDate?: string; paidFlag?: boolean };
  estimate: { totalIncTax?: number };
  legalChecklist: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
}

export interface MobileLead {
  id: string;
  createdAt: string;
  company: string;
  name: string;
  status: string;
  salesStage: string;
  dealValue: number;
  winProbability: number | null;
  nextActions: NextAction[];
  prepSheet: Record<string, string>;
  [k: string]: unknown;
}

export interface NextAction {
  id: string;
  text: string;
  due: string;
  done: boolean;
  doneAt?: string;
}

export interface MobileState {
  cases: MobileCase[];
  leads: MobileLead[];
  profile: { name: string; yago: string; [k: string]: unknown };
  meta: Record<string, unknown>;
}

export async function deviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-6);
    await AsyncStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function readCache(): Promise<LocalRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as LocalRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeCache(rows: LocalRecord[]): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(rows));
}

export async function clearCache(): Promise<void> {
  await AsyncStorage.multiRemove([CACHE_KEY, CURSOR_KEY]);
}

/** レコード群を state に組み立てる */
export function assemble(key: Uint8Array, rows: LocalRecord[]): MobileState {
  const cases: MobileCase[] = [];
  const leads: MobileLead[] = [];
  let profile: MobileState["profile"] = { name: "山代 悠生", yago: "Yuuki Yamashiro" };
  let meta: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.deleted || r.id.includes("__conflict")) continue;
    let v: unknown;
    try {
      v = open(key, r);
    } catch {
      continue;
    }
    if (r.type === "case") cases.push(v as MobileCase);
    else if (r.type === "lead") leads.push(v as MobileLead);
    else if (r.type === "profile") profile = v as MobileState["profile"];
    else if (r.type === "meta") meta = (v as Record<string, unknown>) ?? {};
  }
  cases.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  leads.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { cases, leads, profile, meta };
}

/** 端末内の控えだけで開く（通信できないときの入口） */
export async function loadOffline(key: Uint8Array): Promise<MobileState> {
  return assemble(key, await readCache());
}

/** サーバーと同期して state を返す */
export async function syncAndLoad(key: Uint8Array): Promise<{
  state: MobileState;
  offline: boolean;
  error?: string;
}> {
  const rows = await readCache();
  const byId = new Map(rows.map((r) => [r.id, r]));
  try {
    const dev = await deviceId();
    const since = Number((await AsyncStorage.getItem(CURSOR_KEY)) ?? 0);
    const dirty = rows.filter((r) => r.dirty);
    const res = await client.sync.push({
      deviceId: dev,
      since,
      records: dirty.map((r) => ({
        id: r.id,
        type: r.type as "case" | "lead" | "profile" | "template" | "meta" | "log",
        ciphertext: r.ciphertext,
        iv: r.iv,
        updatedAtMs: r.updatedAtMs,
        deleted: r.deleted,
        baseSeq: r.seq,
      })),
    });
    const accepted = new Set(res.accepted);
    for (const r of dirty) if (accepted.has(r.id)) r.dirty = false;
    for (const c of res.changed) {
      byId.set(c.id, {
        id: c.id,
        type: c.type,
        ciphertext: c.ciphertext,
        iv: c.iv,
        updatedAtMs: c.updatedAtMs,
        deleted: c.deleted,
        seq: c.seq,
        dirty: false,
      });
    }
    const merged = Array.from(byId.values());
    await writeCache(merged);
    await AsyncStorage.setItem(CURSOR_KEY, String(res.cursor));
    return { state: assemble(key, merged), offline: false };
  } catch (e) {
    return {
      state: assemble(key, rows),
      offline: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 1件だけ書き戻す（案件・リードの一部を直したとき） */
export async function saveOne(
  key: Uint8Array,
  type: "case" | "lead" | "meta",
  recordKey: string,
  value: unknown,
): Promise<void> {
  const id = `${type}:${recordKey}`;
  const rows = await readCache();
  const sealed: Sealed = seal(key, value);
  const i = rows.findIndex((r) => r.id === id);
  const row: LocalRecord = {
    id,
    type,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    updatedAtMs: Date.now(),
    deleted: false,
    seq: i >= 0 ? rows[i].seq : 0,
    dirty: true,
  };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  await writeCache(rows);
}

export async function pendingCount(): Promise<number> {
  return (await readCache()).filter((r) => r.dirty).length;
}

/** 送信待ちを流す（保存の直後に呼ぶ） */
export async function flush(key: Uint8Array): Promise<boolean> {
  const res = await syncAndLoad(key);
  return !res.offline;
}

// ---- 表示用の小さな計算（ブラウザ版と同じ判定） ----

export function classifyDue(due: string | null | undefined): {
  label: string;
  color: string;
  overdue?: boolean;
} {
  if (!due) return { label: "期限なし", color: "#6B665F" };
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.floor(
    (new Date(due).getTime() - new Date(today).getTime()) / 86400000,
  );
  if (diff < 0) return { label: "期限切れ", color: "#B85C38", overdue: true };
  if (diff === 0) return { label: "今日", color: "#C9A961" };
  if (diff <= 7) return { label: `${diff}日後`, color: "#3B6E8F" };
  if (diff <= 30) return { label: `${diff}日後`, color: "#4A7C59" };
  return { label: `${diff}日後`, color: "#6B665F" };
}

export interface HubAction extends NextAction {
  sourceType: "case" | "case_auto" | "lead";
  sourceId: string;
  sourceName: string;
}

export function collectActions(s: MobileState): HubAction[] {
  const out: HubAction[] = [];
  for (const c of s.cases) {
    const name = c.settings?.companyName || String(c.name ?? "");
    for (const a of c.nextActions ?? [])
      out.push({ ...a, sourceType: "case", sourceId: c.id, sourceName: name });
    if (c.execution?.contractEnd)
      out.push({
        id: "auto_ce_" + c.id,
        text: "契約終了・更新確認",
        due: c.execution.contractEnd,
        done: false,
        sourceType: "case_auto",
        sourceId: c.id,
        sourceName: name,
      });
    if (c.invoice?.dueDate && !c.invoice.paidFlag)
      out.push({
        id: "auto_due_" + c.id,
        text: "入金確認",
        due: c.invoice.dueDate,
        done: false,
        sourceType: "case_auto",
        sourceId: c.id,
        sourceName: name,
      });
  }
  for (const l of s.leads)
    for (const a of l.nextActions ?? [])
      out.push({ ...a, sourceType: "lead", sourceId: l.id, sourceName: l.company });
  out.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  return out;
}

/** 案件の進み具合（ブラウザ版の9段階と同じ判定） */
export function caseProgress(c: MobileCase): { done: number; total: number } {
  const checks = [
    !!c.settings?.companyName,
    !!c.sheet,
    !!(c.flowAnalysis && c.flowAnalysis.result),
    !!(c.pricing && c.pricing.result),
    !!(c.memo && (c.memo.attendees || c.memo.summary || c.memo.decisions)),
    !!(c.execution && c.execution.tasks && c.execution.tasks.length > 0),
    !!(c.reports && c.reports.length > 0),
    !!(c.support && c.support.contract && c.support.contract.monthlyFee),
    Object.values(c.legalChecklist ?? {}).some(
      (g) => g && Object.values(g).filter((v) => v === "done").length > 0,
    ),
  ];
  return { done: checks.filter(Boolean).length, total: 9 };
}

export function yen(n: number | undefined): string {
  return "¥" + (Number(n) || 0).toLocaleString("ja-JP");
}
