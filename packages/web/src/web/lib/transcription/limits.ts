export const MAX_MEDIA_BYTES = 4 * 1024 * 1024 * 1024;
export const LOCAL_MEDIA_BYTES = 64 * 1024 * 1024;
export const MAX_MEDIA_SECONDS = 3 * 60 * 60;
export const WINDOW_SECONDS = 60;
export const CONTEXT_SECONDS = 2;
export const SAMPLE_RATE = 16000;
export const MODEL = 'onnx-community/whisper-tiny';
export const MODEL_REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';
export function validateMedia(size: number, seconds?: number) {
  if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) throw new Error('文字起こしは4GB以下のファイルに対応しています。音声だけを書き出すか、ファイルを分割してください。');
  if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_MEDIA_SECONDS))
    throw new Error('文字起こしは最大3時間に対応しています。長い場合は分割してください。');
}
export function* windows(duration: number, resume = 0) {
  validateMedia(1, duration);
  if (!Number.isFinite(resume) || resume < 0 || resume > duration || (resume !== duration && resume % WINDOW_SECONDS !== 0)) throw new Error('再開位置が不正です');
  for (let start = resume; start < duration; start += WINDOW_SECONDS) {
    const end = Math.min(start + WINDOW_SECONDS, duration);
    yield { start, end, from: Math.max(0, start - CONTEXT_SECONDS), to: Math.min(duration, end + CONTEXT_SECONDS) };
  }
}
