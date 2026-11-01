// Standalone isolated test process only; never imported by production.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temp = mkdtempSync(join(tmpdir(), 'cockpit-blackbox-'));
Object.assign(process.env, { NODE_ENV:'production', DATABASE_URL:`file:${temp}/test.db`,
 DATABASE_AUTH_TOKEN:'', WEBSITE_URL:'http://localhost:4420', OWNER_EMAILS:'owner@example.invalid',
 BETTER_AUTH_SECRET:'isolated-test-secret-not-for-production-000000000000',
 GOOGLE_CLIENT_ID:'fixture', GOOGLE_CLIENT_SECRET:'fixture' });
const { db } = await import('../src/api/database');
const schema = await import('../src/api/database/schema');
const { pushSQLiteSchema } = await import('drizzle-kit/api');
await (await pushSQLiteSchema(schema, db)).apply();
const now = new Date();
for (const id of ['owner','outsider']) {
 await db.insert(schema.user).values({id,name:id,email:`${id}@example.invalid`,emailVerified:true,createdAt:now,updatedAt:now});
 await db.insert(schema.session).values({id:`session-${id}`,userId:id,token:`dummy-${id}-token`,expiresAt:new Date(Date.now()+3600000),createdAt:now,updatedAt:now});
}
await db.insert(schema.device).values({id:'test-device',userId:'owner',label:'fixture',platform:'test',createdAtMs:Date.now(),lastSeenAtMs:Date.now()});
await db.insert(schema.deviceSession).values({sessionId:'session-owner',userId:'owner',deviceId:'test-device',createdAtMs:Date.now()});
await db.insert(schema.vault).values({userId:'owner',kdfSalt:Buffer.alloc(32,1).toString('base64'),kdfIterations:600000,verifierCiphertext:Buffer.alloc(32,2).toString('base64'),verifierIv:Buffer.alloc(12,3).toString('base64'),generation:1,createdAtMs:Date.now(),updatedAtMs:Date.now()});
await db.insert(schema.session).values({id:'session-other',userId:'owner',token:'dummy-other-token',expiresAt:new Date(Date.now()+3600000),createdAt:now,updatedAt:now});
await db.insert(schema.device).values({id:'other-device',userId:'owner',label:'other',platform:'test',createdAtMs:Date.now(),lastSeenAtMs:Date.now()});
await db.insert(schema.deviceSession).values({sessionId:'session-other',userId:'owner',deviceId:'other-device',createdAtMs:Date.now()});
const { handle } = await import('../src/server');
const server = Bun.serve({ port:4420,fetch:async(req)=>{
 if(new URL(req.url).pathname==='/__test/approve'&&req.method==='POST'){
  const {fingerprint}=await req.json() as {fingerprint:string};process.env.COCKPIT_APPROVED_PASSKEYS=JSON.stringify([fingerprint]);return Response.json({ok:true});
 }
 return handle(req);
} });
process.on('SIGTERM', () => { server.stop(true); rmSync(temp,{recursive:true,force:true}); process.exit(0); });
console.log('Isolated fixture ready on 4420');
