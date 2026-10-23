const {chromium}=require('@playwright/test');const fs=require('node:fs'),{spawn}=require('node:child_process');
(async()=>{const entry='backup-test.ts',html='backup-test.html';fs.writeFileSync(html,'<script type="module" src="/backup-test.ts"></script>');fs.writeFileSync(entry,`
import * as backup from '/src/web/lib/backup/automatic.ts';
import {vaultStore as store} from '/src/web/lib/store/vault-store.ts';
import {deriveVaultKeys,newSalt} from '/src/web/lib/crypto/vault-crypto.ts';
import {makeEmptyVaultState,makeEmptyCase} from '/src/web/domain/logic/state.ts';
import {recoverPortableBackup} from '/src/web/lib/export/backup-format.ts';
const salt=newSalt(),keys=await deriveVaultKeys('test-backup-passphrase',salt,100000);
const state=makeEmptyVaultState(),c=makeEmptyCase('test');c.id='case-test';
const media={id:'rec-test',name:'sample.wav',size:12,mimeType:'audio/wav',kind:'audio',addedAt:new Date().toISOString(),chunkCount:1};
c.recordings=[media,{...media,id:'rec-missing',sourceOnly:true}];state.cases=[c];
await store.initializeEmpty(keys.vaultKey,keys.macKey,state);store.setBackupKdf(salt,100000);
await store.saveMediaBlob(media.id,new Blob(['hello audio!']));const dir=await navigator.storage.getDirectory();window.showDirectoryPicker=async()=>dir;
Object.assign(window,{backup,store,dir,recoverPortableBackup,ready:true});`);
const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4187'],{stdio:'ignore'});let browser;try{
for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:4187/backup-test.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
browser=await chromium.launch({executablePath:process.env.BENCH_CHROMIUM,args:['--no-sandbox']});const page=await browser.newPage();page.on('pageerror',console.error);await page.goto('http://127.0.0.1:4187/backup-test.html');await page.waitForFunction(()=>window.ready);
console.log(await page.evaluate(async()=>{
await backup.chooseBackupFolder();await backup.runBackup(true);let config=await backup.getBackupConfig();if(config.missing!==1)throw Error(config.message);
const records=await dir.getDirectoryHandle('01_案件データ_暗号化');let files=[];for await(const [,handle]of records.entries())files.push(handle);
const text=await(await files[0].getFile()).text();if(text.includes('sample.wav'))throw Error('plaintext leak');const restored=JSON.parse(await recoverPortableBackup(text,'test-backup-passphrase'));if(restored.state.cases[0].recordings.length!==2)throw Error('restore');
await backup.runBackup();let count=0;for await(const _ of records.entries())count++;if(count!==1)throw Error('daily skip');
await backup.archiveOriginal(store.getState().cases[0].recordings[1],new File(['hello audio!'],'sample.wav'));await backup.runBackup(true);config=await backup.getBackupConfig();if(config.missing!==0)throw Error('original recovery');
const originals=await dir.getDirectoryHandle('02_録音・動画原本');const f=await originals.getFileHandle('rec-missing--sample.wav');const w=await f.createWritable();await w.write('bad');await w.close();await backup.runBackup(true);config=await backup.getBackupConfig();if(config.missing!==1)throw Error('corruption');
const before=config.last;
const originalPermission=FileSystemDirectoryHandle.prototype.queryPermission;
FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'denied';await backup.runBackup(true);config=await backup.getBackupConfig();if(config.last!==before || !config.message.includes('保存権限'))throw Error('permission failure');FileSystemDirectoryHandle.prototype.queryPermission=originalPermission;
await navigator.locks.request('cockpit-auto-backup',async()=>{await backup.runBackup(true);if((await backup.getBackupConfig()).last!==before)throw Error('double run');});
const big=new Blob([new Uint8Array(9*1024*1024)]);await backup.writeVerified(dir,'chunk-test',big);if((await(await dir.getFileHandle('chunk-test')).getFile()).size!==big.size)throw Error('chunk copy');
const last=config.last;await backup.pauseBackup();await backup.runBackup(true);if((await backup.getBackupConfig()).last!==last)throw Error('pause');await backup.permitBackup();store.lock();await backup.runBackup(true);if((await backup.getBackupConfig()).last!==last)throw Error('lock');
return {portableRestore:true,encryptedRecords:true,realFilesystem:true,missingOriginalDetected:true,originalRecovery:true,corruptionDetected:true,dailySkip:true,pause:true,lock:true,permissionDenied:true,concurrentSkip:true,multiChunkCopy:true};
}));}finally{if(browser)await browser.close();server.kill();for(const f of[entry,html])fs.unlinkSync(f);}})().catch(e=>{console.error(e);process.exitCode=1});
