import app from "./api";
import { resolve, sep, extname } from "node:path";
import { secureResponse } from "./security-headers";
const dist = resolve(import.meta.dir, "../dist");
export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return secureResponse(await app.fetch(request));
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return secureResponse(new Response("Bad path", { status: 400 })); }
  if (path.includes("\\") || path.includes("\0") || path.split("/").some(p => p.startsWith(".")))
    return secureResponse(new Response("Not found", { status: 404 }));
  const target = resolve(dist, "." + path);
  if (!target.startsWith(dist + sep) && target !== dist) return secureResponse(new Response("Not found", { status: 404 }));
  if (request.method !== "GET" && request.method !== "HEAD") return secureResponse(new Response("Method not allowed", { status: 405 }));
  let file = Bun.file(target);
  if (!await file.exists() || target === dist) {
    if (extname(path)) return secureResponse(new Response("Not found", { status: 404 }));
    file = Bun.file(resolve(dist, "index.html"));
  }
  if (!await file.exists()) return secureResponse(new Response("Build output unavailable", { status: 503 }));
  return secureResponse(new Response(request.method === "HEAD" ? null : file, { headers: { "Content-Type": file.type } }));
}
if (import.meta.main) {
  const server = Bun.serve({ port: Number(process.env.PORT ?? 4200), fetch: handle });
  console.log(`Listening on ${server.port}`);
}
