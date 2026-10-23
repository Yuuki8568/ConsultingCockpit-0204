// 元アプリ v3 の書類採番・差し込み・雛形展開ロジックを移植（差し込みキーは一字一句同一）
import { APPROVED_TERMS_VERSION } from "../data/approved-terms";
import { contractFactsContext, missingContractFacts } from "./contract-facts";
import { grossTaxBreakdown } from "./tax";
import { DOC_TYPE_DEFS } from "../data/doc-templates";
import { SERVICE_MENU_ITEMS, buildServiceSummaryText } from "../data/service-menu";
import type { CaseRecord, VaultState, DocStatus } from "../types";

type Any = any;

export function generateDocNo(docType: string, state: VaultState): string {
  const def: Any = (DOC_TYPE_DEFS as Any)[docType] || { code:'DOC' };
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2,'0');
  const datePrefix = `${def.code}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  // 同日同種の最大連番+1
  let max = 0;
  (state.cases || []).forEach((c) => (c.generatedDocs||[]).forEach((g) => {
    if (g.docNo && g.docNo.startsWith(datePrefix)) {
      const n = parseInt(g.docNo.slice(datePrefix.length+1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }));
  return `${datePrefix}-${String(max+1).padStart(3,'0')}`;
}

export function gatherTemplateContext(c: CaseRecord, state: VaultState): Record<string, string | number> {
  const p: Any = state.profile || {};
  const s: Any = c.settings || {};
  const k: Any = s.kakuyaku || {};
  const ex: Any = c.execution || {};
  const est: Any = c.estimate || {};
  const inv: Any = c.invoice || {};
  const tax = Number.isSafeInteger(est.totalIncTax) && est.totalIncTax > 0 ? grossTaxBreakdown(est.totalIncTax, 10) : null;
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2,'0');
  const ymd = `${today.getFullYear()}/${pad(today.getMonth()+1)}/${pad(today.getDate())}`;
  // 成果物リスト（納品済みのみ）
  const deliveredList = (ex.deliverables||[]).filter((d: Any) => d.status==='delivered').map((d: Any) => d.name).join('、');
  // v5.3: 業種・規模の日本語ラベル
  const INDUSTRY_JA: Any = { manufacturing:'製造業', retail:'小売業', service:'サービス業', it:'IT・情報通信', legal:'士業', medical:'医療・介護', education:'教育', finance:'金融', construction:'建設・不動産', logistics:'物流', general:'一般' };
  const SIZE_JA: Any = { small:'小規模（〜30名）', medium:'中規模（30〜300名）', large:'大規模（300名超）' };
  const ctx: Record<string, string | number> = {
    // ===== 乙（自分）情報 =====
    '乙氏名': p.name||'', '乙屋号': p.yago||'', '乙URL': p.url||'',
    '乙ポートフォリオ': p.url||'',
    '乙住所': p.address||'', '乙メール': p.email||'',
    '乙インボイス番号': p.invoice||'', '乙口座': p.bank||'',
    // ===== 甲（クライアント）情報 — v5.3で網羅 =====
    '甲企業名':        s.companyName||'',
    '甲住所':          k.companyAddress||'',
    '甲代表者':        k.representative||'',
    '甲代表者肩書':    k.representativeTitle||'代表取締役',
    '甲担当者':        k.contact||'',
    '甲担当部署':      k.contactDept||'',
    '甲担当役職':      k.contactTitle||'',
    '甲メール':        k.contactEmail||'',
    '甲電話':          k.contactPhone||'',
    '甲URL':           k.website||'',
    '甲業種':          k.industryLabel || INDUSTRY_JA[s.industry] || '',
    '甲規模':          k.sizeLabel     || SIZE_JA[s.size]         || '',
    '甲ハラスメント窓口': k.harassmentContact||'',
    '案件名': String(c.name ?? '')||s.companyName||'',
    '業務範囲': s.knownInfo||'',
    '成果物リスト': deliveredList,
    '契約開始日': ex.contractStart||'',
    '契約終了日': ex.contractEnd || (c.contractTemplateVersion && ex.contractType === 'monthly' ? '月額自動更新。終了条件は案件条件票による' : ''),
    '契約期間月数': ex.contractType==='1m'?'1': ex.contractType==='3m'?'3': ex.contractType==='monthly'?'月額継続':'',
    '契約タイプ': ({ single:'単発', '1m':'1ヶ月', '3m':'3ヶ月', monthly:'月額継続' } as Any)[ex.contractType]||'',
    '月額固定報酬': c.support?.contract?.monthlyFee ? (c.contractTemplateVersion ? Math.round(c.support.contract.monthlyFee * 1.1) : c.support.contract.monthlyFee) : '',
    'スポット時間単価': '', // 合意済み時間単価の保存欄がないため、参考額÷40では推定しない。,
    '月内稼働時間': '時間制（個別協議）',
    '税抜金額': tax?.net ?? '',
    '消費税': tax?.tax ?? '',
    '税込金額': tax?.gross ?? '',
    '支払締日': inv.billingDate||'', '支払期日': inv.dueDate||'',
    '初回契約期間月数': c.contractTemplateVersion ? '' : '6', '自動更新月数': c.contractTemplateVersion ? '1' : '3', '更新拒絶予告日数': c.contractTemplateVersion ? '' : '30',
    '支払サイト日数': c.contractTemplateVersion ? '14' : '60', '検収期間日数': '14', '賠償上限期間月数': c.contractTemplateVersion ? '3' : '12',
    '見積番号': (c.legalDocs&&c.legalDocs.estimate&&c.legalDocs.estimate.docNo)||'',
    '発注請書番号': (c.legalDocs&&c.legalDocs.purchaseOrder&&c.legalDocs.purchaseOrder.docNo)||'',
    '検収書番号': (c.legalDocs&&c.legalDocs.deliveryReceipt&&c.legalDocs.deliveryReceipt.docNo)||'',
    '報告書番号': (c.legalDocs&&c.legalDocs.completionReport&&c.legalDocs.completionReport.docNo)||'',
    '見積有効期限': est.validUntil||'',
    '発行日': ymd, '検収日': '', '検収基準': 'みなし検収14日（業務委託契約書第7条準拠）',
    '契約締結日': c.legalDocs?.mainContract?.signedAt || '', '改訂日': ''
  };
  // ④で選んだ支援メニューがあれば「支援内容」として差し込めるようにする
  const menuId = c.pricing && (c.pricing as Any).menuPick && (c.pricing as Any).menuPick.menuId;
  const menuItem = menuId ? SERVICE_MENU_ITEMS.find((m) => m.id === menuId) : null;
  ctx['支援内容'] = menuItem ? buildServiceSummaryText(menuItem) : '（④単価設計で支援メニューを選ぶと、ここに「何を・どれくらい・お渡しするもの・含まないもの」が自動で入ります）';
  if (c.contractTemplateVersion) ctx['支援内容'] = c.contractFacts?.scopeAndDeliverables ?? '';
  return { ...ctx, ...contractFactsContext(c) };
}

export function fillTemplate(template: string, ctx: Record<string, string | number>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const filled = (template || '').replace(/\{\{([^}]+)\}\}/g, (_m: string, key: string) => {
    const k = key.trim();
    const v = ctx[k];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      missing.add(k);
      return `[要入力:${k}]`;
    }
    return String(v);
  });
  return { text: filled, missing: Array.from(missing) };
}
/** 採番した番号を、保存する本文にも同じ値で差し込む。元の context は変えない。 */
export function contextWithDocNo(
  ctx: Record<string, string | number>, docType: string, docNo: string,
): Record<string, string | number> {
  const fields: Record<string, string> = {
    estimate: "見積番号", purchaseOrder: "発注請書番号",
    deliveryReceipt: "検収書番号", completionReport: "報告書番号",
  };
  return fields[docType] ? { ...ctx, '当該文書番号': docNo, [fields[docType]]: docNo } : { ...ctx, '当該文書番号': docNo };
}

/** 保存済みの指定番号を選ぶだけ。テンプレートの再生成、再採番、状態変更は禁止。 */
export function savedDocumentsForExport(c: CaseRecord, docTypes: readonly string[]) {
  const selected = [] as CaseRecord["generatedDocs"];
  const errors: string[] = [];
  const numbers = new Set<string>();
  for (const docType of docTypes) {
    const def = (DOC_TYPE_DEFS as Record<string, { jp: string; pickKey: string | null }>)[docType];
    const entry = c.legalDocs[def?.pickKey ?? docType];
    if (entry?.status === "na") continue;
    const no = entry?.docNo;
    if (!no || no.trim() !== no || (/[\\/:*?"<>|]/.test(no) || [...no].some((ch) => ch.charCodeAt(0) < 32))) {
      errors.push(`${def?.jp ?? docType}: 保存済み書類番号を確認してください。`);
      continue;
    }
    const matches = c.generatedDocs.filter((d) => d.docType === docType && d.docNo === no);
    if (matches.length !== 1) {
      errors.push(`${def?.jp ?? docType}: 番号 ${no} に一致する保存済み本文が一意に見つかりません。`);
      continue;
    }
    const doc = matches[0]!;
    const releaseBlock = documentReleaseBlock(c, doc);
    if (releaseBlock) {
      errors.push(`${def?.jp ?? docType}: ${releaseBlock}`);
      continue;
    }
    if (typeof doc.content !== "string" || doc.content.trim() === "") {
      errors.push(`${def?.jp ?? docType}: 保存済み本文が空です。`);
      continue;
    }
    if (numbers.has(no)) {
      errors.push(`${def?.jp ?? docType}: 書類番号 ${no} が重複しています。`);
      continue;
    }
    numbers.add(no);
    selected.push({ ...doc });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  if (!selected.length) throw new Error("書き出す保存済み書類がありません。");
  return selected;
}

/** 管理上の締結済み本文を、この画面から編集・再生成しないための保護。 */
export function isSignedDocument(c: CaseRecord, doc: { docType: string; docNo: string; status?: string }): boolean {
  const def = (DOC_TYPE_DEFS as Record<string, { pickKey: string | null }>)[doc.docType];
  const entry = c.legalDocs[def?.pickKey ?? doc.docType];
  return doc.status === "signed" || Boolean(entry?.status === "signed" && entry.docNo === doc.docNo);
}

/** 先頭行の「見る」も ZIP と同じ保存番号を参照する。履歴は別に表示する。 */
export function referencedDocument(c: CaseRecord, docType: string) {
  const def = (DOC_TYPE_DEFS as Record<string, { pickKey: string | null }>)[docType];
  const no = c.legalDocs[def?.pickKey ?? docType]?.docNo;
  const matches = c.generatedDocs.filter((g) => g.docType === docType && g.docNo === no);
  return matches.length === 1 ? matches[0] : undefined;
}

/** 明示的な状態変更のみを許可し、締結済みのラッチを下げない。 */
export function changeDocumentStatus(c: CaseRecord, docType: string, status: DocStatus): string | null {
  const def = (DOC_TYPE_DEFS as Record<string, { pickKey: string | null }>)[docType];
  const key = def?.pickKey ?? docType;
  const entry = c.legalDocs[key];
  const saved = referencedDocument(c, docType);
  if (entry?.status === "signed" || (saved && isSignedDocument(c, saved))) return "締結済みの状態は変更できません。";
  if ((status === "signed" || status === "sent") && saved?.releaseBlocked) return saved.releaseBlocked;
  if ((status === "signed" || status === "sent") && c.contractTemplateVersion === APPROVED_TERMS_VERSION) {
    if (!saved || saved.templateVersion !== APPROVED_TERMS_VERSION || !saved.content?.trim()) return "承認版の保存済み本文を確認してから送付・締結を記録してください。";
    if (missingContractFacts(c, docType).length || /\[要入力:[^\]]+\]/.test(saved.content)) return "案件の未確認・未入力を解消し、保存済み本文を確認してください。";
  }
  const date = entry?.signedAt ?? "";
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (status === "signed" && (!saved || typeof saved.content !== "string" || !saved.content.trim() || !saved.docNo.trim() || !validDate)) return "保存済み本文と実際の締結日を確認してから締結済みにしてください。";
  c.legalDocs[key] ??= { status: "todo", signedAt: "", docNo: "" };
  if (status === "signed" && saved) saved.status = "signed";
  c.legalDocs[key]!.status = status;
  return null;
}

export function changeDocumentSignedAt(c: CaseRecord, docType: string, signedAt: string): string | null {
  const def = (DOC_TYPE_DEFS as Record<string, { pickKey: string | null }>)[docType];
  const key = def?.pickKey ?? docType;
  const entry = c.legalDocs[key];
  const saved = referencedDocument(c, docType);
  if (entry?.status === "signed" || (saved && isSignedDocument(c, saved))) return "締結済みの日付は変更できません。";
  c.legalDocs[key] ??= { status: "todo", signedAt: "", docNo: "" };
  c.legalDocs[key]!.signedAt = signedAt;
  return null;
}

/** 保存時の制限は消さず、未締結の新版は現在の未確認事実も出力前に確認する。 */
export function documentReleaseBlock(c: CaseRecord, doc: CaseRecord['generatedDocs'][number]): string | undefined {
  if (doc.releaseBlocked) return doc.releaseBlocked;
  if (doc.templateVersion === APPROVED_TERMS_VERSION && !isSignedDocument(c, doc)) {
    if (missingContractFacts(c, doc.docType).length || /\[要入力:[^\]]+\]/.test(doc.content)) return '案件の未確認・未入力を解消してから正式出力してください。';
  }
  return undefined;
}
