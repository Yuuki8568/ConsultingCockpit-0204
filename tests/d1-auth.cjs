const assert=require('node:assert/strict'),fs=require('node:fs'),{createHmac}=require('node:crypto');
const dep=require('node:module').createRequire(require.resolve('wrangler'));
const {build}=dep('esbuild'),{Miniflare,convertV4MiniflareOptions}=dep('miniflare');
(async()=>{
 Object.assign(process.env,{NODE_ENV:'production',WEBSITE_URL:'https://cockpit.example.invalid',OWNER_EMAILS:'owner@example.invalid',BETTER_AUTH_SECRET:'isolated-d1-test-secret-not-for-production-000000000000',GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic'});
 const output='packages/web/tests/.d1-auth-test.mjs';
 await build({stdin:{contents:`export {createD1Auth,authenticateD1} from './packages/web/src/api/database/d1/auth.ts'`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:output});
 const {createD1Auth,authenticateD1}=await import(require('node:url').pathToFileURL(require('node:path').resolve(output)));
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-17',d1Databases:['DB']}));
 try{
 const db=await mf.getD1Database('DB');
 await db.batch(fs.readFileSync('cloudflare/d1/business-schema.sql','utf8').replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
 const now=Date.now();
 for(const [uid,email,verified] of [['owner','owner@example.invalid',1],['outsider','outsider@example.invalid',1],['unverified','owner@example.invalid.other',0]]){
 await run('INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)',uid,uid,email,verified,now,now);
 await run('INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)',uid+'-session',now+3600000,uid+'-token',now,now,uid);
 }
 const headers=(token='owner-token',origin=process.env.WEBSITE_URL)=>new Headers({origin,cookie:'__Secure-better-auth.session_token='+encodeURIComponent(token+'.'+createHmac('sha256',process.env.BETTER_AUTH_SECRET).update(token).digest('base64'))});
 const auth=createD1Auth(db),context=await auth.$context;
 // Exercise the real adapter's timestamp/boolean mapping and verified-owner hooks.
 await assert.rejects(context.internalAdapter.createUser({name:'bad',email:'intruder@example.invalid',emailVerified:true}));
 await assert.rejects(context.internalAdapter.createUser({name:'bad',email:'owner@example.invalid',emailVerified:false}));
 assert.equal((await authenticateD1(db,headers())).user.id,'owner');
 await assert.rejects(authenticateD1(db,headers('outsider-token')));
 await assert.rejects(authenticateD1(db,headers('unverified-token')));
 await assert.rejects(authenticateD1(db,new Headers()));
 await assert.rejects(authenticateD1(db,headers('owner-token','https://evil.example.invalid')));
 const tamper=headers();tamper.set('cookie',tamper.get('cookie')+'x');await assert.rejects(authenticateD1(db,tamper));
 await run('INSERT INTO device(id,user_id,label,platform,created_at_ms,last_seen_at_ms) VALUES (?,?,?,?,?,?)','mac-device','owner','Mac','macOS',now,now);
 await run('INSERT INTO device_session(session_id,user_id,device_id,created_at_ms) VALUES (?,?,?,?)','owner-session','owner','mac-device',now);
 assert.equal((await authenticateD1(db,headers())).deviceId,'mac-device');
 await run('UPDATE device SET revoked_at_ms=? WHERE id=?',now,'mac-device');await assert.rejects(authenticateD1(db,headers()));
 await run('UPDATE device SET revoked_at_ms=NULL WHERE id=?','mac-device');
 await run('UPDATE session SET expires_at=0 WHERE id=?','owner-session');await assert.rejects(authenticateD1(db,headers()));
 // Session CRUD via Better Auth, with no external Google call.
 const session=await context.internalAdapter.createSession('owner');
 assert.equal((await authenticateD1(db,headers(session.token))).user.id,'owner');
 await context.internalAdapter.deleteSession(session.token);await assert.rejects(authenticateD1(db,headers(session.token)));
 console.log('PASS D1 auth: real Better Auth adapter, owner hooks, signed-cookie/session CRUD, timestamps, invalid cookie/origin/non-owner rejection, expiry and device revocation');
 }finally{await mf.dispose();fs.rmSync(output,{force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
