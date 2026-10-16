// 元アプリ v3 のヒアリングシート生成ロジックを移植
//
// 【v3 からの修正】role の値は 'executive' だが質問バンクの weight キーは 'exec' のため、
// v3 では weight['executive'] が undefined となり比較関数が NaN を返し、
// 経営層向けシートで重み付けが働かず質問バンクの並び順がそのまま使われていた。
// ここでは ROLE_TO_WEIGHT_KEY で明示的に対応付けて修正する。
import { FLOW_MATERIAL_MAP } from "../data/flow-pricing";
import { QUESTION_BANK } from "../data/question-bank";
import { STAGE_PRICE_RANGE } from "../data/diagnosis-legal";
import type { CaseRecord, Profile, Sheet, SheetQuestion, VaultState } from "../types";

type Any = any;

const DISTRIBUTIONS: Record<string, Record<string, number>> = {
  executive: { A: 0.2, B: 0.2, C: 0.1, D: 0.25, E: 0.25 },
  manager: { A: 0.15, B: 0.3, C: 0.2, D: 0.2, E: 0.15 },
  frontline: { A: 0.15, B: 0.5, C: 0.2, D: 0.1, E: 0.05 },
  mixed: { A: 0.15, B: 0.3, C: 0.2, D: 0.2, E: 0.15 },
};

const ROLE_TO_WEIGHT_KEY: Record<string, string> = {
  executive: "exec",
  manager: "manager",
  frontline: "frontline",
  mixed: "manager",
};

export function buildSheet(settings: CaseRecord["settings"]): Sheet {
  const totalQuestions = Math.max(8, Math.round(Number(settings.duration || 45) / 3));
  const dist = DISTRIBUTIONS[settings.role] || DISTRIBUTIONS.manager;
  const counts: Record<string, number> = {};
  Object.keys(dist).forEach((cat) => {
    counts[cat] = Math.max(1, Math.round(totalQuestions * dist[cat]));
  });
  let sum = Object.values(counts).reduce((a, b) => a + b, 0);
  while (sum > totalQuestions && counts.B > 1) {
    counts.B--;
    sum--;
  }
  while (sum < totalQuestions) {
    counts.B++;
    sum++;
  }
  const weightKey = ROLE_TO_WEIGHT_KEY[settings.role] || "manager";

  // 業務フロー分析に必要な質問idセット（FLOW_MATERIAL_MAP から取得）
  const flowPriorityIds = new Set<string>();
  Object.values(FLOW_MATERIAL_MAP).forEach((def: Any) =>
    def.keys.forEach((k: string) => flowPriorityIds.add(k)),
  );

  const selectedQuestions: Record<string, SheetQuestion[]> = {};
  Object.keys(QUESTION_BANK).forEach((cat) => {
    const pool = ((QUESTION_BANK as Any)[cat] as SheetQuestion[]).slice();
    // 業務フロー分析必須質問に +1.5 の重みブースト（同weight時に優先選出）
    pool.sort((a, b) => {
      const aBoost = flowPriorityIds.has(a.id) ? 1.5 : 0;
      const bBoost = flowPriorityIds.has(b.id) ? 1.5 : 0;
      const aw = Number(a.weight?.[weightKey] ?? 0);
      const bw = Number(b.weight?.[weightKey] ?? 0);
      return bw + bBoost - (aw + aBoost);
    });
    selectedQuestions[cat] = pool
      .slice(0, Math.min(counts[cat], pool.length))
      .map((q) => ({ ...q }));
  });

  return {
    totalQuestions: Object.values(selectedQuestions).reduce((a, arr) => a + arr.length, 0),
    duration: Number(settings.duration || 45),
    questions: selectedQuestions,
    counts,
    keywords: settings.keywords || "",
    generatedAt: new Date().toISOString(),
  };
}

export function identifyThemes(c: CaseRecord): string[] {
  const keywords = (c.settings.keywords || "")
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter((s) => s);
  const themes: string[] = [];
  if (keywords.length > 0)
    themes.push(`課題キーワードの深掘り：${keywords.join(" / ")}`);
  const role = c.settings.role;
  if (role === "executive") {
    themes.push("経営戦略との接続点の確認");
    themes.push("意思決定プロセスと予算ルートの可視化");
  } else if (role === "frontline") {
    themes.push("現場の実態とペインポイントの収集");
    themes.push('過去施策で定着しなかった原因の特定');
  } else {
    themes.push("属人化・業務集中の実態把握");
    themes.push('過去のIT/AI導入における"成功と挫折"の理解');
  }
  if (themes.length < 3) themes.push("意思決定者と予算ルートの確認");
  return themes.slice(0, 3);
}

/** 提案書骨子の自動生成（8セクション） */
export function generateProposalSkeleton(
  c: CaseRecord,
  state: VaultState,
): Record<string, string> {
  const stage =
    (c.maturity && c.maturity.currentStage) || (c.gartner && c.gartner.stage) || "";
  const company = c.settings.companyName || String(c.name ?? "") || "【企業名】";
  const profile: Partial<Profile> = state.profile || {};
  const fa: Any = c.flowAnalysis && c.flowAnalysis.result;
  const problems: Any[] = fa && fa.problems ? fa.problems.slice(0, 3) : [];
  const stageDef = (STAGE_PRICE_RANGE as Any)[stage];
  const now = new Date();
  const out: Record<string, string> = {};

  out.cover = `${company} 様\nAI業務改善ご提案\n${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日\n${profile.yago || "山代業務改善事務所"} / ${profile.name || "山代 悠生"}`;

  out.current =
    "【ヒアリングで把握した課題】\n" +
    (problems.length > 0
      ? problems
          .map((p, i) => `${i + 1}. ${typeof p === "string" ? p : JSON.stringify(p)}`)
          .join("\n")
      : "・（業務フロー分析タブで課題を入力すると自動反映）") +
    "\n\n（現状を誇張せず・断定せず・事実ベースで記述）";

  out.target = stage
    ? `現在地: ${stage}\n\n` +
      (stage === "Defend"
        ? "まず守りを固める段階。情報の扱い・基本の型・小さな自動化から。"
        : stage === "Extend"
          ? "既存業務をAIで拡張する段階。1部署の型を作り、横展開へ。"
          : "業務そのものを作り変える段階。AIリーダー育成と新フロー設計が中心。")
    : "（②ヒアリング設計タブで成熟度診断を実行すると自動反映）";

  out.actions = stage
    ? stage === "Defend"
      ? "フェーズ1: 対象業務を1つ決め、現状を見える化\nフェーズ2: データ・情報の扱いルールを整える\nフェーズ3: 小さな自動化を1件、現場と一緒に作る"
      : stage === "Extend"
        ? "フェーズ1: 成功した1部署の型を文書化\nフェーズ2: 次の1部署へ横展開\nフェーズ3: 標準化と運用台帳を整備"
        : "フェーズ1: AIリーダー候補を1名選定\nフェーズ2: 旧フロー棚卸し → 新フロー設計\nフェーズ3: 3ヶ月ごとに成果測定の仕組みを構築"
    : "（診断結果に応じて自動生成）";

  out.method = stage
    ? `期間: ${stage === "Defend" ? "2〜4時間／単発" : stage === "Extend" ? "1ヶ月" : "3ヶ月"}\n体制: 受託者1名（必要に応じてクライアント側担当者）\n伴走方法: オンライン会議＋チャットでの質問対応\n納品方式: ${stage === "Transform" ? "専用ストレージ（厳格C）も検討" : "メール／専用ストレージ"}\n※ 武蔵「有構無構」: 形にとらわれず、現場の拍子を見ながら進める\n※ 本田「現場で試す」: 机上で完璧を狙わず、まず動かして直す`
    : "";

  out.cost = stageDef
    ? `推奨メニュー: ${stageDef.name}\n価格レンジ: ¥${stageDef.lo.toLocaleString()} 〜 ¥${stageDef.std.toLocaleString()}（標準） 〜 ¥${stageDef.hi.toLocaleString()}\n根拠: ${stageDef.why}\n上振れ条件: ${stageDef.upCond}\n月額継続切替時: ${stageDef.monthly}\n\n※ ROI非保証（免責事項第3版 第6条準拠）。成果保証はしない。`
    : "（④単価設計タブで提案価格を確定すると自動反映）";

  out.schedule =
    stage === "Defend"
      ? "・契約締結 → 1週間以内に現地ヒアリング\n・2週間以内に小さな自動化1件 → 納品＋検収"
      : stage === "Extend"
        ? "・初週: 業務フロー棚卸し\n・2-3週: 標準化ドキュメント作成\n・4週: 1部署運用開始 → 月次報告"
        : stage === "Transform"
          ? "・1ヶ月目: 現状整理・新フロー設計\n・2ヶ月目: パイロット運用＋リーダー育成\n・3ヶ月目: 横展開＋運用台帳完成"
          : "（診断結果に応じて自動生成）";

  out.premise = `■ 前提\n・本提案は受託者の経験と公開情報に基づく仮説です\n・実際の効果はクライアント側の体制・データ品質・継続性に大きく依存します\n\n■ 補助金に関するサポート範囲について\n当方はAI導入計画の設計・伴走支援を専門としています。補助金・助成金については、活用可能性のある制度のご案内と、お客様ご自身が作成される事業計画書への助言までを承ります。申請書類の作成代行は行政書士の業務範囲のため（行政書士法第19条）、必要な場合は提携の行政書士をご紹介します（紹介料はいただきません）。\n\n■ 免責事項（第3版準拠）\n・生成AI出力の正確性は保証しません（ハルシネーション・誤情報の責任を負いません）\n・ROI（投資対効果）は保証しません\n・補助金等の採択・交付決定その他官公署の判断について、いかなる保証も行いません\n・本提案の数字は概算であり、契約締結時に別紙A〜Cで確定します\n・永久契約はありません（初回6ヶ月／更新3ヶ月）\n\n発行: ${profile.yago || "山代業務改善事務所"} / ${profile.name || "山代 悠生"}\n${profile.url || "https://yamashirogyomukaizen.com"}`;

  return out;
}
