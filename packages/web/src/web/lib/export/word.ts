/**
 * Word 書き出し。
 * v3 と同じ「Word が読める HTML」方式（.doc）。外部CDNは使わない。
 * A4縦・余白18mm・游ゴシックを指定して、そのまま印刷できる形にしている。
 */

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const HEAD = (title: string, extraCss = "") => `<html
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:w="urn:schemas-microsoft-com:office:word"
 xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
@page { size: A4 portrait; margin: 18mm }
body { font-family: "Yu Gothic","Yu Mincho","Meiryo",sans-serif; font-size: 11pt; line-height: 1.75; color:#111 }
h1 { font-size: 14pt; text-align: center; border-bottom: 2px solid #0e7490; padding-bottom: 6px; margin: 0 0 14px }
h2 { font-size: 12pt; border-left: 4px solid #0e7490; padding-left: 8px; margin: 18px 0 8px }
.docno { text-align: right; font-size: 9pt; color: #666; margin-bottom: 4px }
.meta { font-size: 9.5pt; color:#444; margin-bottom: 12px }
pre { white-space: pre-wrap; font-family: inherit; margin: 0; font-size: 10.5pt }
table { border-collapse: collapse; width: 100%; font-size: 10pt; margin: 8px 0 }
th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top }
th { background: #f2f0ec }
td.n { text-align: right }
.foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 9pt; color: #555 }
${extraCss}
</style></head><body>`;

function save(html: string, fileName: string) {
  const blob = new Blob(["﻿" + html], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith(".doc") ? fileName : `${fileName}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** 本文が1本の長文（契約書・報告書・サマリ）の書き出し */
export interface WordTextOptions {
  title: string;
  docNo?: string;
  meta?: string;
  body: string;
  footer?: string;
  fileName: string;
}

export function buildWordHtml(opts: WordTextOptions): string {
  return HEAD(opts.title) +
    (opts.docNo ? `<div class="docno">${esc(opts.docNo)}</div>` : "") +
    `<h1>${esc(opts.title)}</h1>` +
    (opts.meta ? `<div class="meta">${esc(opts.meta)}</div>` : "") +
    `<pre>${esc(opts.body)}</pre>` +
    (opts.footer ? `<div class="foot">${esc(opts.footer)}</div>` : "") +
    "</body></html>";
}

export function downloadWord(opts: WordTextOptions): void {
  save(buildWordHtml(opts), opts.fileName);
}

export interface WordSection {
  heading?: string;
  text?: string;
  table?: { head: string[]; rows: (string | number)[][]; numCols?: number[] };
}

/** 見出し・本文・表を並べた複合文書の書き出し */
export function downloadWordSections(opts: {
  title: string;
  docNo?: string;
  meta?: string;
  sections: WordSection[];
  footer?: string;
  fileName: string;
}): void {
  const parts: string[] = [];
  for (const s of opts.sections) {
    if (s.heading) parts.push(`<h2>${esc(s.heading)}</h2>`);
    if (s.text) parts.push(`<pre>${esc(s.text)}</pre>`);
    if (s.table) {
      const nums = new Set(s.table.numCols ?? []);
      parts.push(
        `<table><thead><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
          s.table.rows
            .map(
              (r) =>
                `<tr>${r
                  .map((cell, i) => `<td${nums.has(i) ? ' class="n"' : ""}>${esc(String(cell))}</td>`)
                  .join("")}</tr>`,
            )
            .join("") +
          "</tbody></table>",
      );
    }
  }
  const html =
    HEAD(opts.title) +
    (opts.docNo ? `<div class="docno">${esc(opts.docNo)}</div>` : "") +
    `<h1>${esc(opts.title)}</h1>` +
    (opts.meta ? `<div class="meta">${esc(opts.meta)}</div>` : "") +
    parts.join("\n") +
    (opts.footer ? `<div class="foot">${esc(opts.footer)}</div>` : "") +
    "</body></html>";
  save(html, opts.fileName);
}

/** 印刷用に新しいウィンドウで開く（PDF保存もここから） */
export function printSections(opts: {
  title: string;
  meta?: string;
  sections: WordSection[];
  footer?: string;
}): void {
  const parts: string[] = [];
  for (const s of opts.sections) {
    if (s.heading) parts.push(`<h2>${esc(s.heading)}</h2>`);
    if (s.text) parts.push(`<pre>${esc(s.text)}</pre>`);
    if (s.table) {
      const nums = new Set(s.table.numCols ?? []);
      parts.push(
        `<table><thead><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
          s.table.rows
            .map(
              (r) =>
                `<tr>${r
                  .map((cell, i) => `<td${nums.has(i) ? ' class="n"' : ""}>${esc(String(cell))}</td>`)
                  .join("")}</tr>`,
            )
            .join("") +
          "</tbody></table>",
      );
    }
  }
  const html =
    HEAD(opts.title, "@media print { .noprint { display:none } }") +
    `<h1>${esc(opts.title)}</h1>` +
    (opts.meta ? `<div class="meta">${esc(opts.meta)}</div>` : "") +
    parts.join("\n") +
    (opts.footer ? `<div class="foot">${esc(opts.footer)}</div>` : "") +
    "</body></html>";
  const w = window.open("", "_blank");
  if (!w) {
    alert("印刷用の画面を開けませんでした。ポップアップの許可を確認してください。");
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}
