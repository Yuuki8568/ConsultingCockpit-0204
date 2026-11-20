import { MODEL, MODEL_REVISION } from './limits';
export function modelRequest(input: RequestInfo | URL, init: RequestInit | undefined, origin: string): { url: string; options: RequestInit } {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const modelPath = `/${MODEL}/resolve/${MODEL_REVISION}/`;
  const allowed = (url.origin === 'https://huggingface.co' && url.pathname.startsWith(modelPath)) ||
    (url.origin === origin && url.pathname.startsWith('/transcription-runtime/'));
  if (!allowed || req.method !== 'GET' || req.body) throw new Error('Network request denied');
  return { url: req.url, options: { method: 'GET', credentials: url.origin === origin ? 'same-origin' : 'omit', referrerPolicy: 'no-referrer' } };
}
