import { env, pipeline } from '@huggingface/transformers';
import { MODEL, MODEL_REVISION } from './limits';
import { modelRequest } from './network-policy';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.backends.onnx.wasm!.wasmPaths = `${self.location.origin}/transcription-runtime/`;

// Inference has no upload channel. Only body-free GETs are permitted; external model downloads omit credentials.
const originalFetch = self.fetch.bind(self);
(self as unknown as { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  try { const request = modelRequest(input, init, self.location.origin); return originalFetch(request.url, request.options); }
  catch (e) { return Promise.reject(e); }
};

self.onmessage = async ({ data }: MessageEvent<{ pcm: Float32Array }>) => {
  const pcm = data.pcm;
  try {
    const recognizer = await pipeline('automatic-speech-recognition', MODEL, {
      revision: MODEL_REVISION, device: 'wasm', dtype: 'q8',
      progress_callback: (p) => {
        const text = p.status === 'progress' ? `認識モデルをダウンロード中… ${Math.round(p.progress)}%（${p.file}）` : '認識モデルを準備中…';
        self.postMessage({ type: 'progress', text });
      },
    });
    self.postMessage({ type: 'progress', text: '端末内で日本語を文字起こし中…（数分かかる場合があります）' });
    const result = await recognizer(pcm, { language: 'japanese', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(result) ? result.map(r => r.text).join('\n') : result.text).trim();
    self.postMessage({ type: 'done', text });
    await recognizer.dispose();
  } catch {
    self.postMessage({ type: 'error' });
  } finally { pcm.fill(0); }
};
