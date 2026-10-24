import { unresolvedContractMarkers } from '../domain/logic/contract-placeholders';
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
  const missing = doc.readOnly ? [] : unresolvedContractMarkers(content);

  return (
    <Modal
      open
      onClose={() => docViewer.close()}
      title={`${doc.title}　${doc.docNo}`}
      wide
      footer={
        <>
          {missing.length === 0 && !doc.releaseBlocked && <CopyButton text={content} label="本文をコピー" />}
          <button
            className="btn btn-primary btn-sm"
            disabled={Boolean(doc.releaseBlocked) || missing.length > 0}
            onClick={() =>
              missing.length === 0 && !doc.releaseBlocked && downloadWord({
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
        {doc.releaseBlocked && <Note tone="warn">{doc.releaseBlocked} この書類は現時点では画面内レビュー専用です。本文編集だけでは解除されません。新版の案件事実による制限は、画面を閉じて「本文・条件を再確認」で確認できます。</Note>}
        {missing.length > 0 && (
          <Note tone="warn">
            未入力・未確認の仮欄が {missing.length} か所あります（要入力欄、○日・○回、［要確認…］など）。
            ①案件設定と設定画面の受託者プロフィールを埋めると自動で入ります。
          </Note>
        )}
        <textarea
          className="field font-body max-h-[58vh] min-h-[380px] resize-y text-[13px] leading-[1.9]"
          readOnly={doc.readOnly}
          value={content}
          onChange={(e) => docViewer.setContent(e.target.value)}
        />
        <p className="text-[11px] text-paper-faint">
          {doc.readOnly ? "締結済み本文のため閲覧・出力のみです。" : doc.templateVersion ? `版 ${doc.templateVersion}。本文の編集は保存されますが、案件条件の不足は案件条件・情報管理票で確認後に再生成してください。公開版が変わってもこの本文は自動更新しません。` : "ここで直した内容は保存されます。旧版雛形そのものを直す場合は、設定画面の書類雛形から編集してください。"}
        </p>
      </div>
    </Modal>
  );
}
