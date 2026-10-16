// Standalone isolated test process only; never imported by production.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temp = mkdtempSync(join(tmpdir(), 'cockpit-blackbox-'));
Object.assign(process.env, { NODE_ENV:'production', DATABASE_URL:`file:${temp}/test.db`,
 DATABASE_AUTH_TOKEN:'', WEBSITE_URL:'http://127.0.0.1:4420', OWNER_EMAILS:'owner@example.invalid',
 BETTER_AUTH_SECRET:'isolated-test-secret-not-for-production-000000000000',
 APPLICATION_ID:'isolated-fixture', VITE_RUNABLE_AUTH_ISSUER:'https://example.invalid/auth' });
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
const { handle } = await import('../src/server');
const server = Bun.serve({ port:4420,fetch:handle });
process.on('SIGTERM', () => { server.stop(true); rmSync(temp,{recursive:true,force:true}); process.exit(0); });
console.log('Isolated fixture ready on 4420');
