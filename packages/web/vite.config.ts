import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite"
import path from "path";
import runableAnalyticsPlugin from "./vite/__plugins/runable-analytics-plugin";
import honoDevPlugin from "./vite/__plugins/hono-dev-plugin";
import assetOptimizerPlugin from "./vite/__plugins/asset-optimizer-plugin";

const root = path.resolve(__dirname, "../..");

/**
 * 本番ビルドの CSP。
 * 開発時は HMR（ws:）と react-refresh のインライン導入が要るため緩いままにし、
 * ビルド成果物だけを厳しくする。
 *  - script-src は 'self' のみ（インライン・eval なし。
 *    枠対策は /frameguard.js、計測は /runable.js と、どちらも外部ファイル）
 *  - connect-src は自分自身と、サインイン基盤・計測の送信先だけ
 *  - style-src の 'unsafe-inline' は画面部品の style 属性が使うため残す
 */
const PROD_CSP =
	"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
	"img-src 'self' data: blob:; media-src 'self' blob:; " +
	"connect-src 'self' https://api.runable.com https://r.lilstts.com; " +
	"frame-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'";

/** ビルド成果物の CSP メタを本番用に差し替える */
function strictCspPlugin(): Plugin {
	return {
		name: "strict-csp",
		transformIndexHtml: {
			order: "post",
			handler(html, ctx) {
				if (!ctx.bundle) return html; // 開発サーバーでは差し替えない
				return html.replace(
					/(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[\s\S]*?("\s*\/?>)/,
					`$1${PROD_CSP}$2`,
				);
			},
		},
	};
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, root, '');
	Object.assign(process.env, env);

	return {
		// All env files live at the repo root — keep Vite's own env loading there too,
		// so packages/web/.env* files can never shadow the root .env.
		envDir: root,
		plugins: [honoDevPlugin(), react(), runableAnalyticsPlugin(), tailwind(), assetOptimizerPlugin(), strictCspPlugin()],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src/web"),
			},
		},
		server: {
			allowedHosts: true,
			hmr: { overlay: false, },
			cors: false
		}
	};
});
