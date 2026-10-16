import { defineConfig, loadEnv } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";

// 設定はリポジトリ直下の .env に置く決まりなので、ここから読んで
// Electron のメインプロセスに埋め込む（メイン側は自分で .env を読まない）。
const rootEnv = loadEnv("development", path.resolve(__dirname, "../.."), "");
const devPort = rootEnv.PORT || "4200";

export default defineConfig({
  define: {
    "process.env.APPLICATION_ID": JSON.stringify(rootEnv.APPLICATION_ID ?? ""),
    // 開発中は同じ機械で動いている Web を読む（公開URLではなく手元を見る）
    "process.env.DESKTOP_DEV_URL": JSON.stringify(`http://localhost:${devPort}`),
  },
  build: {
    rollupOptions: {
      input: path.join(__dirname, "electron/__no-renderer.ts"),
    },
  },
  plugins: [
    electron({
      main: {
        entry: "electron/main.ts",
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
      },
    }),
  ],
  server: {
    allowedHosts: true,
  },
});
