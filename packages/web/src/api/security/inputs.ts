import { z } from "zod";
function canonicalBase64(value: string, minimum: number, exact?: number) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try { const bytes = atob(value); return bytes.length >= minimum && (exact === undefined || bytes.length === exact) && btoa(bytes) === value; }
  catch { return false; }
}
export const ciphertextInput = z.string().max(1_048_576).refine(v => canonicalBase64(v, 16), "暗号文の形式が正しくありません");
export const ivInput = z.string().length(16).refine(v => canonicalBase64(v, 12, 12), "IVの形式が正しくありません");
export const saltInput = z.string().max(64).refine(v => canonicalBase64(v, 32, 32), "saltの形式が正しくありません");
