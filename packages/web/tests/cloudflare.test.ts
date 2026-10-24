import { test, expect } from 'bun:test';
import worker from '../src/worker';
const assets = { fetch: async () => { throw new Error('Private assets must not be reached'); } };
test('unconfigured Worker fails closed before accessing data or assets', async () => {
  const res = await worker.fetch(new Request('https://example.invalid/'), { ASSETS: assets, ACCESS_ISSUER:'', ACCESS_AUD:'' });
  expect(res.status).toBe(503);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
});
test('configured Worker rejects other hosts and absent/forged Access assertions', async () => {
  Object.assign(process.env,{WEBSITE_URL:'https://example.invalid',OWNER_EMAILS:'owner@example.invalid',DATABASE_URL:'libsql://unused.invalid',DATABASE_AUTH_TOKEN:'unused',BETTER_AUTH_SECRET:'test-only-secret-0000000000000000000000',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'});
  const env = { ASSETS: assets, ACCESS_ISSUER:'https://example.cloudflareaccess.com', ACCESS_AUD:'test' };
  expect((await worker.fetch(new Request('https://other.invalid/'),env)).status).toBe(403);
  expect((await worker.fetch(new Request('https://example.invalid/'),env)).status).toBe(403);
  expect((await worker.fetch(new Request('https://example.invalid/',{headers:{'Cf-Access-Jwt-Assertion':'forged'}}),env)).status).toBe(403);
});
