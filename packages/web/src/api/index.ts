import { Hono } from "hono";
import type { RouterClient } from "@orpc/server";
import { createApp } from "./__core/app";
import { auth } from "./auth";
import { isAllowedOrigin } from "./origins";
import { audit } from "./routes/audit";
import { devices } from "./routes/devices";
import { ping } from "./routes/ping";
import { sync } from "./routes/sync";
import { storage } from "./routes/storage";
import { vault } from "./routes/vault";

// API features are oRPC procedures, one file per feature in ./routes/,
// composed into this router — typed end-to-end via the clients
// (web: src/web/lib/api.ts, mobile: lib/api.ts).
export const router = {
  ping,
  storage,
  vault,
  sync,
  devices,
  audit,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);

/**
 * 認証の出入り口（/api/auth/*）の接続元検査。
 * 業務RPC（/api/rpc/*）は各手続きの authed で断っているが、認証の出入り口は
 * 基盤の CORS が名乗られた接続元をそのまま許すため、ここで名簿と照合する。
 * 名簿にない接続元からの要求は、セッションの照会も状態変更も受け付けない。
 */
app.use("/api/auth/*", async (c, next) => {
	if (!isAllowedOrigin(c.req.header("origin"))) {
		return c.json({ error: "許可されていない接続元です。" }, 403);
	}
	await next();
});

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Wrap the template app so denied origins never reach its reflecting CORS middleware.
const guarded = new Hono();
guarded.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  if (!isAllowedOrigin(origin)) return c.json({ error: "許可されていない接続元です。" }, 403);
  if (c.req.method === "OPTIONS") {
    if (origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
    }
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return c.body(null, 204);
  }
  await next();
  c.header("Cache-Control", "no-store");
});
guarded.route("/", app);
export default guarded;
