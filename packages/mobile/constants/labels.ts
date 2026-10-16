/**
 * モバイルで使う表示用ラベル。
 * ブラウザ版 packages/web/src/web/domain/data/sales.ts と同じ値を持つ
 * （@template/web はAPIの型だけを公開しているため、表示ラベルはここに置く）。
 */
export const LEAD_STATUS_LABEL: Record<string, string> = {
  pending: "未送信",
  sent: "送信済",
  replied: "返信あり",
  meeting: "面談化",
  converted: "案件化済",
};

export const SALES_STAGE_LABEL: Record<string, { label: string; color: string }> = {
  approach: { label: "① アプローチ", color: "#6c757d" },
  firstMeeting: { label: "② 初回商談", color: "#3b6e8f" },
  proposal: { label: "③ 提案", color: "#c9a961" },
  quote: { label: "④ 見積", color: "#b8860b" },
  closing: { label: "⑤ クロージング", color: "#4a7c59" },
  won: { label: "⑥ 受注", color: "#2e7d32" },
};

export const SALES_STAGE_ORDER = [
  "approach",
  "firstMeeting",
  "proposal",
  "quote",
  "closing",
  "won",
] as const;

export const LEAD_STATUS_ORDER = [
  "pending",
  "sent",
  "replied",
  "meeting",
  "converted",
] as const;

/** ガートナー3段階の色（ブラウザ版と同じ） */
export const STAGE_COLOR: Record<string, string> = {
  defend: "#3B6E8F",
  extend: "#C9A961",
  transform: "#4A7C59",
};

export const STAGE_LABEL: Record<string, string> = {
  defend: "第1段階 守り（Defend）",
  extend: "第2段階 広げ（Extend）",
  transform: "第3段階 変える（Transform）",
};
