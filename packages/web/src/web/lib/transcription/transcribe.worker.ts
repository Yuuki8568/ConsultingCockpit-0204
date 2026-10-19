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

let recognizerPromise: ReturnType<typeof createRecognizer> | undefined;
function createRecognizer() {
  return pipeline('automatic-speech-recognition', MODEL, {
    revision: MODEL_REVISION, device: 'wasm', dtype: 'q8',
    progress_callback: (p) => {
      const text = p.status === 'progress' ? `認識モデルをダウンロード中… ${Math.round(p.progress)}%` : '認識モデルを準備中…';
      self.postMessage({ type: 'progress', text });
    },
  });
}
self.onmessage = async ({ data }: MessageEvent<{ pcm: Float32Array; keepStart?: number; keepEnd?: number }>) => {
  const pcm = data.pcm;
  try {
    const recognizer = await (recognizerPromise ??= createRecognizer());
    const result = await recognizer(pcm, { language: 'japanese', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, max_new_tokens: 448 });
    const output = Array.isArray(result) ? result[0] : result;
    // Context on both sides improves boundary recognition; only keep segments belonging to this window.
    const text = data.keepStart === undefined ? output.text : (output.chunks ?? []).filter(chunk => {
      const center = (chunk.timestamp[0] + (chunk.timestamp[1] ?? pcm.length / 16000)) / 2;
      return center >= data.keepStart! && center < data.keepEnd!;
    }).map(chunk => chunk.text).join('');
    self.postMessage({ type: 'done', text: text.trim() });
  } catch { self.postMessage({ type: 'error' }); }
  finally { pcm.fill(0); }
};
