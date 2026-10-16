// 元アプリ v3 の営業プロセス計算ロジックを移植（式は同一・state を引数化）
import { QUALIFICATION_AXES, STAGE_PROBABILITY } from "../data/sales";
import type { CaseRecord, LeadRecord, VaultState } from "../types";

export interface QualScore {
  score: number;
  max: number;
  pct: number;
}

export function calcQualScore(lead: LeadRecord): QualScore {
  const q = lead.qualification || {};
  let sum = 0;
  QUALIFICATION_AXES.forEach((a) => {
    sum += Number(q[a.id]) || 0;
  });
  const max = QUALIFICATION_AXES.length * 2;
  return { score: sum, max, pct: Math.round((sum / max) * 100) };
}

export function qualHealthLabel(pct: number): { label: string; color: string } {
  if (pct >= 70) return { label: "健全（Aランク）", color: "#4A7C59" };
  if (pct >= 40) return { label: "要育成（Bランク）", color: "#C9A961" };
  return { label: "情報不足（Cランク）", color: "#B85C38" };
}

export interface ForecastRow {
  company: string;
  stage: string;
  prob: number;
  val: number;
  w: number;
}

export interface PipelineForecast {
  weighted: number;
  total: number;
  commit: number;
  best: number;
  rows: ForecastRow[];
}

export function calcPipelineForecast(leadsInput: LeadRecord[]): PipelineForecast {
  const leads = (leadsInput || []).filter(
    (l) => l.status !== "lost" && (l.salesStage || "approach") !== "won",
  );
  let weighted = 0;
  let total = 0;
  let commit = 0;
  let best = 0;
  const rows: ForecastRow[] = [];
  leads.forEach((l) => {
    const stage = l.salesStage || "approach";
    const prob =
      l.winProbability != null
        ? l.winProbability
        : (STAGE_PROBABILITY as Record<string, number>)[stage] || 10;
    const val = Number(l.dealValue) || 0;
    const w = Math.round((val * prob) / 100);
    weighted += w;
    total += val;
    if (prob >= 90) commit += val; // Commit: ほぼ確実
    if (prob >= 50) best += val; // Best case: 五分以上
    if (val > 0) rows.push({ company: l.company, stage, prob, val, w });
  });
  return { weighted, total, commit, best, rows };
}

export interface PipelineVelocity {
  winRate: number;
  avgDeal: number;
  avgCycle: number;
  openDeals: number;
  velocity: number;
}

export function calcPipelineVelocity(
  leads: LeadRecord[],
  cases: CaseRecord[],
): PipelineVelocity {
  const ls = leads || [];
  const cs = cases || [];
  const activeLeads = ls.length;
  const wonLeads = ls.filter((l) => l.salesStage === "won" || l.convertedCaseId).length;
  const winRate = activeLeads > 0 ? wonLeads / activeLeads : 0;
  // 平均案件単価
  let sumVal = 0;
  let cntVal = 0;
  cs.forEach((c) => {
    const v = (c.estimate && c.estimate.totalIncTax) || 0;
    if (v > 0) {
      sumVal += v;
      cntVal++;
    }
  });
  ls.forEach((l) => {
    const v = Number(l.dealValue) || 0;
    if (v > 0) {
      sumVal += v;
      cntVal++;
    }
  });
  const avgDeal = cntVal > 0 ? Math.round(sumVal / cntVal) : 0;
  // 平均営業サイクル日数（リード作成→受注/案件化）
  let sumDays = 0;
  let cntDays = 0;
  ls.forEach((l) => {
    if ((l.salesStage === "won" || l.convertedCaseId) && l.createdAt) {
      const end = l.convertedCaseId
        ? cs.find((c) => c.id === l.convertedCaseId)?.createdAt
        : l.stageEnteredAt;
      if (end) {
        const d = (new Date(end).getTime() - new Date(l.createdAt).getTime()) / 86400000;
        if (d >= 0) {
          sumDays += d;
          cntDays++;
        }
      }
    }
  });
  const avgCycle = cntDays > 0 ? Math.round(sumDays / cntDays) : 0;
  const openDeals = ls.filter(
    (l) => l.status !== "lost" && l.salesStage !== "won" && !l.convertedCaseId,
  ).length;
  // パイプライン速度 = (進行中案件数 × 成約率 × 平均単価) / 平均サイクル日数
  const velocity = avgCycle > 0 ? Math.round((openDeals * winRate * avgDeal) / avgCycle) : 0;
  return { winRate, avgDeal, avgCycle, openDeals, velocity };
}

/** Next Best Action — 評価の欠けとステージから次の一手を出す */
export function computeNBA(lead: LeadRecord): string[] {
  const q = lead.qualification || {};
  const stage = lead.salesStage || "approach";
  const nbas: string[] = [];
  if (!q.ebuyer || q.ebuyer < 2)
    nbas.push(
      "決裁者（Economic Buyer）を特定する — 「最終的にどなたが承認されますか？」を確認",
    );
  if (!q.champion || q.champion < 1)
    nbas.push("社内の推進者（Champion）を見つける — 味方になってくれる人を1人作る");
  if (!q.pain || q.pain < 2)
    nbas.push("課題の痛みを言語化する — 「放置するとどうなるか」を相手の言葉で引き出す");
  if (!q.metrics || q.metrics < 1)
    nbas.push("成果指標（Metrics）を合意する — 何をもって成功とするかを決める");
  if (!q.process || q.process < 1)
    nbas.push("決定プロセスを可視化する — 稟議・承認フローと期間を確認");
  if (!lead.dealValue || lead.dealValue === 0)
    nbas.push("想定案件額を入力する — 予測精度が上がります");
  const stageNba = (
    {
      approach: "初回接触の返信を得る／フォローアップ",
      firstMeeting: "商談準備シートを完成させる",
      proposal: "提案書骨子を生成し、決裁者向け1枚資料を用意",
      quote: "見積を発行し、有効期限を握る",
      closing: "異議処理を先回りし、契約書類を準備",
    } as Record<string, string>
  )[stage];
  if (stageNba) nbas.push("【ステージ推奨】" + stageNba);
  return nbas.slice(0, 4);
}

export function getWeekKey(d: Date): string {
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(
    ((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7,
  );
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** リード追加時のパターン割り当て（auto は 1→2→3 のローテーション） */
export function assignPattern(
  assign: string,
  leadCounter: number,
): { pattern: number; nextCounter: number } {
  if (assign === "auto") {
    const next = (leadCounter || 0) + 1;
    return { pattern: ((next - 1) % 3) + 1, nextCounter: next };
  }
  return { pattern: parseInt(assign, 10) || 1, nextCounter: leadCounter };
}

/** 入力の長さ制限＋制御文字除去（v3 sanitizeInput 相当） */
export function sanitizeInput(v: string, max: number): string {
  return String(v ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, max);
}

/** ファネル集計 */
export function countFunnel(state: VaultState): Record<string, number> {
  const out: Record<string, number> = {};
  (state.leads || []).forEach((l) => {
    const k = l.funnelStatus || "";
    if (!k) return;
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}
