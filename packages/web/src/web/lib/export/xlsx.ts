/**
 * Excel 書き出し。v3 は CDN から SheetJS を読み込んでいたが、
 * ここでは依存を自前バンドルに変えた（外部読み込みを許さない CSP にできる）。
 */


export interface SheetSpec {
  name: string;
  /** 1行目を見出しにする */
  head?: string[];
  rows: (string | number | null | undefined)[][];
  /** 列幅（文字数）。省略時は内容から概算する */
  widths?: number[];
}
/**
 * 表計算ソフト対策（CSV/数式インジェクション）。
 * 文字列が = + - @ やタブ・改行で始まると、Excel 等が式として実行してしまう。
 * 文字列セルの先頭に ' を付けて、必ず文字列として扱われるようにする。
 * 数値はそのまま（負の数値を壊さない）。
 */
export function sanitizeSheetCell(v: string | number | null | undefined): string | number | null | undefined {
  if (typeof v !== "string") return v;
  if (/^[\t\r\n ]*[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function autoWidths(head: string[] | undefined, rows: SheetSpec["rows"]): number[] {
  const cols = Math.max(head?.length ?? 0, ...rows.map((r) => r.length), 1);
  const w: number[] = [];
  for (let i = 0; i < cols; i++) {
    let max = head?.[i] ? charWidth(head[i]) : 6;
    for (const r of rows) {
      const v = r[i];
      if (v == null) continue;
      max = Math.max(max, charWidth(String(v)));
    }
    w.push(Math.min(60, Math.max(8, max + 2)));
  }
  return w;
}

/** 全角を2文字ぶんとして数える */
function charWidth(s: string): number {
  let n = 0;
  // 半角（ASCII 範囲）は1、それ以外は2で数える
  for (const ch of s) n += (ch.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
  return n;
}

/** SheetJS は重いので、使うときだけ読み込む（初期表示を軽くする） */
export async function downloadXlsx(fileName: string, sheets: SheetSpec[]): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const rows = s.rows.map((r) => r.map(sanitizeSheetCell));
    const aoa = s.head ? [s.head.map(sanitizeSheetCell), ...rows] : rows;
    const ws = XLSX.utils.aoa_to_sheet(aoa as unknown[][]);
    const widths = s.widths ?? autoWidths(s.head, s.rows);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    if (s.head) ws["!freeze"] = { xSplit: "0", ySplit: "1" };
    // シート名は31文字まで、記号は使えない
    const name = s.name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet";
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}

export function downloadCsv(fileName: string, head: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    const s = String(sanitizeSheetCell(v) ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [head.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  // Excel で開いたときに文字化けしないよう BOM を付ける
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
