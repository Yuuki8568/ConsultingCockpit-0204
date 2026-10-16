/**
 * 面談の録画・録音まわりのロジック。
 * - 文字起こしファイル（vtt/srt/sbv/txt）の平文化
 * - 文字起こしから ⑤商談後メモ・②ヒアリング設計の設問への下書きを作るための
 *   プロンプト生成と、貼り戻し文の解析
 * アプリ自体は文字起こしを行わない（音声を外部に送らない設計）。
 * 文字起こしは Google Meet の機能または利用者自身のAIで行い、結果を取り込む。
 */
import type { CaseRecord } from "../types";

/** 取り込める映像・音声の拡張子 */
export const MEDIA_EXTENSIONS = [
  "mp4",
  "webm",
  "mov",
  "m4v",
  "mp3",
  "m4a",
  "wav",
  "ogg",
  "oga",
  "opus",
  "aac",
];

export const MEDIA_ACCEPT =
  MEDIA_EXTENSIONS.map((e) => "." + e).join(",") + ",video/*,audio/*";

/** 文字起こしファイルの拡張子 */
export const TRANSCRIPT_EXTENSIONS = ["vtt", "srt", "sbv", "txt"];
export const TRANSCRIPT_ACCEPT = TRANSCRIPT_EXTENSIONS.map((e) => "." + e).join(",") + ",text/plain";

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isMediaFile(name: string, mime: string): boolean {
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return true;
  return MEDIA_EXTENSIONS.includes(extOf(name));
}

export function mediaKind(name: string, mime: string): "video" | "audio" {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  const e = extOf(name);
  return ["mp3", "m4a", "wav", "ogg", "oga", "opus", "aac"].includes(e) ? "audio" : "video";
}

export function isTranscriptFile(name: string): boolean {
  return TRANSCRIPT_EXTENSIONS.includes(extOf(name));
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

export function formatDuration(sec: number | undefined): string {
  if (sec == null || !isFinite(sec) || sec <= 0) return "";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${r > 0 ? r + "秒" : ""}`;
  return `${r}秒`;
}

/**
 * 文字起こしファイルを平文にする。
 * vtt/srt/sbv のタイムスタンプ・順番行・タグを除き、直前と同じ行（Meet の逐次表示の重複）を潰す。
 */
export function parseTranscript(raw: string, fileName: string): string {
  const ext = extOf(fileName);
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const timeRe =
    /^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}\s*(-->|,|→)?\s*\d{0,2}:?\d{0,2}(?::\d{0,2})?[.,]?\d{0,3}/;
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (ext === "vtt" && /^(WEBVTT|NOTE|STYLE|REGION)/.test(line)) continue;
    if (/^\d+$/.test(line) && (ext === "srt" || ext === "vtt")) continue; // 順番行
    if (timeRe.test(line)) continue; // タイムスタンプ行（sbv は「0:00:01.0,0:00:04.0」）
    line = line.replace(/<[^>]+>/g, "").trim(); // タグ除去
    if (!line) continue;
    if (out[out.length - 1] === line) continue; // 直前と同じ行は捨てる
    out.push(line);
  }
  return out.join("\n");
}

/** ⑤商談後メモの取り込み対象項目（キーとラベル） */
export const MEMO_AUTOFILL_FIELDS: [string, string][] = [
  ["attendees", "⑤出席者"],
  ["decisionMaker", "⑤最終的に決める人"],
  ["summary", "⑤話したこと"],
  ["decisions", "⑤決まったこと"],
  ["budget", "⑤予算感"],
  ["agreed", "⑤合意したこと"],
  ["unagreed", "⑤未合意・保留"],
  ["concerns", "⑤相手の懸念・ためらい"],
  ["toConfirm", "⑤追加で確認すること"],
  ["priceReaction", "⑤価格仮説への反応"],
];

/**
 * 文字起こしから ⑤・② の下書きを作らせるためのプロンプト。
 * 利用者が自分のAIに貼って使う。出力は【キー】見出しの固定形式に限定し、
 * アプリ側で機械的に解析できるようにする。
 */
export function buildTranscriptPrompt(c: CaseRecord, transcript: string): string {
  const lines: string[] = [];
  lines.push("以下は面談の文字起こしです。この内容だけを根拠に、指定の項目への下書きを作ってください。");
  lines.push("");
  lines.push("守ること:");
  lines.push("・文字起こしにないことを推測で書かないでください");
  lines.push("・該当する情報がない項目は「（情報なし）」とだけ書いてください");
  lines.push("・相手が実際に使った言葉はできるだけそのまま残してください");
  lines.push("・事実とこちらの確認事項は混ぜないでください");
  lines.push("");
  lines.push("出力形式（この見出しの形だけを使い、各見出しの直下に本文を書いてください）:");
  for (const [key, label] of MEMO_AUTOFILL_FIELDS) {
    lines.push(`【memo:${key}】… ${label} の下書き`);
  }
  const sheet = c.sheet;
  if (sheet) {
    lines.push("");
    lines.push("続けて、以下の設問への回答の下書きを「【answer:設問ID】」の見出しで出してください。");
    lines.push("根拠となる発言がない設問は「（情報なし）」としてください。");
    for (const [cat, qs] of Object.entries(sheet.questions ?? {})) {
      for (const q of qs) {
        lines.push(`・${q.id}: ${q.q}（${cat}）`);
      }
    }
  }
  lines.push("");
  lines.push(`企業名: ${c.settings.companyName || "（未設定）"}`);
  lines.push("");
  lines.push("---- ここから文字起こし ----");
  lines.push(transcript);
  lines.push("---- ここまで ----");
  return lines.join("\n");
}

export interface AutofillEntry {
  /** "memo:<key>" または "answer:<questionId>" */
  key: string;
  value: string;
}

/**
 * 貼り戻し文の解析。【キー】見出しで区切られた本文を拾う。
 * 「（情報なし）」・空欄は取り込まない。想定外のキーは無視する（解析結果に含めない）。
 */
export function parseAutofillOutput(text: string): AutofillEntry[] {
  const entries: AutofillEntry[] = [];
  const re = /【\s*(memo:[a-zA-Z]+|answer:[A-Za-z0-9_\-]+)\s*】/g;
  const marks: { key: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    marks.push({ key: m[1], start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].end;
    const to = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const value = text
      .slice(from, to)
      .replace(/^\s*[:：…]?\s*/, "")
      .trim();
    if (!value) continue;
    if (/^（情報なし）$/.test(value)) continue;
    if (value === "（情報なし）") continue;
    entries.push({ key: marks[i].key, value });
  }
  return entries;
}
