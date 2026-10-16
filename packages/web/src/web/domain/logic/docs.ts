// 元アプリ v3 の書類採番・差し込み・雛形展開ロジックを移植（差し込みキーは一字一句同一）
import { DOC_TYPE_DEFS } from "../data/doc-templates";
import { SERVICE_MENU_ITEMS, buildServiceSummaryText } from "../data/service-menu";
import type { CaseRecord, VaultState } from "../types";

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
  const pricing: Any = (c.pricing && c.pricing.result) ? c.pricing.result : {};
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
    '成果物リスト': deliveredList||'プロンプト集／手順書／チェックリスト／運用台帳',
    '契約開始日': ex.contractStart||'',
    '契約終了日': ex.contractEnd||'',
    '契約期間月数': ex.contractType==='1m'?'1': ex.contractType==='3m'?'3': ex.contractType==='monthly'?'月額継続':'',
    '契約タイプ': ({ single:'単発', '1m':'1ヶ月', '3m':'3ヶ月', monthly:'月額継続' } as Any)[ex.contractType]||'',
    '月額固定報酬': (c.support&&c.support.contract&&c.support.contract.monthlyFee)||0,
    'スポット時間単価': pricing.adjusted ? Math.round(pricing.adjusted/40) : 0,
    '月内稼働時間': '時間制（個別協議）',
    '税抜金額': est.totalIncTax ? Math.round(est.totalIncTax/1.1) : (pricing.recommended ? Math.round(pricing.recommended/1.1) : 0),
    '消費税': est.totalIncTax ? Math.round(est.totalIncTax - est.totalIncTax/1.1) : 0,
    '税込金額': est.totalIncTax || pricing.recommended || 0,
    '支払締日': inv.billingDate||'', '支払期日': inv.dueDate||'',
    '初回契約期間月数': '6', '自動更新月数': '3', '更新拒絶予告日数': '30',
    '支払サイト日数': '60', '検収期間日数': '14', '賠償上限期間月数': '12',
    '見積番号': (c.legalDocs&&c.legalDocs.estimate&&c.legalDocs.estimate.docNo)||'',
    '発注請書番号': (c.legalDocs&&c.legalDocs.purchaseOrder&&c.legalDocs.purchaseOrder.docNo)||'',
    '検収書番号': (c.legalDocs&&c.legalDocs.deliveryReceipt&&c.legalDocs.deliveryReceipt.docNo)||'',
    '報告書番号': (c.legalDocs&&c.legalDocs.completionReport&&c.legalDocs.completionReport.docNo)||'',
    '見積有効期限': est.validUntil||'',
    '発行日': ymd, '検収日': '', '検収基準': 'みなし検収14日（業務委託契約書第7条準拠）',
    '契約締結日': ex.contractStart || ymd, '改訂日': ymd
  };
  // ④で選んだ支援メニューがあれば「支援内容」として差し込めるようにする
  const menuId = c.pricing && (c.pricing as Any).menuPick && (c.pricing as Any).menuPick.menuId;
  const menuItem = menuId ? SERVICE_MENU_ITEMS.find((m) => m.id === menuId) : null;
  ctx['支援内容'] = menuItem ? buildServiceSummaryText(menuItem) : '（④単価設計で支援メニューを選ぶと、ここに「何を・どれくらい・お渡しするもの・含まないもの」が自動で入ります）';
  return ctx;
}

export function fillTemplate(template: string, ctx: Record<string, string | number>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const filled = (template || '').replace(/\{\{([^}]+)\}\}/g, (_m: string, key: string) => {
    const k = key.trim();
    const v = ctx[k];
    if (v === undefined || v === null || v === '' || v === 0) {
      missing.add(k);
      return `[要入力:${k}]`;
    }
    return String(v);
  });
  return { text: filled, missing: Array.from(missing) };
}