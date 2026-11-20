/** A partial page is never a successful verification of the whole history. */
export type AuditVerificationResult = {
  ok: boolean;
  complete: boolean;
  checked: number;
  total: number;
  startedAtMs: number;
  startsAtSeq: number;
  reason?: string;
  cursor?: string;
  headHash?: string;
  witnessSeq?: number;
};
