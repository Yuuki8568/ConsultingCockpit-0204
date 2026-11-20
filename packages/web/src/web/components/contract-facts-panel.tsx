import { APPROVED_TERMS_VERSION } from '../domain/data/contract-latest';
import { SERVICE_SCOPE_LABELS, serviceScopeBlock } from '../domain/logic/service-scope';
import { Area, Field, Panel, Select, Note } from './kit';
import { CONTRACT_FACT_FIELDS, missingContractFacts } from '../domain/logic/contract-facts';
import type { CaseRecord, ContractFacts } from '../domain/types';

export function ContractFactsPanel({ c, onChange }: {c: CaseRecord; onChange: (facts: ContractFacts) => void}) {
 const facts = c.contractFacts ?? {};
 const missing = missingContractFacts(c);
 const update = (key: keyof ContractFacts, value: string) => onChange({ ...facts, [key]: value });
 return <div id="contract-conditions" tabIndex={-1}><Panel title="案件条件・情報管理票" note="A〜Dの共通方針は承認済みです。案件固有の事実は確認して記録してください。秘密鍵や顧客データ本文をここへ貼らず、合意文書ID・設定確認の記録等を用います。">
   <Note tone={missing.length ? 'warn' : 'info'}>{missing.length ? `正式出力前の確認が ${missing.length} 項目あります。入力は確認済みの事実・合意に限ります。` : '必要な記録欄が入力されています。法的適合性や契約成立を自動認定する表示ではありません。'}</Note>
   {c.contractTemplateVersion===APPROVED_TERMS_VERSION && <>
     <Select label="受託業務の区分（補助金の語だけで法的分類しない）" value={facts.serviceScopeClassification??''} onChange={v=>update('serviceScopeClassification',v)} options={[["","未確認"],...Object.entries(SERVICE_SCOPE_LABELS)]} />
     {serviceScopeBlock(c) && <Note tone="warn">{serviceScopeBlock(c)} NDA単独の秘密保持確認は可能ですが、NDAの作成・締結は対象外業務の受託許可ではありません。</Note>}
   </>}
   <Select label="取引目的" value={facts.transactionPurpose ?? ''} onChange={v=>update('transactionPurpose',v)} options={[["","未確認"],["business","事業目的のB2B"],["consumer","生活目的の個人取引（この版は適用しない）"]]} />
   <Select label="NDA賠償上限の適用関係" value={facts.ndaCapBasis ?? ''} onChange={v=>update('ndaCapBasis',v)} options={[["","未確認"],["main_contract","締結済み主契約のID・版・実際の締結日を参照"],["standalone","主契約未締結・NDA単独（個別上限合意必須）"]]} />
   <Select label="AI利用区分" value={facts.aiUse ?? ''} onChange={v=>update('aiUse',v)} options={[["","未確認"],["none","本案件では利用しない"],["processed","加工済み情報のみ"],["unprocessed","事前書面承諾・保護措置を確認して未加工入力"]]} />
   <Select label="賠償上限算定で実入金0円となる場合" value={facts.zeroLiability ?? ''} onChange={v=>update('zeroLiability',v)} options={[["","未確認"],["nonzero","0円に該当しないことを確認（下欄に根拠）"],["zero_or_possible","0円又は可能性あり（個別上限合意が必要）"]]} />
   <Field label="確認済みの発注日（発注請書を出す場合）" type="date" value={facts.orderReceivedOn ?? ""} onChange={v=>update("orderReceivedOn",v)} hint="発行日から自動補完しません。実際の発注記録を確認してください。" />
   {CONTRACT_FACT_FIELDS.map(([key,label]) => {
     if (['serviceRequestSummary','serviceScopeReviewEvidence'].includes(key) && c.contractTemplateVersion!==APPROVED_TERMS_VERSION) return null;
     if (key === 'aiServiceRecord' && facts.aiUse === 'none') return null;
     if (['aiConsentEvidence','aiProtectionEvidence'].includes(key) && facts.aiUse !== 'unprocessed') return null;
     if (key === 'individualCapAgreement' && facts.zeroLiability !== 'zero_or_possible' && facts.ndaCapBasis !== 'standalone') return null;
     return <Area key={key} label={label} rows={3} value={facts[key] ?? ''} onChange={v=>update(key,v)} />;
   })}
   <p className="text-xs">条件を追記した後は該当書類を再生成し、保存された本文と版を確認してください。既存の署名済み本文は更新しません。NDA単独の作成では報酬・成果物の記録は必須にしません。</p>
 </Panel></div>;
}
