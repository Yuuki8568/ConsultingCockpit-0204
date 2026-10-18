import { SAMPLE_RATE, validateMedia } from './limits';

/** This worker receives PCM, never a remote audio URL. Cancel destroys its memory and model. */
export async function transcribeLocal(blob: Blob, seconds: number | undefined, signal: AbortSignal, progress: (text: string) => void): Promise<string> {
  validateMedia(blob.size, seconds);
  signal.throwIfAborted();
  if (typeof Worker === 'undefined' || typeof OfflineAudioContext === 'undefined')
    throw new Error('このブラウザは端末内文字起こしに対応していません。PCのChromeでお試しください。');
  progress('音声を読み込み中…');
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  let decoded: AudioBuffer;
  try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error('音声を読み込めませんでした。音声付きMP3・WAVなどに変換してお試しください。'); }
  signal.throwIfAborted();
  validateMedia(blob.size, decoded.duration);
  const pcm = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < pcm.length; i++) pcm[i] += data[i] / decoded.numberOfChannels;
    data.fill(0);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    const finish = (err?: Error, text?: string) => {
      signal.removeEventListener('abort', abort);
      clearTimeout(timer);
      worker.terminate();
      if (err) reject(err); else resolve(text ?? '');
    };
    const abort = () => finish(new DOMException('中止しました', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('処理時間の上限に達しました。短いファイルで再試行してください。')), 30 * 60 * 1000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('端末内の認識処理に失敗しました。メモリの空きを確認し、短いファイルで再試行してください。'));
    worker.onmessage = ({ data }) => {
      if (signal.aborted) return;
      if (data.type === 'progress') progress(data.text);
      if (data.type === 'done') finish(undefined, data.text);
      if (data.type === 'error') finish(new Error('認識モデルを読み込めないか、端末の処理に失敗しました。ネット接続を確認し、短いファイルで再試行してください。'));
    };
    worker.postMessage({ pcm }, [pcm.buffer]);
  });
}
