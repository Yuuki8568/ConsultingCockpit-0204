export const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://huggingface.co https://*.xethub.hf.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.hf.co https://us.aws.cdn.hf.co; frame-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'";
export function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Frame-Options", "DENY");
  if (process.env.RELEASE_SHA) headers.set("X-Cockpit-Release", process.env.RELEASE_SHA);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  if (process.env.NODE_ENV === "production") headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
