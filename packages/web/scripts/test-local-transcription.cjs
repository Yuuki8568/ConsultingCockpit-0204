const {createServer}=require('node:http'); const fs=require('node:fs'); const path=require('node:path');
const root=path.resolve(__dirname,'..');
if (!process.env.TRANSCRIPTION_FIXTURE) throw new Error('Set TRANSCRIPTION_FIXTURE to a short Japanese WAV file');
const {chromium}=require(root+'/node_modules/@playwright/test');
const csp=fs.readFileSync(root+'/src/security-headers.ts','utf8').match(/export const CSP = "([^"]+)"/)[1];
const revision=fs.readFileSync(root+'/src/web/lib/transcription/limits.ts','utf8').match(/MODEL_REVISION = '([^']+)'/)[1];
const modelFiles=['tokenizer.json','tokenizer_config.json','config.json','preprocessor_config.json','generation_config.json','onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx'];
const worker=fs.readdirSync(root+'/dist/assets').find(x=>x.startsWith('transcribe.worker-'));
const server=createServer((req,res)=>{
 res.setHeader('Content-Security-Policy',csp);
 if(req.url==='/harness'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Transcription test</title>');}
 if(req.url.startsWith('/model/') && process.env.TRANSCRIPTION_MODEL_DIR){const relative=req.url.slice(7);if(!modelFiles.includes(relative)){res.statusCode=404;return res.end();}return fs.createReadStream(path.join(process.env.TRANSCRIPTION_MODEL_DIR,relative)).pipe(res);}
 const file=req.url==='/fixture.wav'?process.env.TRANSCRIPTION_FIXTURE:path.join(root,'dist',req.url);
 if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm': /\.(js|mjs)$/.test(file)?'text/javascript':'audio/wav');fs.createReadStream(file).pipe(res);
});
(async()=>{await new Promise(r=>server.listen(4179,'127.0.0.1',r));const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage(); if(process.env.TRANSCRIPTION_MODEL_DIR) await page.route('https://huggingface.co/**', async route => {const relative=route.request().url().split('/'+revision+'/')[1]; if(modelFiles.includes(relative)) await route.fulfill({status:302,headers:{location:'http://127.0.0.1:4179/model/'+relative,'access-control-allow-origin':'*'},body:''});else await route.fulfill({status:404,body:'missing'});});page.on('console',m=>console.log('console',m.type(),m.text()));page.on('requestfailed',r=>console.log('failed',r.url(),r.failure()));page.on('request',r=>console.log('request',r.method(),r.url().split('?')[0]));await page.goto('http://127.0.0.1:4179/harness');
const result=await page.evaluate(async worker=>{const b=await(await fetch('/fixture.wav')).arrayBuffer();const a=await new OfflineAudioContext(1,1,16000).decodeAudioData(b);const pcm=a.getChannelData(0);return new Promise((resolve,reject)=>{const w=new Worker('/assets/'+worker,{type:'module'});const t=setTimeout(()=>{w.terminate();reject(new Error('timeout'));},240000);w.onerror=e=>{clearTimeout(t);reject(new Error(e.message));};w.onmessage=e=>{if(e.data.type==='progress')console.log(e.data.text);else{clearTimeout(t);w.terminate();resolve(e.data);}};w.postMessage({pcm},[pcm.buffer]);});},worker);console.log('RESULT',result.type, 'characters:',result.text?.length ?? 0);if(result.type!=='done'||!result.text)process.exitCode=1;
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
