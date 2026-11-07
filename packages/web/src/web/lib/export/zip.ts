/**
 * ZIP 書き出し。9書類まとめて渡すときに使う。
 * v3 は CDN の JSZip を使っていたが、fflate に置き換えて自前バンドルにした。
 */
import { zipSync, strToU8 } from "fflate";

export interface ZipEntry {
  name: string;
  /** 文字列（テキスト・HTML）か、すでにバイト列になっているもの */
  content: string | Uint8Array;
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const e of entries) {
    const safe = e.name.replace(/[\\:*?"<>|]/g, "_");
    files[safe] =
      typeof e.content === "string"
        ? // Word が読めるように BOM を先頭に付ける
          strToU8("﻿" + e.content)
        : e.content;
  }
  return zipSync(files, { level: 6 });
}

export function downloadZip(fileName: string, entries: ZipEntry[]): void {
  const zipped = buildZip(entries);
  const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith(".zip") ? fileName : `${fileName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
