/**
 * 書類ビューア専用ストア（メモリのみ。金庫とは完全に独立）。
 *
 * なぜ分けるか:
 * これまで表示モーダルは「金庫 state の中から id で書類を探す」方式だった。
 * 同期で state が作り直される瞬間や、タブの再マウント（currentTab が
 * 同期経由で切り替わる等）があると、モーダルが持つ id ごと消え、
 * エラーも出ずに「作るを押しても何も出ない」状態になっていた。
 * （監査ログには doc_generate が残る = 生成自体は成功している）
 *
 * ここでは「開いた瞬間のスナップショット」を金庫とは別のメモリに保持し、
 * モーダルはここだけを見て描画する。金庫の再構築・タブ切替・同期の
 * タイミングに一切依存しないため、同じ種類の消失は起きない。
 *
 * 編集内容は金庫へデバウンス保存するが、保存の成否と表示は切り離す。
 * 内容はメモリ上にのみ保持し、localStorage 等には書かない。
 */
import { trace } from "../trace";

export interface DocViewerDoc {
  docId: string;
  caseId: string;
  /** 表示名（例: 業務委託契約書） */
  title: string;
  docNo: string;
  /** 書き出しファイル名用の会社名 */
  company: string;
}

/** 金庫側への保存関数（案件内の当該書類の content を更新する） */
export type DocPersistFn = (content: string) => void;

class DocViewerStore {
  private listeners = new Set<() => void>();
  private doc: DocViewerDoc | null = null;
  private content = "";
  private persistFn: DocPersistFn | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  getDoc(): DocViewerDoc | null {
    return this.doc;
  }

  getContent(): string {
    return this.content;
  }

  /** 書類を開く。内容は呼び出し時点のスナップショットを保持する */
  open(doc: DocViewerDoc, content: string, persist: DocPersistFn): void {
    // 前に開いていた書類の未保存分を先に流し切る
    this.flushPersist();
    this.doc = doc;
    this.content = content;
    this.persistFn = persist;
    trace("doc_open", { docId: doc.docId });
    this.emit();
  }

  /** 編集のたびに表示を更新し、金庫への保存は800msデバウンスで行う */
  setContent(next: string): void {
    this.content = next;
    this.emit();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flushPersist(), 800);
  }

  /**
   * 編集中の内容を金庫へ書き戻す。
   * 表示とは切り離しているので、保存が失敗しても画面は維持する。
   */
  private flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.doc || !this.persistFn) return;
    try {
      this.persistFn(this.content);
      trace("doc_persist", { docId: this.doc.docId });
    } catch (e) {
      trace("doc_persist_fail", {
        docId: this.doc.docId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  close(): void {
    if (!this.doc) return;
    this.flushPersist();
    trace("doc_close", { docId: this.doc.docId });
    this.doc = null;
    this.content = "";
    this.persistFn = null;
    this.emit();
  }

  /**
   * 金庫の施錠・サインアウト時の破棄。保存は行わず、本文と参照をすべて捨てる。
   * （施錠後にデバウンス保存が走って平文を書き戻すことを防ぐため、
   *   保留中のタイマーもここで止める）
   */
  discard(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.doc) return;
    trace("doc_discard", { docId: this.doc.docId });
    this.doc = null;
    this.content = "";
    this.persistFn = null;
    this.emit();
  }
}

export const docViewer = new DocViewerStore();
