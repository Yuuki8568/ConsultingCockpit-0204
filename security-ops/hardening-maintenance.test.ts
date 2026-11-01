import {test,expect} from 'bun:test';
import {createClient} from '@libsql/client';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {applyOnce} from './hardening-maintenance';
test('scheduled additive migration preserves synthetic content, is restart-safe, and rejects partial schemas',async()=>{
 const dir=mkdtempSync('/tmp/cockpit-migration-');const c=createClient({url:`file:${dir}/db.sqlite`});
 try{
 await c.executeMultiple("CREATE TABLE vault(user_id TEXT PRIMARY KEY);CREATE TABLE record(id TEXT PRIMARY KEY,ciphertext TEXT);CREATE TABLE audit_event(id TEXT PRIMARY KEY,user_id TEXT,seq INTEGER,hash TEXT);INSERT INTO record VALUES('synthetic','ciphertext-stays');INSERT INTO audit_event VALUES('a','owner',1,'old-hash');");
 const sql=readFileSync('security-ops/migrations/20261101-hardening.sql','utf8');
 expect(await applyOnce(c,sql)).toBe('applied');expect(await applyOnce(c,sql)).toBe('already-applied');
 expect((await c.execute('SELECT ciphertext FROM record')).rows[0].ciphertext).toBe('ciphertext-stays');
 expect((await c.execute('SELECT hash FROM audit_head')).rows[0].hash).toBe('old-hash');
 await c.execute('DROP TABLE security_counter');await expect(applyOnce(c,sql)).rejects.toThrow('PARTIAL_SCHEMA');
 }finally{c.close();rmSync(dir,{recursive:true,force:true});}
});
