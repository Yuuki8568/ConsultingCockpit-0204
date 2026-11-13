import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite"
import path from "path";
import { execFileSync } from "node:child_process";


import assetOptimizerPlugin from "./vite/__plugins/asset-optimizer-plugin";

const root = path.resolve(__dirname, "../..");

import { CSP as PROD_CSP } from './src/security-headers';
import { transcriptionRuntime } from './vite/transcription-runtime';

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
        define: { __APP_SOURCE_VERSION__: JSON.stringify(process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()) },
		// All env files live at the repo root — keep Vite's own env loading there too,
		// so packages/web/.env* files can never shadow the root .env.
		envDir: root,
		worker: { format: "es" },
		plugins: [transcriptionRuntime(), react(), tailwind(), assetOptimizerPlugin(), strictCspPlugin()],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src/web"),
			},
		},
		server: {
			allowedHosts: true,
			hmr: { overlay: false, },
			cors: false,
            proxy: { "/api": "http://127.0.0.1:4200" }
		}
	};
});
