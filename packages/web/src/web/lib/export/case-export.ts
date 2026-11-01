import { SERVICE_SCOPE_NOTICE } from '../../domain/data/service-scope';
/**
 * 案件まるごとの書き出し。Excel・Word・印刷の3通り。
 * v3 の exportExcel / exportWord / printSheet に相当する。
 */
import { CATEGORY_NAMES } from "../../domain/data/question-bank";
import {
  CLIENT_SIZE_LABEL,
  DELIVERABLE_LABELS,
  DIFFICULTY_LABELS,
  URGENCY_LABEL,
} from "../../domain/data/flow-pricing";
import { DOC_TYPE_DEFS } from "../../domain/data/doc-templates";
import { MATURITY_AXES } from "../../domain/data/diagnosis-legal";
import { calculateROI, computeCaseProgress } from "../../domain/logic/case";
import { formatYen, legacyNetToGross } from "../../domain/logic/pricing";
import { safeFileName } from "../../domain/logic/util";
import type { CaseRecord, VaultState } from "../../domain/types";
import { downloadWordSections, printSections, type WordSection } from "./word";
import { downloadXlsx, type SheetSpec } from "./xlsx";

const INDUSTRY_JA: Record<string, string> = {
  general: "一般",
  manufacturing: "製造業",
  retail: "小売業",
  service: "サービス業",
  it: "IT・情報通信",
  medical: "医療・介護",
  legal: "士業",
  education: "教育",
  finance: "金融",
  construction: "建設・不動産",
  logistics: "物流",
};

const ROLE_JA: Record<string, string> = {
  executive: "経営層",
  manager: "管理職",
  frontline: "現場担当者",
  mixed: "混合",
};

function overviewRows(c: CaseRecord): (string | number)[][] {
  const prog = computeCaseProgress(c);
  return [
    ["企業名", c.settings.companyName || ""],
    ["業種", INDUSTRY_JA[c.settings.industry] ?? c.settings.industry],
    ["規模", c.settings.size],
    ["面談相手", ROLE_JA[c.settings.role] ?? c.settings.role],
    ["面談時間", `${c.settings.duration}分`],
    ["面談日", c.settings.meetingDate || ""],
    ["課題キーワード", c.settings.keywords || ""],
    ["成熟度", c.maturity.currentStage || c.gartner.stage || "未診断"],
    ["進捗", `${prog.filter(([, , d]) => d).length} / 10`],
    ["作成日", String(c.createdAt).slice(0, 10)],
  ];
}

/** 案件の全内容を Excel（複数シート）で書き出す */
export async function exportCaseXlsx(c: CaseRecord, _state: VaultState): Promise<void> {
  const sheets: SheetSpec[] = [];

  sheets.push({ name: "概要", head: ["項目", "内容"], rows: overviewRows(c) });

  if (c.sheet) {
    const rows: (string | number)[][] = [];
    Object.entries(c.sheet.questions).forEach(([cat, qs]) => {
      qs.forEach((q) => {
        rows.push([
          cat,
          CATEGORY_NAMES[cat as keyof typeof CATEGORY_NAMES] ?? "",
          q.id,
          String(q.text ?? q.q ?? ""),
          String(q.intent ?? ""),
          c.answers[q.id] ?? "",
        ]);
      });
    });
    sheets.push({
      name: "ヒアリング",
      head: ["区分", "区分名", "番号", "質問", "狙い", "回答"],
      rows,
    });
  }

  const fa = c.flowAnalysis?.result;
  if (fa) {
    sheets.push({
      name: "現状フロー",
      head: ["#", "工程", "担い手", "手作業", "所要(分)", "ボトルネック"],
      rows: fa.asis.steps.map((s, i) => [
        i + 1,
        s.raw,
        s.actor,
        s.manual ? "○" : "",
        s.time,
        s.isBottleneck ? "○" : "",
      ]),
    });
    sheets.push({
      name: "改善後フロー",
      head: ["#", "工程", "種別", "自動化", "所要(分)"],
      rows: fa.tobe.steps.map((s, i) => [i + 1, s.label, s.type, s.auto ? "○" : "", s.time]),
    });
    sheets.push({
      name: "打ち手",
      head: ["#", "優先", "打ち手", "効果", "手間", "道具の例", "費用の目安"],
      rows: fa.measures.map((m) => [
        m.no,
        m.priority,
        m.name,
        m.effect,
        m.effort,
        m.tool,
        m.cost,
      ]),
    });
    sheets.push({
      name: "ギャップ",
      head: ["項目", "現状", "改善後", "変化"],
      rows: [
        ["工程数", fa.gap.asisCount, fa.gap.tobeCount, `${fa.gap.stepReduction}% 減`],
        ["所要時間(分)", fa.gap.asisTime, fa.gap.tobeTime, `${fa.gap.timeReduction}% 減`],
        [
          "手作業割合(%)",
          fa.gap.asisManualRate,
          fa.gap.tobeManualRate,
          `${fa.gap.manualDelta} ポイント減`,
        ],
        ["関係部署数", fa.gap.asisDept, fa.gap.tobeDept, `${fa.gap.deptReduction}% 減`],
        ["ミスの起きやすさ", fa.gap.asisMistakeLevel, fa.gap.tobeMistakeLevel, ""],
      ],
    });
  }

  const pi = c.pricing?.inputs;
  const pr = c.pricing?.result;
  if (pi && pr) {
    sheets.push({
      name: "単価",
      head: ["項目", "内容"],
      rows: [
        ["案件名", pi.projectTitle],
        ["想定総工数(h)", pi.hours],
        ["時間単価(税込円)", legacyNetToGross(pi.baseline)],
        ["難易度", (DIFFICULTY_LABELS as Record<string, string>)[String(pi.difficulty)] ?? ""],
        ["急ぎ度", (URGENCY_LABEL as Record<string, string>)[pi.urgency] ?? ""],
        ["クライアント規模", (CLIENT_SIZE_LABEL as Record<string, string>)[pi.clientSize] ?? ""],
        [
          "成果物",
          pi.deliverables
            .map((d) => (DELIVERABLE_LABELS as Record<string, string>)[d] ?? d)
            .join("、"),
        ],
        ["基準額(税込円)", legacyNetToGross(pr.base)],
        ["難易度係数", pr.difficultyCoef],
        ["急ぎ係数", pr.urgencyCoef],
        ["リスク係数", pr.riskCoef],
        ["規模係数", pr.sizeCoef],
        ["経験係数", pr.expCoef],
        ["成果物加算(税込円)", legacyNetToGross(pr.deliverableAdd)],
        ["堅実プラン(税込円)", legacyNetToGross(pr.safe)],
        ["推奨プラン(税込円)", legacyNetToGross(pr.recommended)],
        ["挑戦プラン(税込円)", legacyNetToGross(pr.challenge)],
        ["見積 税込(円)", c.estimate.totalIncTax],
        ["見積 有効期限", c.estimate.validUntil],
        ["支払期日", c.invoice.dueDate],
        ["入金", c.invoice.paidFlag ? `済 (${c.invoice.paidAt})` : "未"],
      ],
    });
  }

  if (c.execution) {
    sheets.push({
      name: "タスク",
      head: ["やること", "担当", "期限", "状態", "完了日", "メモ"],
      rows: c.execution.tasks.map((t) => [
        t.name,
        t.owner,
        t.due,
        t.status,
        t.doneAt ? String(t.doneAt).slice(0, 10) : "",
        t.note,
      ]),
    });
    sheets.push({
      name: "成果物",
      head: ["成果物", "状態", "納品日"],
      rows: c.execution.deliverables.map((d) => [d.name, d.status, d.deliveredAt]),
    });
  }

  if (c.reports.length > 0) {
    sheets.push({
      name: "月次",
      head: [
        "月",
        "削減(分/件)",
        "件数/月",
        "時間価値(円/h)",
        "支払(円/月)",
        "削減時間(h/月)",
        "金額換算(円/月)",
        "年換算(円)",
        "比率(%)",
        "要点",
      ],
      rows: c.reports.map((r) => {
        const roi = calculateROI(r.reductionMin, r.hourlyRate, r.casesPerMonth, r.consultFee);
        return [
          r.month,
          r.reductionMin,
          r.casesPerMonth,
          r.hourlyRate,
          r.consultFee,
          roi.hoursPerMonth,
          roi.monthlySaved,
          roi.annualSaved,
          roi.roi,
          r.highlights,
        ];
      }),
    });
  }

  sheets.push({
    name: "法務",
    head: ["書類", "状態", "締結日", "書類番号"],
    rows: Object.entries(c.legalDocs).map(([k, v]) => [
      (DOC_TYPE_DEFS as Record<string, { jp: string }>)[k]?.jp ?? k,
      v.status,
      v.signedAt,
      v.docNo,
    ]),
  });

  if (Object.keys(c.maturity.scores).length > 0) {
    sheets.push({
      name: "成熟度",
      head: ["軸", "評価", "内容"],
      rows: MATURITY_AXES.map((ax) => {
        const v = c.maturity.scores[ax.id] ?? "";
        const opt = ax.opts.find(([o]) => o === v);
        return [ax.label, v, opt?.[1] ?? ""];
      }),
    });
  }

  await downloadXlsx(
    `${safeFileName(c.settings.companyName || "無題")}_案件一式_${new Date().toISOString().slice(0, 10)}`,
    sheets,
  );
}

function buildSections(c: CaseRecord): WordSection[] {
  const out: WordSection[] = [];
  out.push({ heading: "案件の概要", table: { head: ["項目", "内容"], rows: overviewRows(c) } });

  if (c.sheet) {
    const rows: (string | number)[][] = [];
    Object.entries(c.sheet.questions).forEach(([, qs]) => {
      qs.forEach((q) =>
        rows.push([q.id, String(q.text ?? q.q ?? ""), c.answers[q.id] || "（未記入）"]),
      );
    });
    out.push({ heading: "ヒアリング記録", table: { head: ["番号", "質問", "回答"], rows } });
  }

  const fa = c.flowAnalysis?.result;
  if (fa) {
    out.push({
      heading: "現状と改善後の差",
      table: {
        head: ["項目", "現状", "改善後", "変化"],
        rows: [
          ["工程数", fa.gap.asisCount, fa.gap.tobeCount, `${fa.gap.stepReduction}% 減`],
          ["所要時間(分)", fa.gap.asisTime, fa.gap.tobeTime, `${fa.gap.timeReduction}% 減`],
          [
            "手作業割合",
            `${fa.gap.asisManualRate}%`,
            `${fa.gap.tobeManualRate}%`,
            `${fa.gap.manualDelta} ポイント減`,
          ],
        ],
        numCols: [1, 2],
      },
    });
    out.push({ heading: "現状の問題点", text: fa.problems.map((p) => `・${p}`).join("\n") });
    out.push({
      heading: "打ち手",
      table: {
        head: ["#", "優先", "打ち手", "効果", "手間", "道具の例", "費用の目安"],
        rows: fa.measures.map((m) => [m.no, m.priority, m.name, m.effect, m.effort, m.tool, m.cost]),
        numCols: [0],
      },
    });
  }

  const pr = c.pricing?.result;
  if (pr) {
    out.push({
      heading: "金額",
      table: {
        head: ["プラン", "金額（税込）"],
        rows: [
          ["堅実", `¥${formatYen(legacyNetToGross(pr.safe))}`],
          ["推奨", `¥${formatYen(legacyNetToGross(pr.recommended))}`],
          ["挑戦", `¥${formatYen(legacyNetToGross(pr.challenge))}`],
        ],
        numCols: [1],
      },
    });
  }

  if (c.execution && c.execution.tasks.length > 0) {
    out.push({
      heading: "実行状況",
      table: {
        head: ["やること", "担当", "期限", "状態"],
        rows: c.execution.tasks.map((t) => [t.name, t.owner, t.due, t.status]),
      },
    });
  }

  if (c.reports.length > 0) {
    out.push({
      heading: "月次の実績",
      table: {
        head: ["月", "削減時間(h/月)", "金額換算(円/月)", "要点"],
        rows: c.reports.map((r) => {
          const roi = calculateROI(r.reductionMin, r.hourlyRate, r.casesPerMonth, r.consultFee);
          return [r.month, roi.hoursPerMonth, `¥${formatYen(roi.monthlySaved)}`, r.highlights];
        }),
        numCols: [1, 2],
      },
    });
  }

  return out;
}

const FOOTER =
  "※ 削減時間・金額換算は概算であり、成果を保証するものではありません（免責事項 第6条）。\n" +
  SERVICE_SCOPE_NOTICE;

export function exportCaseWord(c: CaseRecord, state: VaultState): void {
  const company = c.settings.companyName || "無題";
  downloadWordSections({
    title: `${company} 様 AI業務改善 案件資料`,
    meta: `作成 ${new Date().toLocaleDateString("ja-JP")} / ${state.profile.yago}・${state.profile.name}`,
    sections: buildSections(c),
    footer: FOOTER,
    fileName: `${safeFileName(company)}_案件資料_${new Date().toISOString().slice(0, 10)}.doc`,
  });
}

export function printCase(c: CaseRecord, state: VaultState): void {
  const company = c.settings.companyName || "無題";
  printSections({
    title: `${company} 様 AI業務改善 案件資料`,
    meta: `作成 ${new Date().toLocaleDateString("ja-JP")} / ${state.profile.yago}・${state.profile.name}`,
    sections: buildSections(c),
    footer: FOOTER,
  });
}
