// Start Vite on 4180. Provide BENCH_FIXTURE and BENCH_RESULT absolute paths.
// Optional TRANSCRIPTION_MODEL_DIR serves the exact pinned model locally (excludes internet download time).
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
(async () => {
  if (!process.env.BENCH_FIXTURE || !process.env.BENCH_RESULT) throw Error('Set BENCH_FIXTURE and BENCH_RESULT');
  let modelServer;
  const allowed = ['tokenizer.json', 'tokenizer_config.json', 'config.json', 'preprocessor_config.json', 'generation_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
  if (process.env.TRANSCRIPTION_MODEL_DIR) {
    modelServer = createServer((req, res) => {
      const relative = req.url.slice(1);
      if (!allowed.includes(relative)) { res.writeHead(404); return res.end(); }
      res.setHeader('Access-Control-Allow-Origin', '*');
      fs.createReadStream(path.join(process.env.TRANSCRIPTION_MODEL_DIR, relative)).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
    });
    await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  }
  const browser = await chromium.launch({ executablePath: process.env.BENCH_CHROMIUM || undefined, headless: true, dumpio: process.env.BENCH_DEBUG === '1', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.exposeFunction('persistCheckpoint', row => fs.writeFileSync(process.env.BENCH_RESULT + '.checkpoint.json', JSON.stringify(row, null, 2)));
    await page.route('**/speech-bench', r => r.fulfill({ contentType: 'text/html', body: '<input type="file">' }));
    if (process.env.TRANSCRIPTION_MODEL_DIR) await page.route('https://huggingface.co/**', async route => {
      const match = new URL(route.request().url()).pathname.match(/^\/onnx-community\/(?:whisper-(?:tiny|base|small)|kotoba-whisper-v2.2-ONNX)\/resolve\/[a-f0-9]{40}\/(.+)$/);
      const relative = match?.[1];
      if (!allowed.includes(relative)) return route.fulfill({ status: 404, body: 'missing' });
      // Stream large model bytes over loopback instead of copying them through CDP/base64.
      await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:${modelServer.address().port}/${relative}`, 'access-control-allow-origin': '*' }, body: '' });
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
            await window.persistCheckpoint({ checkpoints, text, checkpoint });
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
  } finally { await browser.close(); modelServer?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
