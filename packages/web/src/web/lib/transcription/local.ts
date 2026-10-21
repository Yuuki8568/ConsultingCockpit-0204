import { validateMedia, windows } from './limits';
import { fingerprint, type TranscriptionCheckpoint } from './checkpoint';
import { openAudio } from './decode';

export interface ResumeOptions {
  checkpoint?: TranscriptionCheckpoint;
  text?: string;
  save?: (text: string, checkpoint: TranscriptionCheckpoint) => Promise<void>;
}
/** One model instance, one bounded PCM window in flight. No total-job timeout. */
export async function transcribeLocal(blob: Blob, seconds: number | undefined, signal: AbortSignal, progress: (text: string) => void, options: ResumeOptions = {}): Promise<string> {
  validateMedia(blob.size, seconds);
  signal.throwIfAborted();
  if (typeof Worker === 'undefined' || typeof OfflineAudioContext === 'undefined')
    throw new Error('このブラウザは端末内文字起こしに対応していません。PCのChromeでお試しください。');
  progress('原本を確認中…（大容量ファイルは時間がかかります）');
  const hash = await fingerprint(blob, signal);
  const previous = options.checkpoint;
  if (previous && (previous.version !== 1 || previous.fingerprint !== hash)) throw new Error('再開するには前回と同じ原本を選んでください。');
  const audio = await openAudio(blob, signal);
  let worker: Worker | undefined;
  let text = previous ? options.text ?? '' : '';
  const resume = previous?.completedSeconds ?? 0;
  let wake: WakeLockSentinel | undefined;
  try {
    if (previous && Math.abs(previous.totalSeconds - audio.duration) > 0.1) throw new Error('原本の再生時間が一致しません。');
    // Best effort only: mobile/background tabs may still pause. Every finished minute is saved.
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
    for (const part of windows(audio.duration, resume)) {
      signal.throwIfAborted();
      const label = `${Math.floor(part.start / 60)} / ${Math.ceil(audio.duration / 60)}分`;
      progress(`音声を読み込み中… ${label}`);
      const pcm = await audio.read(part.from, part.to);
      signal.throwIfAborted();
      let energy = 0;
      for (const value of pcm) energy += value * value;
      let chunk = '';
      // Only skip near-digital silence, not ordinary quiet speech.
      if (energy / pcm.length > 1e-8) {
        worker ??= new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
        const activeWorker = worker;
        progress(`端末内で文字起こし中… ${label}（画面を開いたままお待ちください）`);
        chunk = await new Promise<string>((resolve, reject) => {
          const finish = (error?: Error, value = '') => {
            clearTimeout(timer); signal.removeEventListener('abort', abort);
            activeWorker.onmessage = null; activeWorker.onerror = null;
            if (error) reject(error); else resolve(value);
          };
          const abort = () => finish(new DOMException('中止しました', 'AbortError'));
          const timer = setTimeout(() => finish(new Error('この区間の処理が停止しました。保存済みの位置から再開できます。')), 20 * 60 * 1000);
          signal.addEventListener('abort', abort, { once: true });
          activeWorker.onerror = () => finish(new Error('認識処理に失敗しました。保存済みの位置から再開してください。'));
          activeWorker.onmessage = ({ data }) => {
            if (signal.aborted) return;
            if (data.type === 'progress') progress(`${data.text} (${label})`);
            if (data.type === 'done') finish(undefined, data.text);
            if (data.type === 'error') finish(new Error(data.code === 'repetition'
              ? '認識結果に不自然な繰り返しが残るため、この区間は保存せず停止しました。保存済みの文章を確認し、音声を整えて再度お試しください。'
              : '認識モデルの取得または処理に失敗しました。ネット接続と端末の空きを確認して再開してください。'));
          };
          activeWorker.postMessage({ pcm, keepStart: part.start - part.from, keepEnd: part.end - part.from }, [pcm.buffer]);
        });
      } else pcm.fill(0);
      signal.throwIfAborted();
      text = [text, chunk].filter(Boolean).join('\n');
      const checkpoint: TranscriptionCheckpoint = { version: 1, fingerprint: hash, completedSeconds: part.end, totalSeconds: audio.duration };
      await options.save?.(text, checkpoint);
      signal.throwIfAborted();
      progress(`保存済み ${Math.ceil(part.end / 60)} / ${Math.ceil(audio.duration / 60)}分`);
    }
    return text;
  } finally { worker?.terminate(); audio.dispose(); await wake?.release().catch(() => {}); }
}
