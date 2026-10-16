// 元アプリ v3 の単価設計ロジックを移植（計算式は同一）
import {
  CLIENT_SIZE_COEF,
  DECISION_ADD,
  DELIVERABLE_LABELS,
  EXPERIENCE_COEF,
  INDUSTRY_TO_PRICING,
  PAYMENT_ADD,
  SCOPE_RISK_ADD,
  SIZE_TO_PRICING,
  URGENCY_COEF,
} from "../data/flow-pricing";
import type {
  CaseRecord,
  PricingAlert,
  PricingInputs,
  PricingResult,
  Profile,
} from "../types";
import { buildComplianceFooter } from "./compliance";

type Any = any;

export const roundToThousand = (n: number): number => Math.round(n / 1000) * 1000;
export const formatYen = (n: number): string => n.toLocaleString("ja-JP");

export function buildPricingDefaults(c: CaseRecord): PricingInputs {
  const s: Any = c.settings || {};
  const m: Any = c.memo || {};
  const f: Any = c.flowAnalysis;
  const keywords = (s.keywords || '').split(/[,、]/).map((k: string) => k.trim()).filter((k: string) => k);
  const projectTitle = keywords.length > 0
    ? `${s.companyName || '無題'}向け ${keywords[0]}改善プロジェクト`
    : `${s.companyName || '無題'}向け プロジェクト`;
  // 業務フロー分析の工数推定から想定総工数を算出
  // As-Is時間（分）→ コンサルタント工数（時間） = 時間 / 60 × 0.3
  // ただし最低10h、最大500h
  let hours = 40;
  let hoursFromFlow = false;
  if (f && f.result && f.result.gap) {
    const flowHours = Math.round(f.result.gap.asisTime / 60 * 0.3);
    hours = Math.max(10, Math.min(500, flowHours));
    hoursFromFlow = true;
  }
  let competitor = 0;
  if (m.budget) {
    const t = String(m.budget);
    if (/1000|1,000|千万/.test(t)) competitor = 10000000;
    else if (/500/.test(t)) competitor = 5000000;
    else if (/100/.test(t)) competitor = 1000000;
  }
  return {
    projectTitle, hours, hoursFromFlow,
    clientSize: (SIZE_TO_PRICING as Any)[s.size] || 'small',
    industry: (INDUSTRY_TO_PRICING as Any)[s.industry] || 'other',
    duration: 'mid', urgency: 'normal', difficulty: 3, domains: 2, experience: 'yes',
    deliverables: ['analysis', 'prompts'],
    decisionMakers: 'one', scopeRisk: 'low', payment: 'immediate',
    baseline: 10000, competitor
  };
}

export function calculatePricing(d: PricingInputs): PricingResult {
  const base = d.hours * d.baseline;
  const difficultyCoef = 1.0 + (d.difficulty - 3) * 0.15;
  const urgencyCoef = (URGENCY_COEF as Any)[d.urgency] as number;
  const scopeAdd = (SCOPE_RISK_ADD as Any)[d.scopeRisk] as number;
  const paymentAdd = (PAYMENT_ADD as Any)[d.payment] as number;
  const decisionAdd = (DECISION_ADD as Any)[d.decisionMakers] as number;
  const riskCoef = 1.0 + scopeAdd + paymentAdd + decisionAdd;
  const sizeCoef = (CLIENT_SIZE_COEF as Any)[d.clientSize] as number;
  const expCoef = (EXPERIENCE_COEF as Any)[d.experience] as number;
  const deliverableCount = d.deliverables.length;
  const deliverableAdd = deliverableCount * base * 0.05;
  const adjusted = base * difficultyCoef * urgencyCoef * riskCoef * sizeCoef * expCoef + deliverableAdd;
  return {
    base, difficultyCoef, urgencyCoef, scopeAdd, paymentAdd, decisionAdd,
    riskCoef, sizeCoef, expCoef, deliverableCount, deliverableAdd, adjusted,
    safe: roundToThousand(adjusted * 0.85),
    recommended: roundToThousand(adjusted * 1.00),
    challenge: roundToThousand(adjusted * 1.25)
  };
}

export function generateTalk(d: PricingInputs, c: PricingResult): string {
  const deliverableText = d.deliverables.length > 0
    ? d.deliverables.map((k) => (DELIVERABLE_LABELS as Any)[k]).join('・') : '本プロジェクトのコア成果物';
  const expectedSavingHours = d.hours * 5;
  const savingMoney = expectedSavingHours * 3000;
  const difficultyDesc = d.difficulty >= 4 ? '高度な専門判断と複数領域の統合設計が必要なため、'
    : d.difficulty === 3 ? '標準的な業務改善案件として、' : '比較的定型的な作業中心ですが、';
  const riskNote = c.riskCoef > 1.10
    ? `また、スコープ変動や決裁プロセスの複雑さを織り込み、約${Math.round((c.riskCoef-1)*100)}%のリスクバッファを乗せています。` : '';
  const safeText = `もしご予算面でお迷いがありましたら、スコープを絞った【堅実プラン：¥${formatYen(c.safe)}】もご用意できます。`;
  return `【${d.projectTitle}】の単価について、率直にお伝えします。

今回のご依頼は、${difficultyDesc}想定総工数 約${d.hours}時間で、${deliverableText}をお届けする内容です。これに対し、推奨単価は ¥${formatYen(c.recommended)}（税抜）とさせていただきます。

この金額は、私の時給ベース（¥${formatYen(d.baseline)}/h）に、難易度・スコープ・体制リスクを加味して算出した、透明性のある積算です。${riskNote}

投資対効果の観点では、本プロジェクトの仕組みが定着すれば、年間で約${expectedSavingHours.toLocaleString('ja-JP')}時間（金額換算で約¥${formatYen(savingMoney)}相当）の業務削減効果が見込まれます。初期投資としてご検討いただける水準かと考えております。

${safeText}まずはどのレンジでご検討されたいか、お聞かせいただけると幸いです。`;
}

export function buildAlerts(d: PricingInputs, c: PricingResult): PricingAlert[] {
  const alerts: PricingAlert[] = [];
  if (d.payment === 'long') alerts.push({ title:'支払いサイト長め', body:'60日以上の支払いサイトが設定されています。8%の上乗せをリスク係数に反映済み。運用の基本は前払い（入金確認後に着手）です。後払いが必要な場合は、着手金として一部前払いにする交渉を検討してください。' });
  else if (d.payment === 'monthly') alerts.push({ title:'支払サイト確認', body:'月末締め翌月払いを選択。3%の上乗せを反映済み。運用の基本は前払い（入金確認後に着手）です。後払いにする場合、支払期日は給付を受領した日から起算します（取適法）。' });
  if (d.decisionMakers === 'many') alerts.push({ title:'意思決定者多数', body:'4名以上の意思決定者が想定されます。稟議期間として通常+2〜4週間を見込み、提案書に全関係者FAQを準備しましょう。' });
  if (d.urgency === 'super') alerts.push({ title:'超特急案件', body:'業界標準では20〜30%の急ぎ料金が一般的（30%反映済み）。機会損失も明示し価格根拠を補強。' });
  else if (d.urgency === 'hurry') alerts.push({ title:'急ぎ案件', body:'15%の上乗せを反映済み。並行案件の優先順位調整が必要な旨をクライアントに伝えると納得感が増します。' });
  if (d.scopeRisk === 'high') alerts.push({ title:'スコープ変更リスク高', body:'契約書に「スコープ変更時の追加費用条項」を必ず明記。20%のリスク係数を反映済み。' });
  if (d.experience === 'no') alerts.push({ title:'初挑戦領域', body:'学習コストとして15%の上乗せを反映済み。' });
  if (d.difficulty >= 4 && d.deliverables.length <= 2) alerts.push({ title:'高難度なのに成果物が少なめ', body:'中間成果物（分析メモ・議事録等）を追加すると価格の納得感が高まります。' });
  if (d.competitor > 0 && c.recommended > d.competitor * 1.5) alerts.push({ title:'競合比で高水準', body:`推奨プラン ¥${formatYen(c.recommended)} は競合の約${Math.round(c.recommended/d.competitor*100)}%。差額の正当性を説明できる資料が必要です。` });
  else if (d.competitor > 0 && c.recommended < d.competitor * 0.7) alerts.push({ title:'競合比で低水準', body:`推奨プランが競合の${Math.round(c.recommended/d.competitor*100)}%。価格上振れの検討余地あり。` });
  if (alerts.length === 0) alerts.push({ title:'特記事項なし', body:'主要なリスク項目に大きな偏りはありません。' });
  return alerts;
}


export function buildPatterns(lead: Any, profile: Profile) {
  const company = lead.company || '【企業名】';
  const dept = lead.dept || '【部署名】';
  const name = lead.name || '【ご担当】';
  const contact = lead.contact || '貴社の取り組みに関する公開情報';
  const hypothesis = lead.hypothesis || '貴社の業務改善テーマ';
  const industry = lead.industry || '貴業界';
  const sig = buildComplianceFooter(profile);
  return [
    {
      no: 1, label: '堅実版（信頼性・実績訴求型）',
      subjects: ['【ご相談】AIで業務改善を「30分で実装」する取り組みについて', '業務改善の実装スピードに関するご提案（山代）'],
      body: `${company}\n${dept} ${name}様\n\n突然のご連絡を失礼いたします。\nAI業務改善コンサル支援を行っております、山代悠生と申します。\n\n${contact}を拝見し、\n${hypothesis}に関心を持ちご連絡いたしました。\n\n私の活動の特徴は「業務課題を見つけたら30分でアプリにして解決する」点にあります。\n構想やPoCで止めず、現場で動くツールに落とし込むことを重視しております。\n\nもしご関心があれば、15〜30分ほどお時間をいただき、\n${name}様の業務改善テーマについて意見交換させていただけませんでしょうか。\n資料送付のみでも結構です。\n\nご検討のほど、よろしくお願いいたします。${sig}`
    },
    {
      no: 2, label: 'カジュアル版（共感・親近感型）',
      subjects: [`${name}様のご活動を拝見しまして`, '業務改善のこと、少し意見交換できませんか'],
      body: `${name}様\n\nはじめまして。AI業務改善の実践支援をしている山代悠生と申します。\n\n${contact}を拝見し、\n共感する点が多く、ご連絡してみました。\n\n私自身は「業務課題を見つけたら30分でアプリにする」をモットーに、\n現場の小さな困りごとをAIで解決する仕事をしています。\n${name}様の現場でも、似たテーマで頭を悩ませる場面はおありでしょうか。\n\nもしご興味があれば、15分ほどお話しできれば嬉しいです。\nお返事はお手すきのタイミングで構いません。${sig}`
    },
    {
      no: 3, label: '課題提起版（問題喚起・気づき型）',
      subjects: [`「PoC止まり」の課題、${name}様の現場ではいかがですか`, `${industry}における「AI実装の停滞」についてのご相談`],
      body: `${company}\n${dept} ${name}様\n\n突然のご連絡を失礼いたします。\nAI業務改善の実践支援を行っております、山代悠生と申します。\n\n近年、AI活用の検討は進む一方で、PoC（概念実証）で止まり\n実務に落ちないケースが多くの企業で課題化していると感じています。\n${name}様の現場でも、こうした「実装の手前で止まる」課題はおありでしょうか。\n\n私は「業務課題を見つけたら30分でアプリにする」という姿勢で、\n構想ではなく実際に動くツールを現場に届けることを大切にしています。\n構想と実装の間のハードルを、外部から素早く突破するパートナーとして\nお役に立てる場面があるかもしれません。\n\n15分ほど、御社の現状認識を伺う機会をいただけませんでしょうか。${sig}`
    },
    {
      no: 4, label: 'パーソナライズ版（公開情報の具体引用型・最も返信率高）',
      subjects: [`${company}様の${contact !== '貴社の取り組みに関する公開情報' ? contact : '取り組み'}を拝見して`, `${name}様へ｜${company}様の業務改善について1点だけ`],
      body: `${company}\n${dept} ${name}様\n\n突然のご連絡失礼いたします。AI業務改善の実践支援をしております、山代悠生と申します。\n\n${contact}を拝見し、${hypothesis}という点で、私がお役に立てるかもしれないと感じご連絡しました。\n\n（※この段落は、実際に拝見した具体的な内容に1〜2文だけ差し替えてから送ってください。例：「〜という記事を拝読し」「〜のサービス紹介を拝見し」。ここがパーソナライズの肝で、返信率を大きく左右します）\n\n私は構想やPoCで止めず、「見つけた課題を30分で動くアプリにする」ことを重視しています。\nもし関連するテーマがあれば、15分ほど意見交換させていただけませんか。資料送付のみでも構いません。${sig}`
    }
  ];
}
