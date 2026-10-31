/// <reference path="../../../cloudflare/worker-env.d.ts" />
/// <reference types="@cloudflare/workers-types" />
import app from './api';
import { withDatabase } from './api/database';
import { secureResponse } from './security-headers';
import { createRemoteJWKSet, jwtVerify } from 'jose';

interface Env extends Partial<Pick<Cloudflare.Env, "COCKPIT_MIGRATION_DB">> {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
}
// Cache only public verification keys. Never share DB connections or auth state between requests.
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const required = ['WEBSITE_URL', 'OWNER_EMAILS', 'DATABASE_URL', 'DATABASE_AUTH_TOKEN',
      'BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    if (required.some(key => !process.env[key]) || !env.ACCESS_ISSUER || !env.ACCESS_AUD)
      return secureResponse(new Response('Deployment configuration incomplete', { status: 503 }));
    const canonical = new URL(process.env.WEBSITE_URL!);
    const url = new URL(request.url);
    if (canonical.protocol !== 'https:' || url.origin !== canonical.origin)
      return secureResponse(new Response('Unknown host', { status: 403 }));
    // No public workers.dev/preview bypass: validate a signed Access assertion at the origin too.
    try {
      const issuer = new URL(env.ACCESS_ISSUER);
      if (issuer.protocol !== 'https:' || !issuer.hostname.endsWith('.cloudflareaccess.com') || issuer.pathname !== '/')
        throw new Error('Invalid Access issuer');
      const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
      if (!assertion) throw new Error('Missing Access assertion');
      let keys = keysets.get(issuer.origin);
      if (!keys) { keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer)); keysets.set(issuer.origin, keys); }
      await jwtVerify(assertion, keys, { issuer: issuer.origin, audience: env.ACCESS_AUD, algorithms: ['RS256'] });
    } catch { return secureResponse(new Response('Access denied', { status: 403 })); }
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/'))
        return secureResponse(await withDatabase(async () => {
          const result = await app.fetch(request);
          // Finish the DB-backed response while the request-local connection is still open.
          return new Response(await result.arrayBuffer(), result);
        }, env.COCKPIT_MIGRATION_DB));
      const path = decodeURIComponent(url.pathname);
      if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => part.startsWith('.')))
        return secureResponse(new Response('Not found', { status: 404 }));
      if (!['GET', 'HEAD'].includes(request.method))
        return secureResponse(new Response('Method not allowed', { status: 405 }));
      return secureResponse(await env.ASSETS.fetch(request));
    } catch {
      // Do not log secrets, OAuth responses, database URLs, or user records.
      return secureResponse(new Response('Service unavailable', { status: 503 }));
    }
  },
};
