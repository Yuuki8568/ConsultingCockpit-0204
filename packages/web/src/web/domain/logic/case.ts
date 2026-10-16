// 元アプリ v3 の案件進捗・次アクション・ROI ロジックを移植（式は同一・state を引数化）
import { LEGAL_CHECKLIST_ITEMS } from "../data/diagnosis-legal";
import type { CaseRecord, NextAction, Support, VaultState } from "../types";

export type ProgressRow = [tab: string, label: string, done: boolean];

export function computeCaseProgress(c: CaseRecord): ProgressRow[] {
  const legalDone = (() => {
    if (!c.legalChecklist) return false;
    let done = 0;
    let total = 0;
    (["pre", "during", "post"] as const).forEach((ph) => {
      const items = (LEGAL_CHECKLIST_ITEMS as Record<string, { items: string[][] }>)[ph]
        .items;
      items.forEach(([k]) => {
        total++;
        const v = c.legalChecklist[ph] && (c.legalChecklist[ph] as Record<string, unknown>)[k];
        if (v === "done" || v === "na" || v === true) done++;
      });
    });
    return total > 0 && done / total >= 0.5;
  })();
  return [
    ["setup", "①設定", !!(c.settings && c.settings.companyName)],
    ["sheet", "②ヒアリング", !!c.sheet],
    ["flow", "③フロー", !!(c.flowAnalysis && c.flowAnalysis.result)],
    ["pricing", "④単価", !!(c.pricing && c.pricing.result)],
    [
      "memo",
      "⑤メモ",
      !!(c.memo && (c.memo.attendees || c.memo.summary || c.memo.decisions)),
    ],
    [
      "execution",
      "⑥実行",
      !!(c.execution && c.execution.tasks && c.execution.tasks.length > 0),
    ],
    ["report", "⑦月次", !!(c.reports && c.reports.length > 0)],
    [
      "support",
      "⑧継続",
      !!(c.support && c.support.contract && c.support.contract.monthlyFee),
    ],
    ["legal", "⑨法務", legalDone],
    ["sanpo", "⑩三方良し", sanpoTouched(c)],
  ];
}

/** ⑩三方良し: 何か1つでも記録があれば着手済みとみなす（状態だけでも可） */
export function sanpoTouched(c: CaseRecord): boolean {
  const sp = c.sanpo;
  if (!sp || typeof sp !== "object") return false;
  return Object.values(sp).some((v) => String(v ?? "").trim() !== "");
}

/** ⑩三方良し: 懸念が記録されているか（一覧・ヘッダーの注意表示に使う。操作は止めない） */
export function sanpoHasConcern(c: CaseRecord): boolean {
  const sp = c.sanpo;
  if (!sp || typeof sp !== "object") return false;
  return (
    String(sp.concerns ?? "").trim() !== "" ||
    sp.statusCustomer === "concern" ||
    sp.statusOffice === "concern" ||
    sp.statusStakeholder === "concern"
  );
}

export function calcNextBillingAlert(
  contract: Support["contract"] | null | undefined,
): { date: string; daysLeft: number } | null {
  if (!contract || !contract.billingDay) return null;
  const today = new Date();
  const day = parseInt(String(contract.billingDay), 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  let next = new Date(today.getFullYear(), today.getMonth(), day);
  if (next < today) next = new Date(today.getFullYear(), today.getMonth() + 1, day);
  const daysLeft = Math.ceil((next.getTime() - today.getTime()) / 86400000);
  return { date: next.toISOString().slice(0, 10), daysLeft };
}

export interface HubAction extends NextAction {
  title?: string;
  sourceType: "case" | "case_auto" | "lead";
  sourceId: string;
  sourceName: string;
}

/** ローカル日付 "YYYY-MM-DD" を組み立てる（toISOString のUTCずれを避ける） */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function collectAllNextActions(state: VaultState): HubAction[] {
  const items: HubAction[] = [];
  const now = new Date();
  const today = ymd(now);
  const thisMonth = today.slice(0, 7); // YYYY-MM
  const monthStart = `${thisMonth}-01`;
  const monthEnd = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  (state.cases || []).forEach((c) => {
    const name = c.settings.companyName || String(c.name ?? "");
    (c.nextActions || []).forEach((a) =>
      items.push({
        ...a,
        sourceType: "case",
        sourceId: c.id,
        sourceName: name,
      }),
    );
    // 完了・失注の案件の自動項���は出さない（手動で残した分はそのまま出す）
    if (c.status === "done" || c.status === "lost") return;
    const auto = (id: string, text: string, due: string) =>
      items.push({
        id: id + c.id,
        text,
        title: text,
        due,
        done: false,
        sourceType: "case_auto",
        sourceId: c.id,
        sourceName: name,
      });
    // 自動：契約終了日
    if (c.execution && c.execution.contractEnd) {
      auto("auto_ce_", "契約終了・更新確認", c.execution.contractEnd);
    }
    // 自動：入金期限（前払い。未入金なら着手保留）
    if (c.invoice && c.invoice.dueDate && !c.invoice.paidFlag) {
      auto("auto_due_", "入金待ち・着手保留（入金確認後に着手）", c.invoice.dueDate);
    }
    // 自動：面談日（未来は面談そのもの、過去で⑤未記入ならメモ促し）
    const md = c.settings?.meetingDate || "";
    if (md) {
      if (md >= today) {
        auto("auto_meet_", "面談", md);
      } else {
        const m = c.memo || {};
        const memoDone = [m.attendees, m.summary, m.decisions].some(
          (v) => String(v ?? "").trim() !== "",
        );
        if (!memoDone) auto("auto_memo_", "商談後メモが未記入（面談から日が経っています）", md);
      }
    }
    // 自動：継続サポートの次の請求日と契約終了日
    const spc = c.support?.contract;
    if (spc) {
      const billing = calcNextBillingAlert(spc);
      if (billing) auto("auto_bill_", "次の請求（継続サポート）", billing.date);
      if (spc.endDate) auto("auto_send_", "継続契約の終了・更新確認", spc.endDate);
      // 自動：月額稼働中で今月のレポートがまだない
      const active =
        !!spc.startDate && spc.startDate <= monthEnd && (!spc.endDate || spc.endDate >= monthStart);
      const hasThisMonth = (c.reports || []).some((r) => r.month === thisMonth);
      if (active && !hasThisMonth) auto("auto_rep_", "今月分の月次レポート", monthEnd);
    }
    // 自動：⑩三方良しの次回確認日（「確認したいことを次の行動に追加」済みなら重複させない）
    const ncd = c.sanpo?.nextCheckDate || "";
    if (ncd) {
      const already = (c.nextActions || []).some(
        (a) => a.source === "sanpo" && a.due === ncd && !a.done,
      );
      if (!already) auto("auto_sanpo_", "三方良しの確認", ncd);
    }
  });
  (state.leads || []).forEach((l) => {
    (l.nextActions || []).forEach((a) =>
      items.push({
        ...a,
        sourceType: "lead",
        sourceId: l.id,
        sourceName: l.company,
      }),
    );
  });
  items.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  return items;
}

export function classifyDue(due: string | null | undefined): {
  label: string;
  color: string;
  overdue?: boolean;
} {
  if (!due) return { label: "期限なし", color: "#6B665F" };
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(due);
  const t = new Date(today);
  const diffDays = Math.floor((d.getTime() - t.getTime()) / 86400000);
  if (diffDays < 0) return { label: "期限切れ", color: "#B85C38", overdue: true };
  if (diffDays === 0) return { label: "今日", color: "#C9A961" };
  if (diffDays <= 7) return { label: `${diffDays}日後（今週）`, color: "#3B6E8F" };
  if (diffDays <= 30) return { label: `${diffDays}日後（今月）`, color: "#4A7C59" };
  return { label: `${diffDays}日後`, color: "#6B665F" };
}

export interface RoiResult {
  minPerMonth: number;
  hoursPerMonth: number;
  monthlySaved: number;
  annualSaved: number;
  roi: number;
}

export function calculateROI(
  reductionMinPerCase: number,
  hourlyRate: number,
  casesPerMonth: number,
  consultFee: number,
): RoiResult {
  const minPerMonth = (reductionMinPerCase || 0) * (casesPerMonth || 0);
  const hoursPerMonth = minPerMonth / 60;
  const monthlySaved = Math.round(hoursPerMonth * (hourlyRate || 0));
  const annualSaved = monthlySaved * 12;
  const roi = consultFee > 0 ? Math.round((monthlySaved / consultFee) * 100) : 0;
  return {
    minPerMonth: Math.round(minPerMonth),
    hoursPerMonth: Math.round(hoursPerMonth * 10) / 10,
    monthlySaved,
    annualSaved,
    roi,
  };
}

/** 成果サマリ1枚の本文を組み立てる（出力・保存は呼び出し側） */
export function buildMonthlySummaryText(c: CaseRecord, state: VaultState): string {
  const now = new Date();
  const ym = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  const company = c.settings.companyName || String(c.name ?? "") || "【企業名】";
  const stage =
    (c.maturity && c.maturity.currentStage) ||
    (c.gartner && c.gartner.stage) ||
    "未診断";
  const hist = (c.maturity && c.maturity.history) || [];
  const prevStage = hist.length >= 2 ? hist[hist.length - 2].stage : null;
  const stageDiff =
    prevStage && prevStage !== stage
      ? `（前回 ${prevStage} → 今回 ${stage}）`
      : prevStage
        ? `（前回から変化なし）`
        : "";
  const tasks = (c.execution && c.execution.tasks) || [];
  const ymKey = now.toISOString().slice(0, 7);
  const doneThisMonth = tasks.filter(
    (t) => t.status === "done" && t.doneAt && t.doneAt.startsWith(ymKey),
  );
  const todoNext = tasks
    .filter((t) => t.status === "todo" || t.status === "inprogress")
    .slice(0, 3);
  const latestReport =
    c.reports && c.reports.length > 0 ? c.reports[c.reports.length - 1] : null;

  const lines: string[] = [];
  lines.push(`${company} 様 AI業務改善 月次サマリ（${ym}）`);
  lines.push("━".repeat(48));
  lines.push("");
  lines.push("【1. 今月の要点】");
  if (latestReport && latestReport.highlights) lines.push(latestReport.highlights);
  else lines.push("（要点を3行で記入してください）");
  lines.push("");
  lines.push("【2. 実施したこと】");
  if (doneThisMonth.length === 0)
    lines.push("（⑥実行管理で完了タスクを追加すると自動反映）");
  else doneThisMonth.slice(0, 5).forEach((t, i) => lines.push(`  ${i + 1}. ${t.name}`));
  lines.push("");
  lines.push("【3. 数字（実績/推計）】");
  if (latestReport) {
    const roi = calculateROI(
      latestReport.reductionMin,
      latestReport.hourlyRate,
      latestReport.casesPerMonth,
      latestReport.consultFee,
    );
    lines.push(
      `  実績｜削減工数: ${latestReport.reductionMin}分/件 × ${latestReport.casesPerMonth}件 = ${((latestReport.reductionMin * latestReport.casesPerMonth) / 60).toFixed(1)}時間/月`,
    );
    lines.push(
      `  推計｜時間価値換算: ¥${roi.monthlySaved.toLocaleString("ja-JP")}/月 ※時給¥${(latestReport.hourlyRate || 0).toLocaleString("ja-JP")}換算`,
    );
  } else {
    lines.push("（月次レポート未登録）");
  }
  lines.push("");
  lines.push("【4. 成熟度の現在地】");
  lines.push(`  ${stage} ${stageDiff}`);
  lines.push("");
  lines.push("【5. 来月の打ち手】");
  if (todoNext.length === 0)
    lines.push("  （⑥実行管理で次タスクを追加すると自動反映）");
  else todoNext.forEach((t, i) => lines.push(`  ${i + 1}. ${t.name}`));
  lines.push("");
  lines.push("【6. ご相談・判断いただきたいこと】");
  lines.push("  （ある場合のみ記入）");
  lines.push("");
  lines.push("━".repeat(48));
  lines.push(
    `発行: ${(state.profile && state.profile.yago) || "山代業務改善事務所"} / ${(state.profile && state.profile.name) || "山代 悠生"}`,
  );
  lines.push((state.profile && state.profile.url) || "https://yamashirogyomukaizen.com");
  lines.push("※ ROI非保証（免責事項第2版 第6条準拠）");
  return lines.join("\n");
}
