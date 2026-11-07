import { createHash } from 'node:crypto';
const config = JSON.parse(process.env.CLOUDFLARE_RUNTIME_SECRETS ?? '{}');
for (const key of ['WEBSITE_URL','OWNER_EMAILS','DATABASE_URL','DATABASE_AUTH_TOKEN','BETTER_AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','ACCESS_ISSUER','ACCESS_AUD']) {
  if (typeof config[key] !== 'string' || !config[key].trim() || /YOUR-|NEW-|GENERATE-/.test(config[key])) throw new Error(`Missing configuration: ${key}`);
}
const site = new URL(config.WEBSITE_URL);
if (site.protocol !== 'https:' || site.pathname !== '/' || site.search || site.hash || site.hostname.endsWith('.runable.site') || site.hostname.endsWith('.workers.dev')) throw new Error('Use a dedicated HTTPS custom domain');
if (config.BETTER_AUTH_SECRET.length < 32) throw new Error('Auth secret is too short');
const database = new URL(config.DATABASE_URL);
if (!['libsql:', 'https:'].includes(database.protocol) || database.username || database.password || database.search || database.hash) throw new Error('Use a remote independent database');
const oldFingerprint = process.env.RUNABLE_DATABASE_HOST_SHA256;
if (!oldFingerprint || !/^[0-9a-f]{64}$/.test(oldFingerprint)) throw new Error('Original database host fingerprint required to prevent reuse');
if (createHash('sha256').update(database.host.toLowerCase()).digest('hex') === oldFingerprint) throw new Error('Refusing to reuse the Runable database');
const access = new URL(config.ACCESS_ISSUER);
if (access.protocol !== 'https:' || !access.hostname.endsWith('.cloudflareaccess.com') || access.pathname !== '/') throw new Error('Invalid Access issuer');
console.log('Independent target configuration checked. No source data modified.');
