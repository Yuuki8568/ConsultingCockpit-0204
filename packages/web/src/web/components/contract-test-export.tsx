import { useState } from 'react';
import { Panel } from './kit';
import { APPROVED_TERMS_VERSION } from '../domain/data/contract-revisions';
import { buildContractTestBundle } from '../lib/export/contract-test';
import { downloadZip } from '../lib/export/zip';
import type { CaseRecord, VaultState } from '../domain/types';
export function ContractTestExport({c,state,sourceVersion}:{c:CaseRecord;state:VaultState;sourceVersion:string}) {
  const [testVersion, setTestVersion] = useState<"latest" | "current">("latest");
  const exportTestNine = () => {
    if (!window.confirm(`テスト出力版: ${testVersion === "latest" ? APPROVED_TERMS_VERSION : (c.contractTemplateVersion || "保存雛形・旧版の可能性あり")}\nテスト用・未記入・契約利用不可の9書類を出力します。選択中の雛形の照合用で、保存済み・署名済み本文の写しではありません。未入力は残し、採番・発行・承認・確認状態は変更しません。顧客への送付や契約には使用できません。出力しますか？`)) return;
    try {
      const bundle = buildContractTestBundle(c, state, sourceVersion, new Date(), testVersion);
      downloadZip(bundle.fileName, bundle.entries);
    } catch (e) {
      window.alert(`テスト出力を中止しました。保存内容は変更していません。\n${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
      <Panel title="照合専用のテスト出力" note="未記入でも9書類を出力できます。選択中の雛形を確認するための別コピーであり、正式発行・署名済み本文の書き出しではありません。下のテスト出力版だけを使用します。案件の契約版・保存済み本文は変更しません。">
        <label className="block mb-2 text-sm">テスト出力版<select className="field" value={testVersion} onChange={(e) => setTestVersion(e.target.value as "latest" | "current")}><option value="latest">最新承認版（{APPROVED_TERMS_VERSION}）</option><option value="current">案件で選択中の版（{c.contractTemplateVersion || "保存雛形・旧版の可能性あり"}）</option></select></label>
        <button className="btn btn-sm" onClick={exportTestNine}>契約書一式をテスト出力</button>
      </Panel>
  );
}
