import type { CaseRecord } from "../../domain/types";
const BASE = "http://127.0.0.1:8765";
const MODEL = "Systran/faster-whisper-medium";
const REVISION = "08e178d48790749d25932bbc082711ddcfdfbc4f";
export type LocalTranscript = {
  model: string; revision: string; sourceKind: "video" | "audio";
  sourceName: string; durationSeconds: number;
  segments: { start: number; end: number; text: string }[];
};
async function request(path: string, key: string, options: RequestInit = {}) {
  const init: RequestInit & { targetAddressSpace: string } = {
    ...options, targetAddressSpace: "loopback", credentials: "omit", redirect: "error",
    headers: { ...options.headers, Authorization: `Bearer ${key}` },
  };
  const response = await fetch(BASE + path, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `端末内接続エラー (${response.status})`);
  return data;
}
export async function connectLocal(key: string, signal?: AbortSignal) {
  const data = await request("/health", key, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (data.protocol !== 1 || data.mode !== "accurate") throw new Error("精密ツールを更新してください。");
}
export function validateLocalTranscript(data: unknown): LocalTranscript {
  const x = data as LocalTranscript;
  if (!x || x.model !== MODEL || x.revision !== REVISION || !["audio", "video"].includes(x.sourceKind) || typeof x.sourceName !== "string" || !Number.isFinite(x.durationSeconds) || x.durationSeconds <= 0 || x.durationSeconds > 10800 || !Array.isArray(x.segments) || x.segments.length > 10000) throw new Error("精密処理の結果が正しくありません。");
  let previous = 0, length = 0;
  for (const s of x.segments) {
    if (!s || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < previous || s.end < s.start || s.end > x.durationSeconds || typeof s.text !== "string" || s.text.length > 20000) throw new Error("認識区間が正しくありません。");
    previous = s.start; length += s.text.length;
  }
  if (length > 1000000) throw new Error("文字起こし結果が大きすぎます。");
  // Keep only provenance and text, never host paths, tokens or log output.
  return { model: x.model, revision: x.revision, sourceKind: x.sourceKind, sourceName: x.sourceName, durationSeconds: x.durationSeconds, segments: x.segments.map(s => ({start:s.start,end:s.end,text:s.text})) };
}
export function applyLocalTranscript(c: CaseRecord, id: string, data: LocalTranscript) {
  const result = validateLocalTranscript(data);
  const recording = c.recordings?.find(r => r.id === id);
  if (!recording) throw new Error("保存先の録音がありません。");
  if (recording.transcript || recording.transcriptReview) throw new Error("編集済みの文字起こしを保護しました。補助ツールの結果を手動で取り込んでください。");
  recording.localRecognition = result;
  recording.transcript = result.segments.map(s => s.text.trim()).join("\n");
  recording.transcriptName = "精密文字起こし（未確認）";
  recording.transcriptAt = new Date().toISOString();
}
export async function transcribeLocal(file: File, key: string, signal: AbortSignal, progress: (message: string) => void) {
  let id: string | undefined;
  const cancel = () => { if (id) void request(`/jobs/${id}`, key, { method: "DELETE", signal: AbortSignal.timeout(5000) }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    progress("端末内ツールにファイルを渡しています…");
    const job = await request("/jobs", key, { method: "POST", body: file, signal, headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) } });
    if (typeof job.id !== "string" || !/^[a-f0-9]{32}$/.test(job.id)) throw new Error("処理IDが正しくありません。");
    id = job.id;
    if (signal.aborted) { cancel(); signal.throwIfAborted(); }
    while (true) {
      const status = await request(`/jobs/${id}`, key, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
      if (status.status === "done") return validateLocalTranscript(status);
      if (status.status === "error" || status.status === "cancelled") throw new Error(status.error || "文字起こしを中止しました。");
      progress(status.stage === "transcribing" ? `精密文字起こし中: ${Math.floor(status.processedSeconds || 0)} / ${Math.ceil(status.durationSeconds || 0)}秒` : "音声を準備しています（動画はWAVを抽出）…");
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1500);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  } finally { signal.removeEventListener("abort", cancel); }
}
