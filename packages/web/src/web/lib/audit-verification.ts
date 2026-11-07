import type { AuditVerificationResult } from "../../shared/audit-verification";

/** Keep only progress, never audit payloads, in the browser. */
export async function verifyAllAuditPages(
  request: (input: { cursor?: string }) => Promise<AuditVerificationResult>,
  onProgress: (result: AuditVerificationResult) => void,
  signal: AbortSignal,
) {
  let cursor: string | undefined;
  let checked = 0, total: number | undefined;
  for (;;) {
    signal.throwIfAborted();
    const result = await request({ cursor });
    signal.throwIfAborted();
    if (!Number.isSafeInteger(result.checked) || !Number.isSafeInteger(result.total) ||
        result.checked < 0 || result.total < result.checked ||
        (total !== undefined && result.total !== total) ||
        (result.ok && (!result.complete || result.checked !== result.total || !result.total)))
      throw new Error("検証結果を確認できません。最初から確認してください。");
    if (!result.complete && (result.ok || !result.cursor || result.cursor === cursor ||
        result.checked <= checked || result.checked >= result.total))
      throw new Error("検証が進んでいません。最初から確認してください。");
    onProgress(result);
    if (result.complete) return result;
    checked = result.checked; total = result.total; cursor = result.cursor;
  }
}
