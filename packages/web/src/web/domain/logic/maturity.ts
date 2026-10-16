// 元アプリ v3 の AI成熟度診断ロジックを移植（判定式・キーワードは同一）
import type { CaseRecord, MaturityStage } from "../types";

export function autoInferMaturity(c: CaseRecord): Record<string, string> {
  // ヒアリング回答テキストからキーワードで粗い初期値を推定
  const ansAll = Object.values(c.answers || {}).join("\n").toLowerCase();
  const settings: Record<string, unknown> = c.settings || {};
  const memo = JSON.stringify(c.memo || {}).toLowerCase();
  const all =
    ansAll +
    "\n" +
    memo +
    "\n" +
    String(settings.keywords || "").toLowerCase() +
    "\n" +
    String(settings.knownInfo || "").toLowerCase();
  const guess: Record<string, string> = {};
  // 経営層
  if (/(経営|社長|役員).{0,8}(無関心|興味.*ない|わからない)/.test(all)) guess.exec = "1";
  else if (/(経営|社長|役員).{0,12}(旗振り|主導|本気|プロジェクトオーナー)/.test(all))
    guess.exec = "3";
  else guess.exec = "2";
  // AI利用
  if (/(未導入|使ったことない|これから|ゼロから)/.test(all)) guess.aiuse = "1";
  else if (/(全社|横展開|本番運用|定着)/.test(all)) guess.aiuse = "3";
  else if (/(chatgpt|claude|gemini|copilot|試して|一部|個人で)/.test(all)) guess.aiuse = "2";
  else guess.aiuse = "1";
  // データ整備
  if (/(紙|手書き|属人|excel.*ばらばら|ばらばら|散在)/.test(all)) guess.data = "1";
  else if (/(一元|統合|データ基盤|dwh|データレイク)/.test(all)) guess.data = "3";
  else guess.data = "2";
  // 業務標準化
  if (/(属人化|担当者しか|マニュアル.*ない|なんとなく)/.test(all)) guess.process = "1";
  else if (/(標準化済|仕組み化|sop)/.test(all)) guess.process = "3";
  else guess.process = "2";
  // 投資意欲
  if (/(リスク.*取りたくない|現状維持|変えたくない)/.test(all)) guess.invest = "1";
  else if (/(変革|転換|作り変え|抜本)/.test(all)) guess.invest = "3";
  else guess.invest = "2";
  // リーダー
  if (/(専任|ai推進室|ceo直下|担当役員)/.test(all)) guess.leader = "3";
  else if (/(兼任|担当決め|窓口あり)/.test(all)) guess.leader = "2";
  else guess.leader = "1";
  return guess;
}

export function calcMaturityStage(scores: Record<string, string | number>): {
  stage: MaturityStage;
  avg: number;
} {
  const vals = Object.values(scores || {}).map((v) => Number(v) || 2);
  if (vals.length === 0) return { stage: "", avg: 0 };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  let stage: MaturityStage = "Defend";
  if (avg >= 2.34) stage = "Transform";
  else if (avg >= 1.67) stage = "Extend";
  return { stage, avg };
}
