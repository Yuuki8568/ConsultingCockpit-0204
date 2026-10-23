/**
 * ⑤商談後メモに置く「面談の録画・録音」パネル。
 * - ドラッグ&ドロップ（またはクリックで選択）で映像・音声ファイルを取り込む
 * - 本体はこの端末の IndexedDB に暗号化して置く（サーバーには送らない）
 * - 文字起こしファイル（vtt/srt/sbv/txt）または貼り付けを取り込み、
 *   その内容から ⑤・② の設問の下書きを作るためのプロンプトを生成する
 * - AIの出力を貼り戻すと、空欄の項目にだけ下書きを入れる（判断は人が行う）
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import {
  Area,
  Badge,
  ConfirmButton,
  CopyButton,
  Empty,
  Field,
  Modal,
  Note,
  Panel,
} from "../../components/kit";
import { jpDate, newId } from "../../domain/logic/util";
import {
  buildTranscriptPrompt,
  formatBytes,
  formatDuration,
  isMediaFile,
  isTranscriptFile,
  mediaKind,
  MEDIA_ACCEPT,
  MEMO_AUTOFILL_FIELDS,
  parseAutofillOutput,
  parseTranscript,
  TRANSCRIPT_ACCEPT,
  type AutofillEntry,
} from "../../domain/logic/recording";
import { LOCAL_MEDIA_BYTES, validateMedia } from "../../lib/transcription/limits";
import { parseTranscriptReview, MAX_REVIEW_BYTES, type TranscriptReview } from "../../lib/transcription/review";
import { transcribeLocal } from "../../lib/transcription/local";
import type { CaseRecord, RecordingMeta } from "../../domain/types";

/** 元ファイルから再生時間だけを拾う（本体は暗号化前に読まない） */
function probeDuration(blob: Blob, kind: "video" | "audio"): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(kind === "video" ? "video" : "audio");
    const timer = setTimeout(() => finish(undefined), 15000);
    function finish(v: number | undefined) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(v);
    }
    el.onloadedmetadata = () => finish(isFinite(el.duration) ? el.duration : undefined);
    el.onerror = () => finish(undefined);
    el.src = url;
  });
}

type PlayerState = { url?: string; busy?: boolean; err?: string };

export function CaseRecordings() {
  const { c, patch } = useCurrentCase();
  const { phase, saveMediaBlob, readMediaBlob, deleteMediaBlob } = useVault();
  const [over, setOver] = useState(false);
  const [importing, setImporting] = useState<{ name: string; pct: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const [transcriptFor, setTranscriptFor] = useState<string | null>(null);
  const [autofillFor, setAutofillFor] = useState<string | null>(null);
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [recognition, setRecognition] = useState<{ id: string; text: string } | null>(null);
  const alive = useRef(true);
  const stopImport = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const current = useRef({ id: c?.id, phase });
  current.current = { id: c?.id, phase };
  useEffect(() => {
    alive.current = true;
    setRecognition(null);
    return () => { alive.current = false; stopImport.current = true; controller.current?.abort(); controller.current = null; };
  }, [c?.id, phase]);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const resumeId = useRef<string | null>(null);
  const importingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(
    () => () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  if (!c) return null;
  const list = c.recordings ?? [];

  const rememberUrl = (u: string) => {
    urlsRef.current.push(u);
  };

  async function recognize(r: RecordingMeta, source?: Blob) {
    if (controller.current) return;
    const control = new AbortController();
    controller.current = control;
    const caseId = c?.id;
    const valid = () => alive.current && !control.signal.aborted && current.current.id === caseId && current.current.phase === "unlocked";
    let expected = r.transcript;
    setRecognition({ id: r.id, text: "準備中…" });
    try {
      if (!source && (r.sourceOnly || r.size > LOCAL_MEDIA_BYTES)) throw new Error("原本を選び直して文字起こしを再開してください。");
      if (source && source.size !== r.size) throw new Error("前回と同じ原本を選んでください。");
      const blob = source ?? await readMediaBlob(r.id, r.mimeType);
      if (!valid()) return;
      const seconds = r.durationSec ?? await probeDuration(blob, r.kind);
      const text = await transcribeLocal(blob, seconds, control.signal, (text) => {
        if (valid()) setRecognition({ id: r.id, text });
      }, { checkpoint: r.transcription, text: r.transcript, save: async (text, checkpoint) => {
        if (!valid()) return;
        await patch(x => {
          if (!valid()) return;
          const target = x.recordings?.find(z => z.id === r.id);
          if (!target || target.transcript !== expected) { control.abort(); return; }
          target.transcript = text;
          target.transcription = checkpoint;
          target.transcriptName = checkpoint.completedSeconds >= checkpoint.totalSeconds
            ? "端末内文字起こし（日本語・要確認）" : "端末内文字起こし（途中まで・再開できます）";
          delete target.transcriptReview;
          target.transcriptAt = new Date().toISOString();
          expected = text;
        });
      } });
      if (valid() && !text) setImportError(`${r.name}: 声を認識できませんでした。音声と録音の音量を確認してください。`);
    } catch (e) {
      if (valid()) setImportError(`${r.name}: ${e instanceof Error ? e.message : "文字起こしに失敗しました"}`);
    } finally {
      if (controller.current === control) {
        controller.current = null;
        setRecognition(null);
      }
    }
  }

  async function importFiles(files: File[]) {
    if (importingRef.current || controller.current) return;
    importingRef.current = true;
    const caseId = c?.id;
    stopImport.current = false;
    setImportError(null);
    for (const f of files) {
      if (!alive.current || stopImport.current || current.current.id !== caseId || current.current.phase !== "unlocked") break;
      if (!isMediaFile(f.name, f.type)) {
        setImportError(`対応していない形式です: ${f.name}（映像・音声ファイルを入れてください）`);
        continue;
      }
      const id = newId("rec");
      const kind = mediaKind(f.name, f.type);
      setImporting({ name: f.name, pct: 0 });
      try {
        validateMedia(f.size);
        const durationSec = await probeDuration(f, kind);
        validateMedia(f.size, durationSec);
        const sourceOnly = f.size > LOCAL_MEDIA_BYTES;
        const chunkCount = sourceOnly ? 0 : await saveMediaBlob(id, f, (d, t) =>
          setImporting({ name: f.name, pct: t > 0 ? Math.round((d / t) * 100) : 0 }),
        );
        const meta: RecordingMeta = {
          id,
          name: f.name,
          size: f.size,
          mimeType: f.type || (kind === "video" ? "video/mp4" : "audio/mpeg"),
          kind,
          addedAt: new Date().toISOString(),
          durationSec,
          chunkCount,
          sourceOnly,
          note: "",
          consentAt: "",
          transcriptName: "",
          transcript: "",
          transcriptAt: "",
        };
        if (!alive.current || stopImport.current || current.current.id !== caseId || current.current.phase !== "unlocked") {
          await deleteMediaBlob(id).catch(() => {});
          break;
        }
        await patch((x) => {
          x.recordings = x.recordings ?? [];
          x.recordings.push(meta);
        });
        if (autoTranscribe) await recognize(meta, f);
      } catch (e) {
        await deleteMediaBlob(id).catch(() => {});
        setImportError(
          `取り込めませんでした: ${f.name}（${e instanceof Error ? e.message : "不明なエラー"}）`,
        );
      }
    }
    importingRef.current = false;
    setImporting(null);
  }

  async function openPlayer(r: RecordingMeta) {
    if (playerId === r.id) {
      setPlayerId(null);
      return;
    }
    setPlayerId(r.id);
    if (players[r.id]?.url || players[r.id]?.busy) return;
    setPlayers((p) => ({ ...p, [r.id]: { busy: true } }));
    try {
      const blob = await readMediaBlob(r.id, r.mimeType);
      const url = URL.createObjectURL(blob);
      rememberUrl(url);
      setPlayers((p) => ({ ...p, [r.id]: { url } }));
    } catch (e) {
      setPlayers((p) => ({
        ...p,
        [r.id]: { err: e instanceof Error ? e.message : "読み込めませんでした" },
      }));
    }
  }

  async function download(r: RecordingMeta) {
    const cached = players[r.id]?.url;
    if (cached) {
      const a = document.createElement("a");
      a.href = cached;
      a.download = r.name;
      a.click();
      return;
    }
    setPlayers((p) => ({ ...p, [r.id]: { busy: true } }));
    try {
      const blob = await readMediaBlob(r.id, r.mimeType);
      const url = URL.createObjectURL(blob);
      rememberUrl(url);
      setPlayers((p) => ({ ...p, [r.id]: { url } }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.name;
      a.click();
    } catch (e) {
      setPlayers((p) => ({
        ...p,
        [r.id]: { err: e instanceof Error ? e.message : "読み込めませんでした" },
      }));
    }
  }

  function removeRecording(r: RecordingMeta) {
    if (recognition?.id === r.id) controller.current?.abort();
    void (async () => {
      await patch((x) => {
        x.recordings = (x.recordings ?? []).filter((z) => z.id !== r.id);
      });
      await deleteMediaBlob(r.id).catch(() => {});
    })();
  }

  const setMeta = (id: string, k: keyof RecordingMeta) => (v: string) =>
    void patch((x) => {
      const t = x.recordings?.find((z) => z.id === id);
      if (t) (t as unknown as Record<string, string>)[k] = v;
    });

  return (
    <Panel
      title="面談の録画・録音"
      note="Google Meet などの録画・録音をドラッグ&ドロップで取り込みます。64MB以下の原本は暗号化して端末内に保存します。大容量の原本は保存せず、選択したファイルから直接読みます。音声・動画はサーバーに送りません。日本語の音声を端末内で文字起こしし、設問の下書きに使えます。動画は音声部分を認識します（声とBGMの分離機能ではありません）。"
    >
      <Note tone="warn">
        録画・録音は事前に相手の同意を得てください。同意を得た日を各ファイルに記録できます。
      </Note>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={autoTranscribe} onChange={e => setAutoTranscribe(e.target.checked)} />
        取り込み後に端末内で自動文字起こし（日本語）
      </label>
      <p className="mt-2 text-xs text-paper-faint">初回は約252MBの認識モデルをダウンロードします。音声・動画は送信しません。結果の文章は案件データとして暗号化して同期します。1時間の面談を想定し、最大3時間・4GBまで受け付けます。1分ごとに結果を保存し、中断後に再開できます。長時間処理はPC推奨です。精度を優先するため、処理に録音時間以上かかる場合があります。処理中は画面を開き、原本は別途保管してください。誤認識があるため内容を確認してください。</p>
      {recognition && <div className="mt-2" role="status">
        <p>{recognition.text}</p>
        <button className="btn btn-sm" onClick={() => { stopImport.current = true; controller.current?.abort(); }}>文字起こしを中止</button>
      </div>}
      <input ref={resumeInputRef} type="file" accept={MEDIA_ACCEPT} className="hidden" onChange={e => {
        const file = e.target.files?.[0]; e.target.value = "";
        const rec = list.find(r => r.id === resumeId.current);
        if (file && rec) { setImportError(null); void recognize(rec, file); }
      }} />
      {/* 取り込みゾーン */}
      <div
        className={`mt-3 rounded-sm border border-dashed px-4 py-6 text-center transition-colors ${
          over ? "border-brand bg-brand-soft" : "border-line bg-ink-850"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void importFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => { if (!importing && !recognition) inputRef.current?.click(); }}
        role="button"
      >
        <input
          ref={inputRef}
          type="file"
          disabled={!!importing || !!recognition}
          accept={MEDIA_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            e.target.value = "";
            void importFiles(fs);
          }}
        />
        {importing ? (
          <p className="text-[13px] text-paper">
            取り込み中: {importing.name}（{importing.pct}%）
            <span className="mt-1 block text-[11px] text-paper-faint">
              大きなファイルは暗号化に時間がかかります。この画面を閉じないでください。
            </span>
          </p>
        ) : (
          <p className="text-[13px] text-paper-dim">
            ここに映像・音声ファイルをドロップ（またはクリックして選択）
            <span className="mt-1 block text-[11px] text-paper-faint">
              mp4 / webm / mov / mp3 / m4a / wav など。最大3時間・4GBまで。
            </span>
          </p>
        )}
      </div>
      {importError && (
        <div className="mt-2">
          <Note tone="alert">{importError}</Note>
        </div>
      )}

      {/* 一覧 */}
      <div className="mt-4 space-y-2.5">
        {list.length === 0 && !importing && (
          <Empty>まだありません。面談を録画したら、ここにファイルを入れてください。</Empty>
        )}
        {list.map((r) => {
          const ps = players[r.id] ?? {};
          const open = playerId === r.id;
          return (
            <div key={r.id} className="rounded-sm border border-line bg-ink-850 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={r.kind === "video" ? "#3B6E8F" : "#4A7C59"}>
                  {r.kind === "video" ? "映像" : "音声"}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] text-paper">{r.name}</span>
                <span className="num text-[11px] text-paper-faint">
                  {formatBytes(r.size)}
                  {formatDuration(r.durationSec) ? `・${formatDuration(r.durationSec)}` : ""}
                </span>
                <span className="text-[11px] text-paper-faint">{jpDate(r.addedAt)}</span>
              </div>

              <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_180px]">
                <Field
                  label="メモ"
                  value={r.note}
                  onChange={setMeta(r.id, "note")}
                  placeholder="例: 初回の無料相談（45分）"
                />
                <Field
                  label="録画の同意を得た日"
                  type="date"
                  value={r.consentAt}
                  onChange={setMeta(r.id, "consentAt")}
                  hint="空欄は未取得です"
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button className="btn btn-sm" onClick={() => void openPlayer(r)} disabled={ps.busy || r.sourceOnly}>
                  {ps.busy ? "読み込み中…" : open ? "閉じる" : "再生"}
                </button>
                <button className="btn btn-sm" onClick={() => void download(r)} disabled={ps.busy || r.sourceOnly}>
                  ダウンロード
                </button>
                <button className="btn btn-sm" onClick={() => setTranscriptFor(r.id)}>
                  {r.transcript ? "文字起こしを見る・差し替える" : "文字起こしを取り込む"}
                </button>
                {(!r.transcript || (r.transcription && r.transcription.completedSeconds < r.transcription.totalSeconds)) && <button className="btn btn-sm" disabled={!!recognition || !!importing}
                  onClick={() => {
                    setImportError(null);
                    if (r.sourceOnly || r.size > LOCAL_MEDIA_BYTES) { resumeId.current = r.id; resumeInputRef.current?.click(); }
                    else void recognize(r);
                  }}>{r.transcription ? "続きから文字起こし" : "端末内で文字起こし"}{r.sourceOnly ? "（原本を選択）" : ""}</button>}
                {r.transcription && <span className="text-xs text-paper-faint">保存済み {Math.ceil(r.transcription.completedSeconds / 60)} / {Math.ceil(r.transcription.totalSeconds / 60)}分</span>}
                {r.sourceOnly && <span className="text-xs text-paper-faint">原本はアプリに保管されません。再開時は同じ原本が必要です。</span>}
                {r.transcript && (
                  <button className="btn btn-primary btn-sm" onClick={() => setAutofillFor(r.id)}>
                    設問の下書きを作る
                  </button>
                )}
                <ConfirmButton
                  label="削除"
                  confirmLabel="本当に削除（端末から消えます）"
                  onConfirm={() => removeRecording(r)}
                />
                {r.transcript && (
                  <span className="text-[11px] text-paper-faint">
                    文字起こし {r.transcript.length.toLocaleString("ja-JP")} 字
                  </span>
                )}
              </div>
              {!r.consentAt && (
                <p className="mt-1.5 text-[11px] text-[#C9A961]">
                  録画の同意を得た日が未記入です。面談の冒頭で許可を取り、日付を記録してください。
                </p>
              )}
              {ps.err && (
                <div className="mt-2">
                  <Note tone="alert">{ps.err}</Note>
                </div>
              )}
              {open && ps.url && (
                <div className="mt-2">
                  {r.kind === "video" ? (
                    <video controls className="w-full rounded-sm" src={ps.url} />
                  ) : (
                    <audio controls className="w-full" src={ps.url} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Note tone="info">
        64MB以下の原本はこの端末にだけ保存されます。大容量の原本はアプリには保管されません。バックアップ（JSON）にも含まれないため、原本は別途保管してください。
      </Note>

      {transcriptFor && (
        <TranscriptModal
          rec={list.find((z) => z.id === transcriptFor) ?? null}
          onClose={() => setTranscriptFor(null)}
          onSave={(id, name, text, review) => {
            void patch((x) => {
              const t = x.recordings?.find((z) => z.id === id);
              if (t) {
                delete t.transcription;
                t.transcriptReview = review;
                t.transcriptName = name;
                t.transcript = text;
                t.transcriptAt = new Date().toISOString();
              }
            });
            setTranscriptFor(null);
          }}
        />
      )}
      {autofillFor && (
        <AutofillModal
          c={c}
          rec={list.find((z) => z.id === autofillFor) ?? null}
          onClose={() => setAutofillFor(null)}
        />
      )}
    </Panel>
  );
}

/** 文字起こしの取り込み（ファイルまたは貼り付け） */
export function TranscriptModal({
  rec,
  onClose,
  onSave,
}: {
  rec: RecordingMeta | null;
  onClose: () => void;
  onSave: (id: string, name: string, text: string, review?: TranscriptReview) => void;
}) {
  const [text, setText] = useState(rec?.transcript ?? "");
  const [name, setName] = useState(rec?.transcriptName ?? "");
  const [review, setReview] = useState<TranscriptReview | undefined>(rec?.transcriptReview);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const readId = useRef(0);
  useEffect(() => () => { readId.current++; }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!rec) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`文字起こしの取り込み — ${rec.name}`}
      wide
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            やめる
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!text.trim() || !!error || (!!review && !confirmed)}
            onClick={() => onSave(rec.id, name, text.trim(), review)}
          >
            取り込む
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[12px] leading-relaxed text-paper-dim">
          端末内補助ツールの確認済みJSON、字幕、テキストを取り込みます。取り込む前に対象の録音と内容を確認してください。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept={TRANSCRIPT_ACCEPT + ",.json"}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const id = ++readId.current;
            setError("");
            if (f.size > MAX_REVIEW_BYTES) { setError("2MB以下の文字起こしファイルを選択してください。"); return; }
            if (!isTranscriptFile(f.name) && !f.name.toLowerCase().endsWith(".json")) return;
            void f.text().then((raw) => {
              if (readId.current !== id) return;
              const parsed = f.name.toLowerCase().endsWith(".json") ? parseTranscriptReview(raw) : undefined;
              setText(parsed ? parsed.importedText : parseTranscript(raw, f.name));
              setReview(parsed); setConfirmed(false); setName(f.name);
            }).catch((err: unknown) => {
              if (readId.current === id) setError(err instanceof Error ? err.message : "ファイルを読み込めませんでした。");
            });
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            ファイルから取り込む（確認済みJSON / 字幕 / txt）
          </button>
          {name && <span className="text-[11px] text-paper-faint">{name}</span>}
          {text && (
            <span className="num text-[11px] text-paper-faint">
              {text.length.toLocaleString("ja-JP")} 字
            </span>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {review && <div className="space-y-2 text-sm">
          <p>元の録音名: {review.sourceName} ／ {review.segments.length}区間を確認済み</p>
          <details><summary>補正前の認識文を確認</summary><pre className="whitespace-pre-wrap text-xs">{review.originalText}</pre></details>
          <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />この案件の「{rec.name}」に対応する内容であることを確認しました</label>
          <p className="text-xs">原文も案件内に保存します。予算・日付・決定事項への反映は、設問の下書き画面で別途確認してください。</p>
        </div>}
        <Area
          label="文字起こし本文（直接貼り付けもできます）"
          value={text}
          onChange={(value) => { readId.current++; setText(value); setConfirmed(false); }}
          rows={14}
        />
      </div>
    </Modal>
  );
}

/** 文字起こし → ⑤・② 下書き（プロンプト生成と貼り戻しの取り込み） */
function AutofillModal({
  c,
  rec,
  onClose,
}: {
  c: CaseRecord;
  rec: RecordingMeta | null;
  onClose: () => void;
}) {
  const { patch } = useCurrentCase();
  const [pasted, setPasted] = useState("");
  const [entries, setEntries] = useState<AutofillEntry[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [skipped, setSkipped] = useState<string[]>([]);
  const prompt = useMemo(
    () => (rec ? buildTranscriptPrompt(c, rec.transcript) : ""),
    [c, rec],
  );
  if (!rec) return null;

  const questionLabel = (qid: string): string | null => {
    for (const qs of Object.values(c.sheet?.questions ?? {})) {
      const q = qs.find((z) => z.id === qid);
      if (q) return `②${q.q}`;
    }
    return null;
  };

  const resolve = (
    e: AutofillEntry,
  ): { label: string; current: string; apply: (x: CaseRecord, v: string) => void } | null => {
    if (e.key.startsWith("memo:")) {
      const k = e.key.slice(5);
      const f = MEMO_AUTOFILL_FIELDS.find(([kk]) => kk === k);
      if (!f) return null;
      return {
        label: f[1],
        current: c.memo[k] ?? "",
        apply: (x, v) => void (x.memo[k] = v),
      };
    }
    const qid = e.key.slice(7);
    const label = questionLabel(qid);
    if (!label) return null;
    return {
      label,
      current: c.answers[qid] ?? "",
      apply: (x, v) => void (x.answers[qid] = v),
    };
  };

  const readPasted = () => {
    const found = parseAutofillOutput(pasted);
    const ok: AutofillEntry[] = [];
    const ng: string[] = [];
    for (const e of found) {
      if (resolve(e)) ok.push(e);
      else ng.push(e.key);
    }
    const init: Record<string, boolean> = {};
    ok.forEach((e, i) => {
      const r = resolve(e);
      init[String(i)] = r ? !r.current : true; // 空欄だけ既定で入れる。入力済みは既定で入れない
    });
    setEntries(ok);
    setChecked(init);
    setSkipped(ng);
  };

  const applyChecked = () => {
    if (!entries) return;
    void patch((x) => {
      entries.forEach((e, i) => {
        if (!checked[String(i)]) return;
        resolve(e)?.apply(x, e.value);
      });
    });
    onClose();
  };

  const selectedCount = entries
    ? entries.filter((_, i) => checked[String(i)]).length
    : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={`設問の下書きを作る — ${rec.name}`}
      wide
      footer={
        entries ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setEntries(null)}>
              貼り直す
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={selectedCount === 0}
              onClick={applyChecked}
            >
              {selectedCount} 件を取り込む
            </button>
          </>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            閉じる
          </button>
        )
      }
    >
      <div className="space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-paper-dim">
          <li>下のプロンプトをコピーし、お使いのAI（ChatGPT など）に貼ります。</li>
          <li>出てきた結果をそのまま下の欄に貼り、「読み取る」を押します。</li>
          <li>入れたい項目にチェックを付けて取り込みます。すでに入力済みの項目は既定で入れません。</li>
        </ol>
        <div className="flex items-center gap-2">
          <CopyButton text={prompt} label="プロンプトをコピー" className="btn btn-primary btn-sm" />
          <span className="num text-[11px] text-paper-faint">
            文字起こし {rec.transcript.length.toLocaleString("ja-JP")} 字を含みます
          </span>
        </div>

        {entries === null ? (
          <>
            <Area
              label="AIの出力を貼り付け"
              value={pasted}
              onChange={setPasted}
              rows={10}
              placeholder="【memo:summary】… の形式で出てきた結果をそのまま貼ってください。"
            />
            <button className="btn btn-sm" disabled={!pasted.trim()} onClick={readPasted}>
              読み取る
            </button>
          </>
        ) : (
          <>
            {entries.length === 0 && (
              <Note tone="alert">
                取り込める項目が見つかりませんでした。【memo:summary】のような見出しの形式になっているか確認してください。
              </Note>
            )}
            {skipped.length > 0 && (
              <Note tone="warn">
                この案件に対応する欄がないため飛ばしました: {skipped.join("、")}
              </Note>
            )}
            <div className="max-h-[380px] space-y-2 overflow-auto">
              {entries.map((e, i) => {
                const r = resolve(e);
                if (!r) return null;
                const hasCurrent = !!r.current;
                return (
                  <label
                    key={i}
                    className="flex cursor-pointer items-start gap-2 rounded-sm border border-line bg-ink-850 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 accent-[#0e7490]"
                      checked={!!checked[String(i)]}
                      onChange={(ev) =>
                        setChecked((s) => ({ ...s, [String(i)]: ev.target.checked }))
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-[12px] text-paper">
                        {r.label}
                        {hasCurrent ? (
                          <Badge color="#C9A961">入力済みを上書き</Badge>
                        ) : (
                          <Badge color="#4A7C59">空欄に入る</Badge>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-paper-faint">
                        {e.value.slice(0, 120)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}
        <Note tone="info">
          下書きは文字起こしを根拠にした案です。取り込んだあと、必ず自分の記憶と照らして直してください。
        </Note>
      </div>
    </Modal>
  );
}
