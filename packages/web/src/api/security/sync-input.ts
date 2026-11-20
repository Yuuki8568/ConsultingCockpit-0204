import { z } from "zod";
import { ciphertextInput, ivInput } from "./inputs";
import { MAX_SYNC_RECORDS } from "../../shared/sync-limits";
export const recordInput = z
  .object({
    operation: z.enum(["put", "delete"]),
    id: z.string().min(1).max(64),
    type: z.enum(["case", "lead", "profile", "template", "meta", "log"]),
    // 1件あたりの上限を置く（1MB ≒ 平文768KB目安）。上限がないと、
    // 巨大な塊を積んで容量を食い潰す使い方ができてしまう。
    // 書類を何度も生成した案件はレコードが大きく育つため、256KB では
    // 途中で同期が恒久的に失敗する（2026-09-15 に再現確認）。
    ciphertext: ciphertextInput,
    iv: ivInput,
    updatedAtMs: z.number().int(),
    deleted: z.boolean().default(false),
    /**
     * この編集が元にしたサーバー版の seq。
     * サーバーの現在の seq と一致していれば「相手の変更を見た上での編集」なので競合ではない。
     * 一致しないときだけ、上書きされる側を競合コピーとして返す。
     */
    baseSeq: z.number().int().min(0).default(0),
  })
  .refine((r) => (r.operation === "delete") === r.deleted, "操作種別と削除状態が一致しません");

export const syncInput = z.object({
  proof: z.object({ id: z.string().uuid(), signature: z.string().max(200) }).optional(),
  // 端末IDは必須。省略できると、失効させた端末が「端末IDを付けない」だけで
  // 失効判定を通り抜けてしまうため。
  deviceId: z.string().min(4).max(64),
  generation: z.number().int().min(1),
  since: z.number().int().min(0).default(0),
  records: z
    .array(recordInput)
    .max(MAX_SYNC_RECORDS, "同期の更新が必要です。ページを再読み込みしてください。"),
});
export type SyncInput = z.infer<typeof syncInput>;
