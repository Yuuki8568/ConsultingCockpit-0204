import { z } from "zod";

const hostPin = z.string().length(64).regex(/^[0-9a-f]{64}$/);
export const statsInput = z.object({ expectedSourceHostSha256: hostPin.optional() }).nullish();

/** Compare just the logical Turso database hostname of the exact URL used to
 * create the current connection. No parsing that discards userinfo, a port,
 * dot segments or query options, and no connection or DNS lookup. */
export async function matchesSourceHost(url: string | undefined, expected: string): Promise<boolean> {
  if (!url || url.length > 263 || !hostPin.safeParse(expected).success) return false;
  const match = /^libsql:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+turso\.io)\/?$/.exec(url);
  if (!match || match[0] !== url || match[1].length > 253) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(match[1])));
  let difference = 0;
  for (let i = 0; i < digest.length; i++) difference |= digest[i] ^ parseInt(expected.slice(i * 2, i * 2 + 2), 16);
  return difference === 0;
}
