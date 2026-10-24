import type { CaseRecord } from "../../domain/types";
export interface TranscriptReview {
  recognition: { mode: "accurate"; model: string; revision: string };
  sourceName: string; reviewedAt: string; originalText: string; importedText: string;
  segments: { start: number; end: number; original: string; text: string }[];
}
export const MAX_REVIEW_BYTES = 2 * 1024 * 1024;
export function parseTranscriptReview(raw: string): TranscriptReview {
  if (new TextEncoder().encode(raw).length > MAX_REVIEW_BYTES) throw new Error('確認済み文字起こしは2MB以下にしてください。');
  const value: unknown = JSON.parse(raw);
  const fail = (): never => { throw new Error('確認済み文字起こし形式ではありません。補助ツールの確認画面から書き出してください。'); };
  if (!value || typeof value !== 'object') return fail();
  const x = value as Record<string, unknown>;
  if (x.format !== 'cockpit-transcript-review' || x.version !== 2 || typeof x.sourceName !== 'string' || x.sourceName.length > 512 || typeof x.reviewedAt !== 'string' || !Number.isFinite(Date.parse(x.reviewedAt)) || !Array.isArray(x.segments) || !x.segments.length || x.segments.length > 10000) return fail();
  const recognition = x.recognition as Record<string, unknown> | undefined;
  if (!recognition || recognition.mode !== "accurate" || recognition.model !== "Systran/faster-whisper-medium" || recognition.revision !== "08e178d48790749d25932bbc082711ddcfdfbc4f") throw new Error("精密モードの補助ツールから確認済みJSONを書き出してください。");
  let previous = -1;
  const segments = x.segments.map((item: unknown) => {
    if (!item || typeof item !== 'object') return fail();
    const s = item as Record<string, unknown>;
    if (typeof s.start !== 'number' || !Number.isFinite(s.start) || typeof s.end !== 'number' || !Number.isFinite(s.end) || s.start < 0 || s.end < s.start || s.end > 10800 || s.start < previous || typeof s.original !== 'string' || typeof s.text !== 'string' || s.original.length > 20000 || s.text.length > 20000 || s.reviewed !== true) return fail();
    previous = s.start;
    return { start: s.start, end: s.end, original: s.original, text: s.text };
  });
  const importedText = segments.map(s => s.text).join('\n');
  if (!importedText.trim()) return fail();
  return { recognition: { mode: "accurate", model: recognition.model, revision: recognition.revision }, sourceName: x.sourceName, reviewedAt: x.reviewedAt, segments, originalText: segments.map(s => s.original).join('\n'), importedText };
}

/** Shared by recording UI and integration tests; preserves business fields. */
export function applyTranscriptImport(c: CaseRecord, id: string, name: string, text: string, review?: TranscriptReview) {
  const target = c.recordings?.find(r => r.id === id);
  if (!target) throw new Error("取り込み先の録音が見つかりません。");
  delete target.transcription;
  target.transcriptReview = review;
  target.transcriptName = name;
  target.transcript = text;
  target.transcriptAt = new Date().toISOString();
}
