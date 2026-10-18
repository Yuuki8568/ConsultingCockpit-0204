import { test, expect, afterEach } from 'bun:test';
import { MAX_MEDIA_BYTES, MODEL, MODEL_REVISION, validateMedia } from '../src/web/lib/transcription/limits';
import { modelRequest } from '../src/web/lib/transcription/network-policy';
import { transcribeLocal } from '../src/web/lib/transcription/local';

test('media bounds reject unknown duration and oversized/long files before decode', () => {
  expect(() => validateMedia(MAX_MEDIA_BYTES, 600)).not.toThrow();
  for (const duration of [undefined, NaN, Infinity, 0, 601]) expect(() => validateMedia(1, duration)).toThrow();
  expect(() => validateMedia(MAX_MEDIA_BYTES + 1, 1)).toThrow();
});
test('inference networking permits pinned downloads only and omits credentials', () => {
  const url = `https://huggingface.co/${MODEL}/resolve/${MODEL_REVISION}/config.json`;
  const req = modelRequest(url, undefined, 'https://app.test');
  expect(req.options.credentials).toBe('omit');
  expect(req.options.referrerPolicy).toBe('no-referrer');
  expect(modelRequest('https://app.test/transcription-runtime/runtime.wasm', undefined, 'https://app.test').options.credentials).toBe('same-origin');
  expect(() => modelRequest(url, { method: 'POST', body: 'audio' }, 'https://app.test')).toThrow();
  for (const bad of ['https://app.test/api/upload', 'https://evil.test/model', url.replace(MODEL_REVISION, 'main'), url.replace('huggingface.co', 'huggingface.co.evil.test')])
    expect(() => modelRequest(bad, undefined, 'https://app.test')).toThrow();
});
const originals = { Worker: globalThis.Worker, OfflineAudioContext: globalThis.OfflineAudioContext };
afterEach(() => { Object.assign(globalThis, originals); });
function fakeBrowser(mode: 'done' | 'pending') {
  let terminated = 0;
  class MockContext {
    async decodeAudioData() { return { duration: 1, length: 16000, numberOfChannels: 1, getChannelData: () => new Float32Array(16000) }; }
  }
  class MockWorker {
    onmessage?: (event: { data: unknown }) => void;
    postMessage() { if (mode === 'done') queueMicrotask(() => this.onmessage?.({ data: { type: 'done', text: 'テストの音声です' } })); }
    terminate() { terminated++; }
  }
  Object.assign(globalThis, { Worker: MockWorker, OfflineAudioContext: MockContext });
  return () => terminated;
}
test('successful inference releases the worker and returns its transcript', async () => {
  const ended = fakeBrowser('done');
  expect(await transcribeLocal(new Blob(['audio']), 1, new AbortController().signal, () => {})).toBe('テストの音声です');
  expect(ended()).toBe(1);
});
test('cancel destroys a running worker without saving a partial result', async () => {
  const ended = fakeBrowser('pending'); const c = new AbortController();
  const pending = transcribeLocal(new Blob(['audio']), 1, c.signal, () => {});
  await new Promise(r => setTimeout(r, 10)); c.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(ended()).toBe(1);
});
