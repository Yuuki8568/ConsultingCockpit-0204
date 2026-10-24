import { legacyNetToGross } from "./pricing";
/**
 * ⑩三方良しへの自動転記（仮プラン確定時）。
 *
 * ④単価設計で確定した見積・選んだ支援メニュー・③業務フロー分析の結果から、
 * 事実として転記できる項目だけを下書きとして入れる。
 *
 * ルール:
 * - 空欄の項目だけを埋める。前回の自動転記から手を付けていない項目は最新に更新する。
 * - 手で書き換えた項目・空に戻した項目は、以後の自動転記ではいじらない。
 * - 各視点の状態・懸念・次に確認したいこと・次の行動の候補・振り返りは判断なので自動では入れない。
 */
import { DELIVERABLE_LABELS, DURATION_LABEL } from "../data/flow-pricing";
import { SERVICE_MENU_ITEMS } from "../data/service-menu";
import type { CaseRecord, SanpoReview } from "../types";
import { formatYen, jpDate, nowISO } from "./util";

/** 自動転記の対象になる三方良しの項目 */
export type SanpoAutoKey =
  | "target"
  | "customerValue"
  | "officeCondition"
  | "stakeholderImpact"
  | "basis"
  | "compareNew";

export const SANPO_AUTO_FIELD_LABELS: Record<SanpoAutoKey, string> = {
  target: "対象となる提案",
  customerValue: "顧客にとっての価値と負担",
  officeCondition: "自事務所として続けられる条件",
  stakeholderImpact: "現場・取引先への影響",
  basis: "根拠と不明点",
  compareNew: "提案の比較メモ（新規制作）",
};

const CONTRACT_TYPE_LABEL: Record<string, string> = {
  single: "単発",
  "1m": "1ヶ月",
  "3m": "3ヶ月",
  monthly: "月額継続",
};

/** 確定済みの情報から、三方良しに転記できる下書きを組み立てる。材料がない項目は返さない */
export function buildSanpoAutofill(c: CaseRecord): Partial<Record<SanpoAutoKey, string>> {
  const out: Partial<Record<SanpoAutoKey, string>> = {};
  const inputs = c.pricing?.inputs;
  const result = c.pricing?.result;
  const menuId = c.pricing?.menuPick?.menuId;
  const menu = menuId ? SERVICE_MENU_ITEMS.find((m) => m.id === menuId) : undefined;
  const est = c.estimate ?? { totalIncTax: 0, validUntil: "", issuedAt: "" };
  const hasEstimate = (est.totalIncTax ?? 0) > 0;
  const flow = c.flowAnalysis?.result;
  const company = String(c.settings?.companyName ?? "").trim();

  // 積算も見積確定もまだなら何もしない
  if (!result && !hasEstimate) return out;

  const title = String(inputs?.projectTitle ?? "").trim() || menu?.name || "";
  const durationLabel = inputs?.duration
    ? ((DURATION_LABEL as Record<string, string>)[String(inputs.duration)] ??
      String(inputs.duration))
    : (menu?.period ?? "");
  const hours =
    inputs && Number.isFinite(inputs.hours) && (inputs.hours as number) > 0
      ? (inputs.hours as number)
      : 0;
  const contractLabel = CONTRACT_TYPE_LABEL[String(c.execution?.contractType ?? "")] ?? "";

  let estimateLine = "";
  if (hasEstimate) {
    estimateLine = `見積 ${formatYen(est.totalIncTax)}円（税込）`;
    if (est.issuedAt) estimateLine += `・発行日 ${jpDate(est.issuedAt)}`;
    if (est.validUntil) estimateLine += `・有効期限 ${jpDate(est.validUntil)}`;
  }

  // 対象となる提案
  {
    const lines: string[] = [];
    if (title)
      lines.push(company && !title.includes(company) ? `${company}向け ${title}` : title);
    if (menu && title !== menu.name) lines.push(`支援メニュー: ${menu.name}`);
    if (estimateLine) lines.push(estimateLine);
    if (lines.length > 0) out.target = lines.join("\n");
  }

  // 顧客にとっての価値と負担
  {
    const lines: string[] = [];
    if (hasEstimate) {
      let s = `費用の負担: ${formatYen(est.totalIncTax)}円（税込・④単価設計の見積）`;
      const term = String(c.invoice?.paymentTerm ?? "").trim();
      if (term) s += `／支払条件: ${term}`;
      lines.push(s);
    }
    if (durationLabel) lines.push(`期間の目安: ${durationLabel}`);
    if (flow) {
      const g = flow.gap;
      lines.push(
        `効果の見込み（③フロー分析の設計値・概算）: 1件あたりの所要時間 ${g.asisTime}分 → ${g.tobeTime}分（約${g.timeReduction}分の減）`,
      );
    }
    if (menu?.catchcopy) lines.push(`メニューの狙い: ${menu.catchcopy}`);
    if (lines.length > 0) out.customerValue = lines.join("\n");
  }

  // 自事務所として続けられる条件
  {
    const lines: string[] = [];
    if (hours) lines.push(`想定工数: ${hours}時間（④の積算）`);
    if (durationLabel) lines.push(`期間: ${durationLabel}`);
    if (result && hours)
      lines.push(
        `時間あたりの目安: 約${formatYen(Math.round(legacyNetToGross(result.recommended) / hours))}円/h（推奨プラン税込 ÷ 工数）`,
      );
    if (contractLabel) lines.push(`契約形態: ${contractLabel}`);
    if (menu)
      lines.push(`メニューの目安: 工数 ${menu.hoursMin}〜${menu.hoursMax}時間・${menu.period}`);
    if (lines.length > 0) out.officeCondition = lines.join("\n");
  }

  // 現場・取引先への影響（③フロー分析があるときだけ）
  if (flow) {
    const lines: string[] = [];
    const problems = (flow.problems ?? [])
      .map((p) => String(p).trim())
      .filter((p) => p !== "")
      .slice(0, 3);
    if (problems.length > 0) lines.push(`③で挙げた現状の課題: ${problems.join("／")}`);
    const g = flow.gap;
    lines.push(
      `工程数（③の設計値）: ${g.asisCount} → ${g.tobeCount}／手作業の割合: ${g.asisManualRate}% → ${g.tobeManualRate}%`,
    );
    const p1 = (flow.measures ?? [])
      .filter((m) => m.priority === "P1")
      .map((m) => String(m.name).trim())
      .filter((n) => n !== "")
      .slice(0, 3);
    if (p1.length > 0) lines.push(`優先度の高い施策: ${p1.join("、")}`);
    if (lines.length > 0) out.stakeholderImpact = lines.join("\n");
  }

  // 根拠と不明点
  {
    const lines: string[] = [];
    const src: string[] = [];
    if (c.pricing?.calculatedAt) src.push(`④単価設計（計算日 ${jpDate(c.pricing.calculatedAt)}）`);
    else if (result) src.push("④単価設計");
    if (hasEstimate)
      src.push(`見積確定${est.issuedAt ? `（発行日 ${jpDate(est.issuedAt)}）` : ""}`);
    if (c.flowAnalysis?.analyzedAt)
      src.push(`③業務フロー分析（実施日 ${jpDate(c.flowAnalysis.analyzedAt)}）`);
    if (src.length > 0) lines.push(`転記元: ${src.join("、")}`);
    lines.push("金額と時間の削減は概算の見込みで、効果を確約するものではありません。");
    lines.push("顧客の最終判断・現場の受け入れ・準備の負担は、この転記では未確認です。");
    out.basis = lines.join("\n");
  }

  // 提案の比較メモ（新規制作）
  {
    const lines: string[] = [];
    const head = menu?.name || title;
    if (head) {
      const bits: string[] = [];
      if (hasEstimate) bits.push(`${formatYen(est.totalIncTax)}円（税込）`);
      else if (result)
        bits.push(`推奨プラン換算 ${formatYen(legacyNetToGross(result.recommended))}円（税込）`);
      if (hours) bits.push(`工数 ${hours}時間`);
      if (durationLabel) bits.push(durationLabel);
      lines.push(bits.length > 0 ? `${head}: ${bits.join("・")}` : head);
    }
    const dels = (inputs?.deliverables ?? []).map(
      (d) => (DELIVERABLE_LABELS as Record<string, string>)[d] ?? d,
    );
    if (dels.length > 0) lines.push(`成果物: ${dels.join("、")}`);
    if (menu?.excludes && menu.excludes.length > 0)
      lines.push(`料金に含まれないもの: ${menu.excludes.join("・")}`);
    if (lines.length > 0) out.compareNew = lines.join("\n");
  }

  return out;
}

/**
 * 下書きを案件に反映する。戻り値は今回新たに書き込んだ（または更新した）項目の一覧。
 * - 空欄の項目だけを埋める
 * - 前回の自動転記から手を付けていない項目は最新の文面に更新する
 * - 手で書き換えた項目・空に戻した項目はいじらない（追跡もやめる）
 */
export function applySanpoAutofill(x: CaseRecord, source: string): SanpoAutoKey[] {
  if (!x.sanpo || typeof x.sanpo !== "object") x.sanpo = {} as SanpoReview;
  const drafts = buildSanpoAutofill(x);
  const prevValues = { ...(x.sanpoAuto?.values ?? {}) };
  const nextValues: Record<string, string> = {};
  const filled: SanpoAutoKey[] = [];

  for (const k of Object.keys(SANPO_AUTO_FIELD_LABELS) as SanpoAutoKey[]) {
    const draft = drafts[k];
    const cur = String(x.sanpo[k] ?? "");
    const prevAuto = prevValues[k];
    // 前回の自動転記から変わっていないか（未転記なら空欄のときだけ）
    const untouched = prevAuto === undefined ? cur === "" : cur === prevAuto;
    if (!untouched) continue;
    if (!draft) {
      // 材料が消えた場合は文面を消さず、追跡だけ維持する
      if (prevAuto !== undefined) nextValues[k] = prevAuto;
      continue;
    }
    if (cur !== draft) {
      x.sanpo[k] = draft;
      filled.push(k);
    }
    nextValues[k] = draft;
  }

  const fields = Object.keys(nextValues);
  if (fields.length > 0) {
    x.sanpoAuto = { at: nowISO(), source, fields, values: nextValues };
  }
  return filled;
}
