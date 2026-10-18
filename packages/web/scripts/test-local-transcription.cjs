const {createServer}=require('node:http'); const fs=require('node:fs'); const path=require('node:path');
const root=path.resolve(__dirname,'..');
if (!process.env.TRANSCRIPTION_FIXTURE) throw new Error('Set TRANSCRIPTION_FIXTURE to a short Japanese WAV file');
const {chromium}=require(root+'/node_modules/@playwright/test');
const csp=fs.readFileSync(root+'/src/security-headers.ts','utf8').match(/export const CSP = "([^"]+)"/)[1];
const worker=fs.readdirSync(root+'/dist/assets').find(x=>x.startsWith('transcribe.worker-'));
const server=createServer((req,res)=>{
 res.setHeader('Content-Security-Policy',csp);
 if(req.url==='/harness'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Transcription test</title>');}
 const file=req.url==='/fixture.wav'?process.env.TRANSCRIPTION_FIXTURE:path.join(root,'dist',req.url);
 if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm': /\.(js|mjs)$/.test(file)?'text/javascript':'audio/wav');fs.createReadStream(file).pipe(res);
});
(async()=>{await new Promise(r=>server.listen(4179,'127.0.0.1',r));const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage(); if(process.env.TRANSCRIPTION_MODEL_DIR) await page.route('https://huggingface.co/**', async route => {const file=process.env.TRANSCRIPTION_MODEL_DIR+'/'+route.request().url().split('/ff4177021cc41f7db950912b73ea4fdf7d01d8e7/')[1]; if(fs.existsSync(file)) await route.fulfill({path:file,headers:{'access-control-allow-origin':'*'}});else await route.fulfill({status:404,body:'missing'});});page.on('console',m=>console.log('console',m.type(),m.text()));page.on('requestfailed',r=>console.log('failed',r.url(),r.failure()));page.on('request',r=>console.log('request',r.method(),r.url().split('?')[0]));await page.goto('http://127.0.0.1:4179/harness');
const result=await page.evaluate(async worker=>{const b=await(await fetch('/fixture.wav')).arrayBuffer();const a=await new OfflineAudioContext(1,1,16000).decodeAudioData(b);const pcm=a.getChannelData(0);return new Promise((resolve,reject)=>{const w=new Worker('/assets/'+worker,{type:'module'});const t=setTimeout(()=>{w.terminate();reject(new Error('timeout'));},240000);w.onerror=e=>{clearTimeout(t);reject(new Error(e.message));};w.onmessage=e=>{if(e.data.type==='progress')console.log(e.data.text);else{clearTimeout(t);w.terminate();resolve(e.data);}};w.postMessage({pcm},[pcm.buffer]);});},worker);console.log('RESULT',result.type, 'characters:',result.text?.length ?? 0);if(result.type!=='done'||!result.text)process.exitCode=1;
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
