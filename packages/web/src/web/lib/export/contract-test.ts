/** Read-only template inspection. Never issues documents or updates a case/vault. */
import type { CaseRecord, VaultState } from '../../domain/types';
import { APPROVED_TERMS_TEMPLATES, APPROVED_TERMS_VERSION } from '../../domain/data/approved-terms';
import { DOC_TYPE_DEFS } from '../../domain/data/doc-templates';
import { fillTemplate, gatherTemplateContext } from '../../domain/logic/docs';
import { missingContractFacts } from '../../domain/logic/contract-facts';
import { buildWordHtml } from './word';
import type { ZipEntry } from './zip';

export const TEST_NOTICE = 'テスト用・未記入・契約利用不可';
export const TEST_DOC_TYPES = ['nda','estimate','purchaseOrder','mainContract','aiAddendum','dpa','deliveryReceipt','completionReport','disclaimer'] as const;

export function buildContractTestBundle(c: CaseRecord, state: VaultState, sourceVersion: string, now = new Date(), testVersion: 'current' | 'latest' = 'current'): { fileName: string; entries: ZipEntry[] } {
  const storedVersion = c.contractTemplateVersion || '未選択';
  if (testVersion === 'latest') c = { ...c, contractTemplateVersion: APPROVED_TERMS_VERSION };
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const version = c.contractTemplateVersion || '未選択（保存雛形・旧版の可能性あり）';
  const templates = c.contractTemplateVersion === APPROVED_TERMS_VERSION ? APPROVED_TERMS_TEMPLATES : state.docTemplates;
  const ctx = gatherTemplateContext(c, state);
  // Existing formal renderer has a representative-title default; test output must not invent it.
  ctx['甲代表者肩書'] = c.settings?.kakuyaku?.representativeTitle || '';
  // Test copies have no official document numbers and never allocate one.
  for (const key of ['当該文書番号','見積番号','発注請書番号','検収書番号','報告書番号']) ctx[key] = '';
  const meta = `${TEST_NOTICE}\n生成日時（UTC）: ${now.toISOString()}\nソース版: ${sourceVersion}\nテスト出力の契約雛形版: ${version}\n案件に保存された版（変更なし）: ${storedVersion}`;
  const report = [meta, '保存済み・署名済み本文ではなく、選択中の雛形を照合するための別コピーです。保存内容・採番・発行・承認・確認状態は変更していません。顧客情報を含む場合があります。外部共有不可。', '未確認・未入力の一覧（網羅的な法的審査ではありません）'];
  const entries: ZipEntry[] = TEST_DOC_TYPES.map((key, i) => {
    const title = DOC_TYPE_DEFS[key].jp;
    const template = templates[key];
    if (!template?.trim()) throw new Error(`${title}の雛形がありません。別の版への自動置換は行いません。`);
    const filled = fillTemplate(template, ctx);
    const markers = filled.text.match(/\[要入力:[^\]]+\]|［要確認[^］]*］|\{\{[^}]+\}\}|[^\n]*○[^\n]*/g) ?? [];
    const missing = [...new Set([...filled.missing, ...missingContractFacts(c, key), ...markers])];
    report.push(`\n【${title}】\n${missing.map(v => `・${v}`).join('\n') || '検出なし（確認済みを意味しません）'}`);
    return {name: `TEST_${stamp}_${String(i+1).padStart(2,'0')}_${title}.doc`, content: buildWordHtml({title:`${TEST_NOTICE} — ${title}`, meta, body:filled.text, footer:TEST_NOTICE, fileName:''})};
  });
  entries.unshift({name:`TEST_${stamp}_00_未確認一覧と出力条件.txt`, content:report.join('\n\n')});
  return {fileName:`TEST_契約書一式_契約利用不可_${stamp}.zip`, entries};
}
