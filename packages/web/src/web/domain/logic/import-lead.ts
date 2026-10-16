/**
 * ファイルからのリード読み取り（自動振り分け）。
 *
 * 外部AIには接続しない。判定は決め打ちのルール（キー名の別名表・ラベル行・
 * 定型句・メールヘッダの差出人照合）だけで行い、判定できないものは
 * 「不明（空欄）」のまま返す。不明な項目を推測で埋めない
 * （空欄を確認済みにしない方針と同じ）。
 *
 * 対応フォーマット:
 * - JSON: 送信記録（outreach_log）形式。配列・単一オブジェクト・
 *   {records|log|items|entries|送信記録|ログ|データ|...: [...]}、1行1件のNDJSON(.jsonl/.ndjson)
 * - CSV / TSV (.csv/.tsv): 1行目が見出し（事業所名・チャネル等の別名表で判定）。
 *   UTF-8・Shift_JISを自動判別
 * - Excel (.xlsx/.xls): 先頭シートの1行目を見出しとして読む（日付セル・数値日付に対応）
 * - テキスト (.txt/.md): 「ラベル: 値」の行と本文。区切り線で複数件に分割
 * - メール (.eml): ヘッダ（RFC2047の件名・差出人）と本文（base64/quoted-printable）を復号。
 *   差出人が自分のメールアドレスと一致すれば「メール送信（こちらから）」と判定する
 */

import * as XLSX from "xlsx";
import { sanitizeInput } from "./sales";

/** 判定結果。空欄は「不明」で、作成前に人が選ぶ */
export type ImportKind = "" | "emailOut" | "formOut" | "inbound";

export const IMPORT_KIND_OPTIONS: [ImportKind, string][] = [
  ["", "不明（作成前に選択）"],
  ["emailOut", "メール送信（こちらから）"],
  ["formOut", "フォーム送信（こちらから）"],
  ["inbound", "問い合わせ受信（相手から）"],
];

export const IMPORT_KIND_LABEL: Record<string, string> = {
  emailOut: "メール送信",
  formOut: "フォーム送信",
  inbound: "問い合わせ受信",
};

export interface ParsedImport {
  id: string;
  /** 取り込み元のファイル名 */
  sourceName: string;
  /** 自動判定の結果。空欄は不明（人が選ぶまで作成できない） */
  kind: ImportKind;
  company: string;
  name: string;
  email: string;
  subject: string;
  body: string;
  /** 送信日 YYYY-MM-DD。読み取れなければ空欄 */
  sentAt: string;
  /** 送信結果。空欄は未記録 */
  sendResult: "" | "sent" | "failed" | "unknown";
  sourceUrl: string;
  stopFlag: boolean;
  note: string;
  /** 人が確認すべき点（読み取れなかった項目など） */
  warnings: string[];
}

/** 判定の補助情報。myEmails は .eml の差出人照合に使う自分のアドレス */
export interface ParseOptions {
  myEmails?: string[];
}

type Any = Record<string, unknown>;

let seq = 0;
function nextId(): string {
  seq += 1;
  return `IMP${Date.now().toString(36)}_${seq}`;
}

/* ---- キー名の別名表（表記ゆれを正規化して同じ項目に読み替える） ---- */

type Field =
  | "company"
  | "name"
  | "email"
  | "subject"
  | "body"
  | "sentAt"
  | "sendResult"
  | "channel"
  | "sourceUrl"
  | "stopFlag"
  | "note";

const FIELD_ALIASES: Record<Field, string[]> = {
  company: [
    "事業所名", "企業名", "会社名", "法人名", "社名", "会社", "法人", "団体名", "施設名",
    "取引先", "取引先名", "顧客名", "クライアント", "宛先企業", "送信先企業",
    "company", "company_name", "organization", "corp",
  ],
  name: [
    "宛名", "担当者名", "ご担当者", "ご担当者様", "担当者様", "氏名", "お名前", "担当者", "担当",
    "ご担当", "先方担当者", "担当者氏名", "ご担当者名", "name", "recipient", "contact",
    "contact_name",
  ],
  email: [
    "宛先", "メールアドレス", "メール", "メアド", "送信先", "送信先メール", "宛先メール",
    "宛先メールアドレス", "連絡先", "連絡先メール", "to", "email", "e-mail", "mail",
    "mailaddress", "emailaddress", "address",
  ],
  subject: ["件名", "題名", "タイトル", "表題", "subject", "title"],
  body: [
    "本文全文", "本文", "内容", "送信文", "送信内容", "送信した本文", "メール本文", "文面",
    "送信文面", "メッセージ", "body", "message", "text",
  ],
  sentAt: [
    "送信日時", "送信日", "日時", "送信日付", "日付", "対応日", "送付日", "実施日",
    "送信年月日", "送信した日", "sentat", "sent_at", "date", "created_at", "createdat",
  ],
  sendResult: [
    "送信結果", "結果", "ステータス", "送信ステータス", "送信状況", "送信状態", "状況",
    "sendresult", "send_result", "result", "status",
  ],
  channel: [
    "チャネル", "経路", "送信経路", "方法", "送信方法", "手段", "送付方法", "区分",
    "channel", "via", "media",
  ],
  sourceUrl: [
    "出典URL", "出典", "出典リンク", "参照元", "元URL", "リンク", "url", "sourceurl",
    "source_url", "link", "source",
  ],
  stopFlag: [
    "連絡停止フラグ", "連絡停止", "停止", "連絡不可", "送信停止", "停止フラグ", "NG",
    "NGフラグ", "contactstop", "stop", "ng", "ngflag",
  ],
  note: ["備考", "メモ", "特記事項", "コメント", "補足", "note", "notes", "memo", "comment"],
};

/** キー名の正規化: 空白・括弧・コロン・装飾を落として小文字化 */
function normKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[【】「」『』\[\]()（）:：\s_・./\-―─―]/g, "");
}

const ALIAS_TO_FIELD = new Map<string, Field>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Field, string[]][]) {
  for (const a of aliases) {
    const k = normKey(a);
    if (!ALIAS_TO_FIELD.has(k)) ALIAS_TO_FIELD.set(k, field);
  }
}

/* ---- 値の取り出し ---- */

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 値を文字列化。ネストした {name: ...} / {value: ...} は中身を取る */
function valToString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : isoDate(v);
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Any;
    for (const kk of ["name", "名前", "名称", "title", "label", "value", "値"]) {
      const inner = o[kk];
      if (typeof inner === "string" && inner.trim()) return inner.trim();
      if (typeof inner === "number") return String(inner);
    }
  }
  return "";
}

/** レコード（連想配列）から別名表で項目を抽出する */
function extractFields(rec: Any): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  for (const [k, v] of Object.entries(rec)) {
    const f = ALIAS_TO_FIELD.get(normKey(k));
    if (!f || out[f] !== undefined) continue;
    const s = valToString(v);
    if (s !== "" || f === "stopFlag") out[f] = s;
  }
  return out;
}

function parseStopFlag(v: string): boolean {
  const s = v.trim().toLowerCase();
  if (!s || ["false", "0", "no", "なし", "しない"].includes(s)) return false;
  return ["true", "1", "yes", "on", "停止", "あり", "する", "停止する", "ng", "連絡不可"].includes(s);
}

/** 日付らしき文字列を YYYY-MM-DD に揃える。読み取れなければ空欄 */
function normDate(v: string): string {
  const s = v.trim();
  if (!s) return "";
  // Excelの数値日付（1899-12-30起点のシリアル値）
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 20000 && n < 80000) {
      const d = new Date(Math.round(Date.UTC(1899, 11, 30) + n * 86400000));
      return d.toISOString().slice(0, 10);
    }
    return "";
  }
  // 和暦: 令和8年9月25日 / R8年9月25日 / 平成元年5月1日
  const era = s.match(/(令和|平成|昭和|[Rr]|[Hh]|[Ss])\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (era) {
    const base = { 令和: 2018, 平成: 1988, 昭和: 1925, r: 2018, h: 1988, s: 1925 }[
      era[1].toLowerCase()
    ];
    if (base) {
      const y = base + (era[2] === "元" ? 1 : parseInt(era[2], 10));
      return `${y}-${era[3].padStart(2, "0")}-${era[4].padStart(2, "0")}`;
    }
  }
  // 2026-09-25 / 2026/9/5 / 2026.9.5 / 2026年9月25日 / ISO(2026-09-25T10:30:00+09:00)
  const m = s.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // RFC2822（.emlのDateヘッダ）: Thu, 25 Sep 2026 10:30:00 +0900
  const rfc = s.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (rfc) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const mo = months.indexOf(rfc[2].toLowerCase()) + 1;
    if (mo > 0) return `${rfc[3]}-${String(mo).padStart(2, "0")}-${rfc[1].padStart(2, "0")}`;
  }
  return "";
}

/* ---- 種別・送信結果の判定語 ---- */

function mapSendResult(v: string): ParsedImport["sendResult"] {
  const s = v.trim().toLowerCase();
  if (!s) return "";
  if (
    ["送信確認済み", "送信確認済", "送信済み", "送信済", "完了", "成功", "送達", "送達済み", "済", "ok"].includes(s) ||
    ["sent", "delivered", "done", "success"].includes(s)
  )
    return "sent";
  if (
    ["未送信確定", "未送信", "失敗", "エラー", "送信失敗", "不達", "未到達"].includes(s) ||
    ["failed", "bounce", "bounced", "error"].includes(s)
  )
    return "failed";
  if (["結果不明", "不明", "未確認", "確認中", "保留"].includes(s) || ["unknown", "pending"].includes(s))
    return "unknown";
  return "";
}

/** チャネル値の判定。完全一致→部分一致の順。部分一致は決め打ちの語句のみ */
function mapChannel(v: string): ImportKind | "?" {
  const s = normKey(v);
  if (!s) return "?";
  const email = [
    "email", "mail", "eメール", "メール", "電子メール", "メール送信", "送信メール", "営業メール",
    "メール（こちらから）",
  ].map(normKey);
  const form = [
    "form", "フォーム", "問い合わせフォーム", "お問い合わせフォーム", "問合せフォーム",
    "フォーム送信", "webフォーム", "webform", "hpフォーム", "ホームページフォーム",
    "フォーム（こちらから）",
  ].map(normKey);
  const inbound = [
    "inbound", "inquiry", "受信", "問い合わせ", "問い合わせ受信", "お問い合わせ受信",
    "問合せ", "問合せ受信", "お問合せ", "お問い合わせ", "インバウンド", "問い合わせ（受信）",
  ].map(normKey);
  if (email.includes(s)) return "emailOut";
  if (form.includes(s)) return "formOut";
  if (inbound.includes(s)) return "inbound";
  // 部分一致: 「フォーム」を含めばフォーム送信、「受信・受付・通知」を伴う問い合わせは受信
  if (s.includes("フォーム")) return "formOut";
  if ((s.includes("問い合わせ") || s.includes("問合せ")) && /受信|受付|通知|あり/.test(s))
    return "inbound";
  if (s.includes("メール") || s.includes("mail")) return "emailOut";
  return "?";
}

const INBOUND_MARKS = [
  "お問い合わせがありました",
  "お問い合わせを受け付けました",
  "お問合せがありました",
  "フォームからのお問い合わせ",
  "フォームよりお問い合わせ",
  "問い合わせ通知",
  "お問い合わせ通知",
  "新しいお問い合わせ",
  "お問い合わせを受信",
  "問い合わせがあり",
  "ご相談を受け付け",
  "資料請求があり",
  "ホームページからのお問い合わせ",
  "サイトからのお問い合わせ",
];
const FORM_OUT_MARKS = [
  "フォーム送信",
  "問い合わせフォームへ送信",
  "送信フォーム",
  "フォームより送信",
  "フォームから送信",
  "フォームへ送信",
  "フォームで送信",
  "問い合わせフォームから送信",
  "問い合わせフォームに送信",
];
const RESULT_MARKS = [
  "送信確認済み",
  "送信確認済",
  "未送信確定",
  "結果不明",
  "送信済み",
];

/** 本文・件名から法人名らしき文字列を抽出する（候補として出し、確認を促す） */
const CORP_TYPES =
  "株式会社|有限会社|合同会社|合資会社|合名会社|医療法人|社会福祉法人|学校法人|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人|独立行政法人|地方自治体|税理士法人|社会保険労務士法人|行政書士法人|司法書士法人";
const CORP_NAME_CHARS = "ぁ-んァ-ヶ一-龥ー・A-Za-z0-9０-９ａ-ｚＡ-Ｚ（）()&＆'’";
function extractCorpName(text: string): string {
  const fwd = text.match(new RegExp(`(?:${CORP_TYPES})[${CORP_NAME_CHARS}]{1,30}`));
  const rev = text.match(new RegExp(`[${CORP_NAME_CHARS}]{1,30}?(?:${CORP_TYPES})`));
  const hit = fwd?.[0] ?? rev?.[0] ?? "";
  return hit.replace(/(様|御中|殿|さま)$/, "").trim();
}

function addrOnly(v: string): string {
  const m = v.match(/<([^>]+)>/);
  const s = (m ? m[1] : v).trim();
  const at = s.match(/[^\s,;]+@[^\s,;]+/);
  return at ? at[0] : s;
}

/* ---- JSON ---- */

function parseJsonRecord(rec: Any, sourceName: string): ParsedImport {
  const warnings: string[] = [];
  const f = extractFields(rec);
  const rawChannel = f.channel ?? "";
  const rawResult = f.sendResult ?? "";
  const company0 = f.company ?? "";
  const subject = f.subject ?? "";
  const body = f.body ?? "";
  const email = f.email ?? "";
  const sourceUrl = f.sourceUrl ?? "";
  const sendResult = mapSendResult(rawResult);
  const hay = `${subject}\n${body}`;

  let kind: ImportKind = "";
  if (rawChannel) {
    const mapped = mapChannel(rawChannel);
    if (mapped !== "?") kind = mapped;
    else warnings.push(`チャネル「${rawChannel}」は判定対象外の値です。作成前に種別を選んでください`);
  }
  if (!kind && INBOUND_MARKS.some((mk) => hay.includes(mk))) kind = "inbound";
  if (!kind && (sendResult || rawResult)) {
    if (FORM_OUT_MARKS.some((mk) => hay.includes(mk))) kind = "formOut";
    else if (email.includes("@")) kind = "emailOut";
    else if (sourceUrl) kind = "formOut";
    else warnings.push("チャネルが記録されていません。作成前に種別を選んでください");
  }
  if (!kind && !rawChannel && !(sendResult || rawResult)) {
    warnings.push("チャネルが記録されていません。作成前に種別を選んでください");
  }
  if (rawResult && !sendResult)
    warnings.push(`送信結果「${rawResult}」は読み取れませんでした。送信状態は空欄のままです`);

  const sentAt = normDate(f.sentAt ?? "");
  let company = company0;
  if (!company) {
    const cand = extractCorpName(hay);
    if (cand) {
      company = cand;
      warnings.push("企業名の項目がなかったため、本文・件名から抽出した候補を入れています。確認してください");
    } else {
      warnings.push("企業名を読み取れませんでした。作成前に入力してください");
    }
  }
  return {
    id: nextId(),
    sourceName,
    kind,
    company: sanitizeInput(company, 200),
    name: sanitizeInput(f.name ?? "", 100),
    email: sanitizeInput(email, 200),
    subject: sanitizeInput(subject, 300),
    body: sanitizeInput(body, 20000),
    sentAt,
    sendResult,
    sourceUrl: sanitizeInput(sourceUrl, 500),
    stopFlag: parseStopFlag(f.stopFlag ?? ""),
    note: sanitizeInput(f.note ?? "", 1000),
    warnings,
  };
}

const WRAPPER_KEYS = [
  "records", "log", "items", "entries", "data", "results", "rows", "list", "history",
  "送信記録", "ログ", "データ", "一覧", "記録", "送信履歴",
];

function asRecordList(data: unknown): Any[] | null {
  if (Array.isArray(data)) {
    const l = data.filter((r): r is Any => !!r && typeof r === "object" && !Array.isArray(r));
    return l.length ? l : null;
  }
  if (data && typeof data === "object") {
    const obj = data as Any;
    for (const k of WRAPPER_KEYS) {
      const v = obj[k] ?? obj[normKey(k)];
      if (Array.isArray(v)) {
        const l = v.filter((r): r is Any => !!r && typeof r === "object" && !Array.isArray(r));
        if (l.length) return l;
      }
    }
    // キー名が分からなくても、オブジェクトの配列が1つだけならそれを記録とみなす
    const arrays = Object.values(obj).filter(
      (v): v is unknown[] =>
        Array.isArray(v) && v.some((r) => !!r && typeof r === "object" && !Array.isArray(r)),
    );
    if (arrays.length === 1)
      return arrays[0].filter((r): r is Any => !!r && typeof r === "object" && !Array.isArray(r));
    return [obj]; // 単一オブジェクト
  }
  return null;
}

function parseJson(text: string, sourceName: string): ParsedImport[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const list = asRecordList(data);
  if (!list) return null;
  return list.map((r) => parseJsonRecord(r, sourceName));
}

/** 1行1件のNDJSON（.jsonl/.ndjson）。全行がJSONオブジェクトのときだけ認める */
function parseNdjson(text: string, sourceName: string): ParsedImport[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 1) return null;
  const recs: Any[] = [];
  for (const l of lines) {
    try {
      const o: unknown = JSON.parse(l);
      if (!o || typeof o !== "object" || Array.isArray(o)) return null;
      recs.push(o as Any);
    } catch {
      return null;
    }
  }
  return recs.length ? recs.map((r) => parseJsonRecord(r, sourceName)) : null;
}

/* ---- テキスト ---- */

const BODY_START_LABELS = new Set(
  ["本文", "本文全文", "内容", "送信文", "送信内容", "メール本文", "文面", "送信文面", "メッセージ"].map(
    normKey,
  ),
);

interface TextGot {
  company?: string;
  name?: string;
  email?: string;
  subject?: string;
  sentAt?: string;
  sendResult?: string;
  channel?: string;
  sourceUrl?: string;
  stopFlag?: string;
  note?: string;
  from?: string;
  body: string;
}

function scanLabels(lines: string[]): TextGot {
  const got: TextGot = { body: "" };
  let bodyStart = -1;
  let bodyHead = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*[【\[]?\s*([^\s:：\]】]{1,20}?)\s*[】\]]?\s*[:：]\s*(.*)$/);
    if (!m) continue;
    const label = normKey(m[1]);
    const value = m[2].trim();
    if (BODY_START_LABELS.has(label)) {
      // 本文マーカー以降もラベル行を拾い続ける（問い合わせ通知メールのように、
      // 本文の中に「会社名: 」等が含まれる形式に対応するため break しない）
      if (bodyStart < 0) {
        bodyStart = i;
        bodyHead = value;
      }
      continue;
    }
    const field = ALIAS_TO_FIELD.get(label);
    if (field && field !== "body" && got[field] === undefined) got[field] = value;
    // メールヘッダ形式（英語ヘッダ名）・差出人
    if (!got.subject && /^subject$/i.test(label)) got.subject = value;
    if (!got.email && /^to$/i.test(label)) got.email = value;
    if (!got.from && (/^from$/i.test(label) || label === "差出人" || label === "送信者"))
      got.from = value;
    if (!got.sentAt && /^date$/i.test(label)) got.sentAt = normDate(value);
  }
  got.body =
    bodyStart >= 0
      ? [bodyHead, ...lines.slice(bodyStart + 1)].join("\n").trim()
      : lines.join("\n").trim();
  return got;
}

/** ラベル行＋定型句から種別・送信結果を判定する（推測で埋めない） */
function buildFromText(
  got: TextGot,
  fullText: string,
  sourceName: string,
  opts?: ParseOptions,
): ParsedImport {
  const warnings: string[] = [];
  let kind: ImportKind = "";
  const channelRaw = got.channel ?? "";
  const resultRaw = got.sendResult ?? "";
  const fromAddr = got.from ? addrOnly(got.from).toLowerCase() : "";
  const mine = (opts?.myEmails ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);

  if (channelRaw) {
    const mapped = mapChannel(channelRaw);
    if (mapped !== "?") kind = mapped;
    else warnings.push(`チャネル「${channelRaw}」は判定対象外の値です。作成前に種別を選んでください`);
  }
  if (!kind && INBOUND_MARKS.some((mk) => fullText.includes(mk))) kind = "inbound";
  if (!kind && fromAddr && mine.includes(fromAddr)) kind = "emailOut";
  if (!kind) {
    const hasResultMark = !!resultRaw || RESULT_MARKS.some((mk) => fullText.includes(mk));
    if (hasResultMark) {
      kind = FORM_OUT_MARKS.some((mk) => fullText.includes(mk)) ? "formOut" : "emailOut";
    } else {
      warnings.push("種別を判定できる記載（送信結果・チャネル・問い合わせ通知の定型句）が見つかりません。作成前に種別を選んでください");
    }
  }
  const markHit = RESULT_MARKS.find((mk) => fullText.includes(mk));
  const sendResult = mapSendResult(resultRaw) || (markHit ? mapSendResult(markHit) : "");
  if (resultRaw && !sendResult)
    warnings.push(`送信結果「${resultRaw}」は読み取れませんでした。送信状態は空欄のままです`);

  // 受信メールは差出人、送信メールは宛先を連絡先として採る
  let email = got.email ?? "";
  let name = got.name ?? "";
  if (kind === "inbound" && got.from) {
    email = fromAddr || email;
    if (!name) {
      const disp = got.from.match(/^\s*"?([^"<]+)"?\s*</);
      if (disp) name = disp[1].trim();
    }
  } else if (kind === "emailOut" && got.email) {
    email = addrOnly(got.email);
    if (!name) {
      const disp = got.email.match(/^\s*"?([^"<]+)"?\s*</);
      if (disp) name = disp[1].trim();
    }
  }

  let company = got.company ?? "";
  if (!company) {
    const cand = extractCorpName(`${got.subject ?? ""}\n${got.body}\n${fullText}`);
    if (cand) {
      company = cand;
      warnings.push("企業名の項目がなかったため、本文・件名から抽出した候補を入れています。確認してください");
    } else {
      warnings.push("企業名を読み取れませんでした。作成前に入力してください");
    }
  }
  return {
    id: nextId(),
    sourceName,
    kind,
    company: sanitizeInput(company, 200),
    name: sanitizeInput(name, 100),
    email: sanitizeInput(email, 200),
    subject: sanitizeInput(got.subject ?? "", 300),
    body: sanitizeInput(got.body, 20000),
    sentAt: normDate(got.sentAt ?? ""),
    sendResult,
    sourceUrl: sanitizeInput(got.sourceUrl ?? "", 500),
    stopFlag:
      (got.stopFlag ? parseStopFlag(got.stopFlag) : false) ||
      /連絡停止フラグ\s*[:：]\s*(true|1|停止|あり)/.test(fullText),
    note: sanitizeInput(got.note ?? "", 1000),
    warnings,
  };
}

function parseText(text: string, sourceName: string, opts?: ParseOptions): ParsedImport {
  return buildFromText(scanLabels(text.split(/\r?\n/)), text, sourceName, opts);
}

/** 区切り線（---・===・――など3文字以上の装飾線）で複数件に分割する */
function splitRecords(text: string): string[] {
  const parts = text.split(
    /^\s*[\-‐‑‒–—─━―=＝*＊~〜_＿]{3,}\s*$/m,
  );
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/* ---- .eml（RFC2047・base64/quoted-printableを復号する） ---- */

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const cs = charset.trim().toLowerCase().replace(/["']/g, "");
  const name =
    cs === "shift-jis" || cs === "sjis" || cs === "shift_jis"
      ? "shift_jis"
      : cs === "iso-2022-jp" || cs === "iso2022jp"
        ? "iso-2022-jp"
        : cs || "utf-8";
  try {
    return new TextDecoder(name).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function qpToBytes(s: string): Uint8Array {
  const soft = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      out.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(soft.charCodeAt(i));
    }
  }
  return new Uint8Array(out);
}

/** =?charset?B?...?= / =?charset?Q?...?= の復号（連続する符号化語の間の空白は捨てる） */
function decodeRfc2047(s: string): string {
  const withMarks = s.replace(/\?=\s+=\?/g, "?=__EW__=?");
  const decoded = withMarks.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*?)\?=/g,
    (_, cs: string, enc: string, payload: string) => {
      try {
        if (enc.toUpperCase() === "B") return decodeBytes(b64ToBytes(payload), cs);
        return decodeBytes(qpToBytes(payload.replace(/_/g, " ")), cs);
      } catch {
        return payload;
      }
    },
  );
  return decoded.replace(/__EW__/g, "");
}

interface EmlParts {
  headers: Map<string, string>;
  body: string;
}

function splitEml(raw: string): { headerLines: string[]; body: string } {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index === undefined) return { headerLines: raw.split(/\r?\n/), body: "" };
  return {
    headerLines: raw.slice(0, m.index).split(/\r?\n/),
    body: raw.slice(m.index + m[0].length),
  };
}

function parseEmlPart(raw: string): EmlParts {
  const { headerLines, body } = splitEml(raw);
  // 折り返し行（先頭が空白・タブ）を前行に連結
  const unfolded: string[] = [];
  for (const l of headerLines) {
    if (/^[ \t]/.test(l) && unfolded.length) unfolded[unfolded.length - 1] += l.trim();
    else unfolded.push(l);
  }
  const headers = new Map<string, string>();
  for (const l of unfolded) {
    const m = l.match(/^([^:]{1,40}):\s*(.*)$/);
    if (m) headers.set(m[1].trim().toLowerCase(), m[2]);
  }
  const ctype = headers.get("content-type") ?? "";
  const enc = (headers.get("content-transfer-encoding") ?? "").toLowerCase();
  const charset = ctype.match(/charset\s*=\s*"?([^";]+)"?/i)?.[1] ?? "utf-8";
  const boundary = ctype.match(/boundary\s*=\s*"?([^";]+)"?/i)?.[1];

  if (boundary) {
    // マルチパート: text/plain を優先、なければ最初のパートを再帰的に読む
    const parts = body.split(`--${boundary}`).slice(1, -1);
    const texts = parts.map((pt) => parseEmlPart(pt.replace(/^\r?\n/, "")));
    const plain = texts.find((t) => t.body.trim() !== "" && !/text\/html/i.test(t.headers.get("content-type") ?? ""))
      ?? texts.find((t) => t.body.trim() !== "");
    return { headers, body: plain ? plain.body.replace(/<[^>]+>/g, "") : "" };
  }
  if (enc === "base64") {
    try {
      return { headers, body: decodeBytes(b64ToBytes(body), charset) };
    } catch {
      return { headers, body };
    }
  }
  if (enc === "quoted-printable") return { headers, body: decodeBytes(qpToBytes(body), charset) };
  // 7bit/8bit: UTF-8 以外の文字コードで本文が ASCII 範囲に収まっている場合（ISO-2022-JP など）は
  // 文字コードをバイト列に戻してから復号する。日本語が既に文字として読めている場合は触らない
  if (charset && !/^utf-?8$/i.test(charset) && /^[\x00-\x7f]*$/.test(body)) {
    const bytes = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i);
    return { headers, body: decodeBytes(bytes, charset) };
  }
  return { headers, body };
}

/** .eml をラベル行つきのテキストに変換してから共通の判定に渡す */
function parseEml(raw: string, sourceName: string, opts?: ParseOptions): ParsedImport {
  const { headers, body } = parseEmlPart(raw);
  const subject = decodeRfc2047(headers.get("subject") ?? "");
  const to = decodeRfc2047(headers.get("to") ?? "");
  const from = decodeRfc2047(headers.get("from") ?? "");
  const date = headers.get("date") ?? "";
  const doc = [
    subject ? `件名: ${subject}` : "",
    to ? `宛先: ${to}` : "",
    from ? `差出人: ${from}` : "",
    date ? `送信日時: ${date}` : "",
    "",
    "本文:",
    body.trim(),
  ]
    .filter((l, i) => l !== "" || i >= 4)
    .join("\n");
  return buildFromText(scanLabels(doc.split(/\r?\n/)), doc, sourceName, opts);
}

/* ---- 表形式（CSV/TSV/Excel 共通） ---- */

/** 区切り文字を意識したCSVパーサ。引用符内の改行・区切り文字に対応する */
function parseDelimitedRows(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === delim) {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

function blockedRow(sourceName: string, warning: string): ParsedImport {
  return {
    id: nextId(),
    sourceName,
    kind: "",
    company: "",
    name: "",
    email: "",
    subject: "",
    body: "",
    sentAt: "",
    sendResult: "",
    sourceUrl: "",
    stopFlag: false,
    note: "",
    warnings: [warning],
  };
}

/** 行の配列を読み取る。1行目を見出し行として別名表で判定する */
function parseRows(rowsRaw: string[][], sourceName: string): ParsedImport[] {
  const rows = rowsRaw.filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return [blockedRow(sourceName, "ファイルが空です")];
  const header = rows[0].map((h) => h.trim());
  const known = header.some((h) => ALIAS_TO_FIELD.has(normKey(h)));
  if (!known) {
    return [
      blockedRow(
        sourceName,
        "1行目が見出し行（事業所名・宛名・チャネル・送信結果など）として読み取れませんでした。見出し行のあるCSV/TSV/Excelに直してから読み込んでください",
      ),
    ];
  }
  return rows.slice(1).map((cols) => {
    const rec: Any = {};
    header.forEach((h, i) => {
      if (h) rec[h] = cols[i] ?? "";
    });
    return parseJsonRecord(rec, sourceName);
  });
}

function parseDelimited(text: string, sourceName: string, ext: string): ParsedImport[] {
  // 区切りは拡張子優先。判別できない行の混在を避けるため先頭行でタブ/カンマの多い方を採る
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim =
    ext === ".tsv" ||
    (ext !== ".csv" &&
      (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0))
      ? "\t"
      : ",";
  return parseRows(parseDelimitedRows(text, delim), sourceName);
}

/** Excel（.xlsx/.xls）を読み取る。先頭シートの1行目を見出し行とする */
export function parseSpreadsheetFile(name: string, buf: ArrayBuffer): ParsedImport[] {
  try {
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [blockedRow(name, "シートが見つかりませんでした")];
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: "",
    });
    const rows = raw.map((r) => r.map((c) => valToString(c)));
    return parseRows(rows, name);
  } catch {
    return [
      blockedRow(
        name,
        "Excelファイルを読み取れませんでした。破損していないか確認してください",
      ),
    ];
  }
}

/* ---- 入口 ---- */

/**
 * ファイルの文字コードを判別して文字列にする。
 * BOMがあればそれに従い、なければUTF-8として読み、壊れる場合だけShift_JISに倒す。
 * （Excelから書き出したCSVがShift_JISになることが多いため）
 */
export function decodeImportFile(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    return new TextDecoder("utf-8").decode(b.subarray(3));
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff)
    return new TextDecoder("utf-16be").decode(b.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("shift_jis").decode(b);
  }
}

/** バイナリ（Excel）形式かどうか。バイナリは parseSpreadsheetFile に渡す */
export function isSpreadsheetName(name: string): boolean {
  return /\.(xlsx|xls)$/i.test(name);
}

/**
 * ファイル1個を読み取る。JSON・NDJSONとCSV/TSVなら複数件、テキストとメールなら1件を返す
 * （テキストは区切り線で複数件に分割する）。
 * 読み取れないファイル形式のときは warnings 入りの1件を返す（作成はブロックされる）。
 */
export function parseImportFile(
  name: string,
  text: string,
  opts?: ParseOptions,
): ParsedImport[] {
  const trimmed = text.trim();
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (!trimmed) return [blockedRow(name, "ファイルが空です")];
  if (ext === "csv" || ext === "tsv") return parseDelimited(trimmed, name, "." + ext);
  if (ext === "eml") return [parseEml(trimmed, name, opts)];
  if (ext === "jsonl" || ext === "ndjson") {
    const nd = parseNdjson(trimmed, name);
    if (nd) return nd;
  }
  if (ext === "json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = parseJson(trimmed, name);
    if (parsed && parsed.length) return parsed;
    // 1行1件のNDJSONとしても読んでみる
    const nd = parseNdjson(trimmed, name);
    if (nd && nd.length) return nd;
    // どちらでも読めなかった場合はテキストとして扱う
  }
  const chunks = splitRecords(trimmed);
  if (chunks.length === 0) return [blockedRow(name, "ファイルが空です")];
  return chunks.map((c) => parseText(c, name, opts));
}
