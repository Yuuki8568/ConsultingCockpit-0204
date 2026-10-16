/**
 * 描画のどこかで例外が出たときに、画面ごと真っ暗に沈むのを防ぐ受け皿。
 * 原因の分からない「固まり」ではなく、何が起きたかと復帰の手段を必ず出す。
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorGuard extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    // 画面のどこで起きたかを後で追えるよう、控えを残しておく
    try {
      const log = {
        at: new Date().toISOString(),
        message: error.message,
        stack: (error.stack ?? "").slice(0, 2000),
        component: (info.componentStack ?? "").slice(0, 1200),
      };
      const prev = JSON.parse(localStorage.getItem("cockpit.lastError") ?? "[]");
      prev.unshift(log);
      localStorage.setItem("cockpit.lastError", JSON.stringify(prev.slice(0, 5)));
    } catch {
      /* 控えに失敗しても画面は出す */
    }
    // eslint-disable-next-line no-console
    console.error("[ErrorGuard]", error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0c0c0c] p-6">
        <div className="w-full max-w-[560px] rounded-sm border border-line bg-ink-700 p-6">
          <div className="mb-3 text-[15px] font-semibold text-paper">
            画面の表示で問題が起きました
          </div>
          <p className="text-[13px] leading-relaxed text-paper-dim">
            データは暗号化して保存されているため、この表示の問題で消えることはありません。
            下のボタンで読み込み直してください。
          </p>
          <div className="mt-4 rounded-sm border border-alert/30 bg-alert/8 px-3 py-2.5">
            <div className="font-mono text-[11px] leading-relaxed text-alert break-all">
              {error.message}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              読み込み直す
            </button>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard
                  .writeText(
                    `発生: ${new Date().toISOString()}\n${error.message}\n${(error.stack ?? "").slice(0, 1500)}`,
                  )
                  .catch(() => undefined);
              }}
            >
              エラー内容をコピー
            </button>
          </div>
          <p className="mt-4 border-t border-line pt-3.5 text-[11px] leading-relaxed text-paper-faint">
            直らない場合は、上の「エラー内容をコピー」で取った内容をそのまま送ってください。
            この端末の直近の控え（cockpit.lastError）にも同じ内容が残っています。
          </p>
        </div>
      </div>
    );
  }
}
