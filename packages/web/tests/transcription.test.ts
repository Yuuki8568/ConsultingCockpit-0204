import { test, expect, afterEach, mock } from 'bun:test';
import { MAX_MEDIA_BYTES, MAX_MEDIA_SECONDS, windows, MODEL, MODEL_REVISION, validateMedia } from '../src/web/lib/transcription/limits';
import { modelRequest } from '../src/web/lib/transcription/network-policy';
import { fingerprint, type TranscriptionCheckpoint } from '../src/web/lib/transcription/checkpoint';

test('media bounds allow 1-3 hours but reject invalid or oversized files', () => {
  for (const seconds of [undefined, 3600, 7200, 10800]) expect(() => validateMedia(MAX_MEDIA_BYTES, seconds)).not.toThrow();
  for (const duration of [NaN, Infinity, 0, 10801]) expect(() => validateMedia(1, duration)).toThrow();
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

let duration = 125;
let disposed = 0;
const reads: [number, number][] = [];
mock.module('../src/web/lib/transcription/decode', () => ({ openAudio: async () => ({
  duration, dispose: () => disposed++, read: async (from: number, to: number) => {
    reads.push([from, to]); return new Float32Array(100).fill(0.1);
  },
}) }));
const { transcribeLocal } = await import('../src/web/lib/transcription/local');
const originals = { Worker: globalThis.Worker, OfflineAudioContext: globalThis.OfflineAudioContext };
afterEach(() => { Object.assign(globalThis, originals); reads.length = 0; disposed = 0; duration = 125; });
function fakeBrowser(mode: 'done' | 'pending' | 'second-error' | 'repetition' = 'done') {
  const stats = { terminated: 0, created: 0, calls: 0 };
  class MockWorker {
    onmessage?: (event: { data: unknown }) => void;
    constructor() { stats.created++; }
    postMessage() {
      stats.calls++;
      if (mode !== 'pending') queueMicrotask(() => this.onmessage?.({ data: mode === 'repetition' ? { type: 'error', code: 'repetition' } : mode === 'second-error' && stats.calls === 2 ? { type: 'error' } : { type: 'done', text: '区間' + stats.calls } }));
    }
    terminate() { stats.terminated++; }
  }
  Object.assign(globalThis, { Worker: MockWorker, OfflineAudioContext: class {} });
  return stats;
}
test('three-hour windows cover every second exactly once with bounded context', () => {
  const parts = [...windows(MAX_MEDIA_SECONDS)];
  expect(parts).toHaveLength(180);
  expect(parts[0].start).toBe(0);
  expect(parts.at(-1)?.end).toBe(10800);
  parts.forEach((p, i) => { expect(p.to - p.from).toBeLessThanOrEqual(64); if (i) expect(p.start).toBe(parts[i - 1].end); });
  expect(() => [...windows(3600, 13)]).toThrow();
});
test('three-hour job reuses one model worker and persists all 180 windows', async () => {
  duration = 10800; const stats = fakeBrowser(); const checkpoints: number[] = [];
  const result = await transcribeLocal(new Blob(['audio']), duration, new AbortController().signal, () => {}, {
    save: async (_, cp) => { checkpoints.push(cp.completedSeconds); },
  });
  expect(checkpoints).toHaveLength(180); expect(checkpoints.at(-1)).toBe(10800);
  expect(result.split('\n')).toHaveLength(180);
  expect(stats).toEqual({ terminated: 1, created: 1, calls: 180 });
  expect(disposed).toBe(1); expect(Math.max(...reads.map(([a,b]) => b-a))).toBeLessThanOrEqual(64);
});
test('failure retains the previous checkpoint and resumes without duplicate text', async () => {
  const blob = new Blob(['audio']); fakeBrowser('second-error');
  let checkpoint: TranscriptionCheckpoint | undefined; let text = '';
  await expect(transcribeLocal(blob, duration, new AbortController().signal, () => {}, {
    save: async (t, c) => { text = t; checkpoint = c; },
  })).rejects.toThrow();
  expect(checkpoint?.completedSeconds).toBe(60); expect(text).toBe('区間1');
  reads.length = 0; const stats = fakeBrowser();
  const result = await transcribeLocal(blob, duration, new AbortController().signal, () => {}, { text, checkpoint });
  expect(reads[0][0]).toBe(58); expect(stats.calls).toBe(2); expect(result.split('\n')).toHaveLength(3);
});
test('different original fails before decoder and worker creation', async () => {
  const stats = fakeBrowser(); const signal = new AbortController().signal;
  const checkpoint: TranscriptionCheckpoint = { version: 1, fingerprint: await fingerprint(new Blob(['old']), signal), completedSeconds: 60, totalSeconds: 125 };
  await expect(transcribeLocal(new Blob(['new']), 125, signal, () => {}, { checkpoint })).rejects.toThrow('同じ原本');
  expect(stats.created).toBe(0); expect(reads.length).toBe(0);
});
test('cancel destroys running worker without advancing checkpoint', async () => {
  const stats = fakeBrowser('pending'); const controller = new AbortController(); let saves = 0;
  const pending = transcribeLocal(new Blob(['audio']), duration, controller.signal, () => {}, { save: async () => { saves++; } });
  await new Promise(r => setTimeout(r, 15)); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(stats.terminated).toBe(1); expect(saves).toBe(0); expect(disposed).toBe(1);
});


// Guard the decoder capacity, including Whisper's 3-token language/task prompt.
import { GENERATION_OPTIONS, hasRunawayRepetition } from '../src/web/lib/transcription/generation';
test('decoder generation limit includes the prompt instead of adding 448 tokens', () => {
  expect(GENERATION_OPTIONS.max_length).toBe(448);
  expect('max_new_tokens' in GENERATION_OPTIONS).toBe(false);
  expect(GENERATION_OPTIONS.max_length - 3).toBe(445);
});
test('runaway phrase loops are flagged but ordinary repeated speech is preserved', () => {
  expect(hasRunawayRepetition('それが、ビデオのビデオがあるから、'.repeat(12))).toBe(true);
  expect(hasRunawayRepetition('そうですね。ありがとうございます。そうですね。ありがとうございます。')).toBe(false);
  expect(hasRunawayRepetition('屋外の気温が昼も夜も上がっています。空気を入れ替えます。')).toBe(false);
});

test('unresolved repetition never advances the saved checkpoint', async () => {
  const stats = fakeBrowser('repetition');
  let saves = 0;
  await expect(transcribeLocal(new Blob(['audio']), duration, new AbortController().signal, () => {}, {
    save: async () => { saves++; },
  })).rejects.toThrow('不自然な繰り返し');
  expect(saves).toBe(0); expect(stats.terminated).toBe(1); expect(disposed).toBe(1);
});
