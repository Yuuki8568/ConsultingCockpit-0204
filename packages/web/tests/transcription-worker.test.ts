import { test, expect, mock, beforeAll, afterAll } from 'bun:test';

const messages: { type: string; text?: string; code?: string }[] = [];
const options: Record<string, unknown>[] = [];
let responses: string[] = [];
const originalSelf = globalThis.self;
const fakeSelf = {
  location: { origin: 'https://app.test' }, fetch: globalThis.fetch,
  postMessage: (message: typeof messages[number]) => messages.push(message),
  onmessage: undefined as undefined | ((event: { data: { pcm: Float32Array; keepStart: number; keepEnd: number } }) => Promise<void>),
};
mock.module('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } } },
  pipeline: async () => async (_: Float32Array, config: Record<string, unknown>) => {
    options.push(config);
    const text = responses.shift()!;
    return { text, chunks: [{ text, timestamp: [0, 20] }] };
  },
}));
beforeAll(async () => {
  Object.assign(globalThis, { self: fakeSelf });
  await import('../src/web/lib/transcription/transcribe.worker');
});
afterAll(() => { Object.assign(globalThis, { self: originalSelf }); });
async function run(texts: string[]) {
  messages.length = 0; options.length = 0; responses = [...texts];
  const pcm = new Float32Array([0.5, 0.3]);
  await fakeSelf.onmessage!({ data: { pcm, keepStart: 0, keepEnd: 60 } });
  expect(Array.from(pcm)).toEqual([0, 0]);
}
const loop = 'それがビデオのビデオがあるから'.repeat(12);
test('worker retries a phrase loop in smaller chunks and returns only the corrected text', async () => {
  await run([loop, '屋外の気温が上がっています']);
  expect(options.map(x => x.chunk_length_s)).toEqual([30, 15]);
  expect(options.every(x => x.max_length === 448 && !('max_new_tokens' in x))).toBe(true);
  expect(messages.filter(x => x.type === 'done')).toEqual([{ type: 'done', text: '屋外の気温が上がっています' }]);
});
test('worker stops after one unsuccessful retry without publishing the repeated text', async () => {
  await run([loop, loop]);
  expect(options).toHaveLength(2);
  expect(messages.filter(x => x.type === 'done')).toHaveLength(0);
  expect(messages.at(-1)).toEqual({ type: 'error', code: 'repetition' });
});
test('ordinary speech passes through without a second recognition pass', async () => {
  await run(['ご説明ありがとうございます。次の議題に進みます。']);
  expect(options).toHaveLength(1);
  expect(messages.at(-1)?.type).toBe('done');
});
