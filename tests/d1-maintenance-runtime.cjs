const dep=require('node:module').createRequire(require.resolve('wrangler'));
const {build}=dep('esbuild'),{Miniflare,convertV4MiniflareOptions}=dep('miniflare');
(async()=>{
 const b=await build({entryPoints:['security-ops/d1-maintenance-entry.ts'],bundle:true,minify:true,platform:'browser',format:'esm',conditions:['workerd','worker','browser'],external:['node:*'],write:false});
 const m=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-10-17',compatibilityFlags:['nodejs_compat','nodejs_compat_populate_process_env']}));
 try{for(const path of ['/','/api/auth/get-session','/api/rpc/sync/push']){const r=await m.dispatchFetch('https://example.invalid'+path);if(r.status!==503||r.headers.get('Cache-Control')!=='no-store')throw Error('Maintenance bypass');}console.log('PASS deployable maintenance Worker runtime');}finally{await m.dispose()}
})().catch(e=>{console.error(e);process.exitCode=1});
