import { useCallback, useMemo } from "react";
import { useVault } from "./use-vault";
import type { CaseRecord, LeadRecord } from "../domain/types";

/**
 * 現在の案件／リードを取り出し、部分更新の関数を返す。
 * 更新はレコード単位なので、1案件を直しても他は送信されない。
 */
export function useCurrentCase() {
  const { state, mutate } = useVault();
  // 中身は現物を書き換える方式なので、包みだけ作り直して参照を変える。
  // 入れ子の中身は同じものを指しているので、書き戻しの経路は変わらない。
  const c = useMemo(() => {
    const found = state?.cases.find((x) => x.id === state.currentCaseId);
    return found ? { ...found } : null;
  }, [state]);
  const patch = useCallback(
    (fn: (c: CaseRecord) => void) => {
      if (!c) return Promise.resolve();
      return mutate(
        (s) => {
          const target = s.cases.find((x) => x.id === c.id);
          if (target) {
            fn(target);
            target.updatedAt = new Date().toISOString();
          }
        },
        [`case:${c.id}`],
      );
    },
    [c, mutate],
  );
  return { c, patch };
}

export function useCurrentLead() {
  const { state, mutate } = useVault();
  const l = useMemo(() => {
    const found = state?.leads.find((x) => x.id === state.currentLeadId);
    return found ? { ...found } : null;
  }, [state]);
  const patch = useCallback(
    (fn: (l: LeadRecord) => void) => {
      if (!l) return Promise.resolve();
      return mutate(
        (s) => {
          const target = s.leads.find((x) => x.id === l.id);
          if (target) {
            fn(target);
            target.updatedAt = new Date().toISOString();
          }
        },
        [`lead:${l.id}`],
      );
    },
    [l, mutate],
  );
  return { l, patch };
}
