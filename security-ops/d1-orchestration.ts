/** Operator-only. Each call selects at most one bounded operation from durable
 * progress. The caller supplies current measurements and a previously initialized
 * run on a detached target. This module schedules no work by itself.
 */
import { readV2Receipt } from "../packages/web/src/d1-receipt-v2";
import { getBoundedCopyStatus } from "./d1-copy-checkpoint";
import { getCopyVerificationStatus, getFinalizedCopyReceipt } from "./d1-copy-verification";
import { getExecutionControlStatus, runControlledMigrationStep } from "./d1-execution-control";
import { inspectCatalog, queryInventorySession } from "./d1-inventory";

type Step = Parameters<typeof runControlledMigrationStep>[0];
type Input = Omit<Step, "operation" | "expectedRevision">;

async function readProgress<T>(read: () => Promise<T>, emptyCode: string) {
  try { return await read(); }
  catch (error) {
    if (error instanceof Error && error.message === emptyCode) return null;
    throw error;
  }
}

export async function advanceControlledMigration(input: Input) {
  const { target, runId, scope } = input;
  const ledger = await getExecutionControlStatus(target, runId);
  const catalog = await inspectCatalog(queryInventorySession(target.withSession("first-primary")), "destination");
  if (!["cockpit_cutover_receipt", "cockpit_atomic_assertion", "cockpit_copy_checkpoint",
    "cockpit_copy_verification", "cockpit_execution_control"].every(name => catalog.controls.includes(name)))
    throw Error("INVENTORY_CONTROL_MISSING");
  let receipt;
  try { receipt = await readV2Receipt(target); }
  catch { throw Error("MIGRATION_RECEIPT_INVALID"); }
  const copy = await readProgress(() => getBoundedCopyStatus(target, runId, scope), "COPY_NOT_STARTED");
  const verification = copy?.phase === "copied"
    ? await readProgress(() => getCopyVerificationStatus(target, runId, scope), "VERIFY_NOT_STARTED")
    : null;
  if (receipt) {
    if (receipt.runId !== runId || verification?.phase !== "matched") throw Error("MIGRATION_RECEIPT_INVALID");
    const confirmed = await getFinalizedCopyReceipt(target, runId, verification.revision, scope);
    return { phase: "complete" as const, ...confirmed };
  }
  if (verification?.phase === "failed") throw Error("VERIFY_ALREADY_FAILED");
  if (ledger.leased) throw Error("EXECUTION_DENIED");
  let operation: Step["operation"];
  let expectedRevision = 0;
  if (!copy) operation = "initialize-copy";
  else if (copy.phase === "copying") { operation = "copy"; expectedRevision = copy.revision; }
  else if (!verification) operation = "initialize-verification";
  else {
    operation = verification.phase === "matched" ? "finalize" : "verify";
    expectedRevision = verification.revision;
  }
  const result = await runControlledMigrationStep({ ...input, operation, expectedRevision });
  if ("sha256" in result) return { phase: "complete" as const, ...result };
  return { phase: "progress" as const, cutoverAllowed: false as const };
}
