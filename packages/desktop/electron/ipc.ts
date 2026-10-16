import { ipcMain, dialog, Notification, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

// Starter IPC handlers backing window.electronAPI (see preload.ts and
// packages/web/src/web/lib/desktop.ts). Fully editable — change, remove, or add
// handlers to fit the app; keep the preload methods and web types in sync.
// openExternal and onDeepLink come from @runablehq/managed-auth (wired in
// preload.ts), not from here.

export function registerIpcHandlers(getWindow: () => BrowserWindow | null) {
  /**
   * 画面から触れるファイルを、利用者が選んだものだけに限る。
   *
   * 以前は、画面側から渡された道筋（パス）をそのまま読み書きしていたため、
   * 万一画面に不正な指示が混ざった場合、この端末の任意のファイルに手が届いた。
   * ここでは「開く／保存の画面で利用者が選んだ道筋」を控えておき、
   * その控えにあるものだけを読み書きする。
   */
  const allowedPaths = new Set<string>();
  const allowedDirs = new Set<string>();

  function remember(filePath: string) {
    const abs = path.resolve(filePath);
    allowedPaths.add(abs);
    // 控えを日付ごとに別ファイルで積み上げる使い方があるため、
    // 選ばれたファイルと同じ場所（フォルダ）も許す。
    allowedDirs.add(path.dirname(abs));
  }

  function assertAllowed(filePath: string) {
    const abs = path.resolve(filePath);
    if (allowedPaths.has(abs)) return;
    if (allowedDirs.has(path.dirname(abs))) return;
    throw new Error(
      "このファイルは扱えません。「開く」または「保存」の画面から選び直してください。",
    );
  }

  // Dialog
  ipcMain.handle("dialog:open", async (_, opts) => {
    const result = await dialog.showOpenDialog(opts);
    if (result.canceled) return [];
    for (const p of result.filePaths) remember(p);
    return result.filePaths;
  });

  ipcMain.handle("dialog:save", async (_, opts) => {
    const result = await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return null;
    remember(result.filePath);
    return result.filePath;
  });

  // File system（利用者が選んだ道筋だけ）
  ipcMain.handle("fs:read", async (_, filePath: string) => {
    assertAllowed(filePath);
    return fs.readFile(filePath, "utf-8");
  });

  ipcMain.handle("fs:write", async (_, filePath: string, data: string) => {
    assertAllowed(filePath);
    await fs.writeFile(filePath, data, "utf-8");
  });

  // Notifications
  ipcMain.handle("notification:show", (_, title: string, body: string) => {
    new Notification({ title, body }).show();
  });

  // Window controls
  ipcMain.handle("window:minimize", () => getWindow()?.minimize());
  ipcMain.handle("window:maximize", () => {
    const win = getWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });
  ipcMain.handle("window:close", () => getWindow()?.close());
}
