/**
 * 書類の表示・編集モーダル。
 *
 * 描画に必要なものはすべて DocViewerStore（開いた瞬間のスナップショット）
 * から読む。金庫 state を参照しないので、同期による state 再構築や
 * タブの再マウントが起きても開いたまま維持される。
 * アプリのルート（app.tsx）に1つだけマウントする。
 */
import { useEffect, useReducer } from "react";
import { CopyButton, Modal, Note } from "./kit";
import { docViewer } from "../lib/store/doc-viewer-store";
import { vaultStore } from "../lib/store/vault-store";
import { downloadWord } from "../lib/export/word";
import { safeFileName } from "../domain/logic/util";

export function DocViewerModal() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => docViewer.subscribe(bump), []);

  const doc = docViewer.getDoc();
  if (!doc) return null;
  // 施錠されるとストアは空になりこのモーダルは閉じる。
  // 万が一内容が残っていた場合でも、施錠中は表示・コピー・書き出しを行わない。
  if (!vaultStore.isUnlocked()) return null;
  const content = docViewer.getContent();
  const missing = content.match(/\[要入力:[^\]]+\]/g) ?? [];

  return (
    <Modal
      open
      onClose={() => docViewer.close()}
      title={`${doc.title}　${doc.docNo}`}
      wide
      footer={
        <>
          <CopyButton text={content} label="本文をコピー" />
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              downloadWord({
                title: doc.title,
                docNo: doc.docNo,
                body: content,
                fileName: `${safeFileName(doc.company || "無題")}_${doc.title}_${doc.docNo}.doc`,
              })
            }
          >
            Word で書き出す
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {missing.length > 0 && (
          <Note tone="warn">
            空欄が {missing.length} か所あります（［要入力:…］と表示されている部分）。
            ①案件設定と設定画面の受託者プロフィールを埋めると自動で入ります。
          </Note>
        )}
        <textarea
          className="field font-body max-h-[58vh] min-h-[380px] resize-y text-[13px] leading-[1.9]"
          value={content}
          onChange={(e) => docViewer.setContent(e.target.value)}
        />
        <p className="text-[11px] text-paper-faint">
          ここで直した内容は保存されます。雛形そのものを直したい場合は、設定画面の書類雛形から編集してください。
        </p>
      </div>
    </Modal>
  );
}
