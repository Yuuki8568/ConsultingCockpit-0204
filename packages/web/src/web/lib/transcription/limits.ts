export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
export const MAX_MEDIA_SECONDS = 600;
export const SAMPLE_RATE = 16000;
export const MODEL = 'onnx-community/whisper-tiny';
export const MODEL_REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';
export function validateMedia(size: number, seconds?: number) {
  if (size > MAX_MEDIA_BYTES) throw new Error('端末内の文字起こしは64MB以下に対応しています。短く分割してください。');
  if (!seconds || !Number.isFinite(seconds) || seconds > MAX_MEDIA_SECONDS)
    throw new Error('端末内の文字起こしは再生時間を確認できる10分以内のファイルに対応しています。短く分割してください。');
}
