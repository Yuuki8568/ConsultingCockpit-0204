// Start Vite on 4180. Provide BENCH_FIXTURE and BENCH_RESULT absolute paths.
// Optional TRANSCRIPTION_MODEL_DIR serves the exact pinned model locally (excludes internet download time).
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  if (!process.env.BENCH_FIXTURE || !process.env.BENCH_RESULT) throw Error('Set BENCH_FIXTURE and BENCH_RESULT');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/speech-bench', r => r.fulfill({ contentType: 'text/html', body: '<input type="file">' }));
    if (process.env.TRANSCRIPTION_MODEL_DIR) await page.route('https://huggingface.co/**', async route => {
      const relative = route.request().url().split('/ff4177021cc41f7db950912b73ea4fdf7d01d8e7/')[1];
      const allowed = ['tokenizer.json', 'tokenizer_config.json', 'config.json', 'preprocessor_config.json', 'generation_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
      if (!allowed.includes(relative)) return route.fulfill({ status: 404, body: 'missing' });
      await route.fulfill({ path: path.join(process.env.TRANSCRIPTION_MODEL_DIR, relative), headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('http://127.0.0.1:4180/speech-bench');
    await page.locator('input').setInputFiles(process.env.BENCH_FIXTURE);
    page.on('console', m => { if (m.text().startsWith('BENCH_PROGRESS ')) console.log(m.text()); });
    const result = await page.evaluate(async () => {
      const { transcribeLocal } = await import('/src/web/lib/transcription/local.ts');
      const started = performance.now();
      const checkpoints = [];
      let savedText = '';
      try {
        const text = await transcribeLocal(document.querySelector('input').files[0], undefined, new AbortController().signal, () => {}, {
          save: async (text, checkpoint) => {
            savedText = text;
            const row = { audioSeconds: checkpoint.completedSeconds, wallSeconds: (performance.now() - started) / 1000, characters: text.length };
            checkpoints.push(row);
            console.log('BENCH_PROGRESS ' + JSON.stringify(row));
          },
        });
        return { status: 'done', wallSeconds: (performance.now() - started) / 1000, checkpoints, text };
      } catch (error) {
        return { status: 'error', error: String(error), wallSeconds: (performance.now() - started) / 1000, checkpoints, text: savedText };
      }
    });
    // Contains transcript: keep this output private when testing private recordings.
    fs.writeFileSync(process.env.BENCH_RESULT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: result.status, wallSeconds: result.wallSeconds, completedSeconds: result.checkpoints.at(-1)?.audioSeconds ?? 0 }));
    if (result.status !== 'done') process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
