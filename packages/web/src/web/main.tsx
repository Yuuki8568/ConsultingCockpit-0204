// Entry point referenced by index.html — composition only, real bootstrap
// lives in __main.tsx (template-managed).


// 描画以外で起きた例外（イベント処理・非同期）も控えに残す。
// 「固まったように見えるが原因が分からない」を、あとから追える状態にしておく。
function recordError(kind: string, message: string, stack: string): void {
  try {
    const prev = JSON.parse(localStorage.getItem("cockpit.lastError") ?? "[]");
    prev.unshift({
      at: new Date().toISOString(),
      kind,
      message: String(message).slice(0, 500),
      stack: String(stack).slice(0, 1500),
    });
    localStorage.setItem("cockpit.lastError", JSON.stringify(prev.slice(0, 5)));
  } catch {
    /* 記録に失敗しても本体の動作は変えない */
  }
}
window.addEventListener("error", (e) => {
  recordError("window.onerror", e.message ?? "", e.error?.stack ?? "");
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  recordError(
    "unhandledrejection",
    r instanceof Error ? r.message : String(r ?? ""),
    r instanceof Error ? (r.stack ?? "") : "",
  );
});

// 戻ってきた管理サインインを、画面を出す前に一度だけ完了させる


import "./__main";
