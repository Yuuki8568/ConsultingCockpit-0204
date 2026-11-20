import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

// Serve the runtime from our own origin: no CDN scripts, no inline/eval scripts.
export function transcriptionRuntime(): Plugin {
  const dir = dirname(createRequire(import.meta.url).resolve('@huggingface/transformers'));
  const names = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];
  return {
    name: 'local-transcription-runtime',
    generateBundle() {
      for (const name of names) this.emitFile({ type: 'asset', fileName: `transcription-runtime/${name}`, source: readFileSync(join(dir, name)) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.replace('/transcription-runtime/', '');
        if (!req.url?.startsWith('/transcription-runtime/') || !names.includes(name!)) return next();
        res.setHeader('Content-Type', name!.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(join(dir, name!)));
      });
    },
  };
}
