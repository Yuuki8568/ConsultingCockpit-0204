import { app, BrowserWindow, Menu, shell, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createManagedDeepLinks } from "@runablehq/managed-auth/desktop/main";
import { registerIpcHandlers } from "./ipc";

// Consulting Cockpit のデスクトップ殻。
// 画面そのものは Web 版（packages/web）をそのまま読み込む。
// デスクトップにしかできないこと（保存先を決めた控えの書き出し）は
// Web 側の DesktopBackup が window.electronAPI 経由で呼ぶ。
//
// createManagedDeepLinks は必須（bun run lint が確認する）。
// runable-<APPLICATION_ID> のディープリンクと Google サインインの戻りを運ぶ。

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== "production";
// 開発中の読み込み先。vite.config.ts が直下の .env から埋め込む。
const WEB_DEV_URL =
  process.env.DESKTOP_DEV_URL ?? process.env.WEBSITE_URL ?? "http://localhost:4200";
const WEB_DIST = path.join(__dirname, "../web-dist");

const APP_TITLE = "Consulting Cockpit";
const BG = "#0C0C0C";

let win: BrowserWindow | null = null;
const getWindow = () => win;

const deepLinks = createManagedDeepLinks({
  applicationId: process.env.APPLICATION_ID,
  getWindow,
});

function createWindow() {
  win = new BrowserWindow({
    title: APP_TITLE,
    icon: path.join(__dirname, "../electron/icon.png"),
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: BG,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // ページ側の title に上書きされないよう固定する
  win.on("page-title-updated", (e) => {
    e.preventDefault();
  });

  // 外部リンクは既定のブラウザで開く（アプリの中で別画面を開かせない）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // アプリの外へ遷移させない（金庫を開いた状態のまま別サイトへ行かせない）
  win.webContents.on("will-navigate", (e, url) => {
    const here = isDev ? WEB_DEV_URL : "file://";
    if (!url.startsWith(here)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });

  if (isDev) {
    void win.loadURL(WEB_DEV_URL);
  } else {
    void win.loadFile(path.join(WEB_DIST, "index.html"));
  }
}

/** 日本語のメニュー。コピー・貼り付け・印刷が効く状態を保つ。 */
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: APP_TITLE,
            submenu: [
              { role: "about", label: `${APP_TITLE} について` },
              { type: "separator" },
              { role: "hide", label: "隠す" },
              { role: "hideOthers", label: "ほかを隠す" },
              { role: "unhide", label: "すべて表示" },
              { type: "separator" },
              { role: "quit", label: "終了" },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "ファイル",
      submenu: [
        {
          label: "印刷…",
          accelerator: "CmdOrCtrl+P",
          click: () => getWindow()?.webContents.print(),
        },
        { type: "separator" },
        {
          label: "この端末の控えについて",
          click: () => {
            void dialog.showMessageBox({
              type: "info",
              title: "手元への控え",
              message: "控えの書き出しは画面右上の設定にあります。",
              detail:
                "設定 → データの保全 →「手元への控え（デスクトップ版のみ）」で保存先を決めて書き出せます。\n書き出したファイルは中身がそのまま読める形式です。共有フォルダやクラウド同期の対象には置かないでください。",
              buttons: ["わかりました"],
            });
          },
        },
        { type: "separator" },
        isMac
          ? { role: "close", label: "ウインドウを閉じる" }
          : { role: "quit", label: "終了" },
      ],
    },
    {
      label: "編集",
      submenu: [
        { role: "undo", label: "取り消す" },
        { role: "redo", label: "やり直す" },
        { type: "separator" },
        { role: "cut", label: "切り取り" },
        { role: "copy", label: "コピー" },
        { role: "paste", label: "貼り付け" },
        { role: "selectAll", label: "すべて選択" },
      ],
    },
    {
      label: "表示",
      submenu: [
        { role: "reload", label: "再読み込み" },
        { role: "resetZoom", label: "実際の大きさ" },
        { role: "zoomIn", label: "拡大" },
        { role: "zoomOut", label: "縮小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全画面表示" },
        { role: "toggleDevTools", label: "開発者ツール" },
      ],
    },
    {
      label: "ヘルプ",
      submenu: [
        {
          label: "鍵をなくしたときの扱い",
          click: () => {
            void dialog.showMessageBox({
              type: "warning",
              title: "パスフレーズについて",
              message: "パスフレーズは復旧できません。",
              detail:
                "保管しているのは暗号文だけで、鍵はこの端末の外に出ていません。パスフレーズを忘れると中身は開けなくなります。控え（JSON）を別の場所に取っておいてください。",
              buttons: ["わかりました"],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

registerIpcHandlers(getWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Windows/Linux はディープリンクを argv で渡してくる（起動中の2つ目のインスタンス、
// および冷起動のこのインスタンス）。1つだけ動かして両方を転送する。
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", (_event, argv) => deepLinks.handleArgv(argv));
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    deepLinks.handleArgv(process.argv);
  });
} else {
  app.quit();
}
