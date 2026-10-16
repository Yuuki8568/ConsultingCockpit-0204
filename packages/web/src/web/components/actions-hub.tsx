/** 次にやること — 案件・リードの手動登録と、面談日・契約終了日・支払期日・請求日・月次レポート・三方良しの確認日からの自動分をまとめて出す */
import { useMemo, useState } from "react";
import { useVault } from "../hooks/use-vault";
import { Badge, Empty, Modal, Note, Sec } from "./kit";
import { Mask } from "./mask";
import { classifyDue, collectAllNextActions, type HubAction } from "../domain/logic/case";

type Filter = "open" | "overdue" | "week" | "done";

const FILTERS: [Filter, string][] = [
  ["open", "未完了"],
  ["overdue", "期限切れ"],
  ["week", "今週まで"],
  ["done", "完了済み"],
];

export function ActionsHub({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, mutate } = useVault();
  const [filter, setFilter] = useState<Filter>("open");
  const [newText, setNewText] = useState("");
  const [newDue, setNewDue] = useState("");
  const [target, setTarget] = useState("");

  const all = useMemo(
    () => (state ? collectAllNextActions(state) : []),
    [state],
  );

  const shown = useMemo(() => {
    return all.filter((a) => {
      if (filter === "done") return a.done;
      if (a.done) return false;
      if (filter === "overdue") return classifyDue(a.due).overdue;
      if (filter === "week") {
        const c = classifyDue(a.due);
        return c.overdue || c.label === "今日" || c.label.includes("今週");
      }
      return true;
    });
  }, [all, filter]);

  if (!state) return null;

  const targets: [string, string][] = [
    ["", "登録先を選ぶ"],
    ...state.cases.map(
      (c) => [`case:${c.id}`, `案件 / ${c.settings.companyName || "無題"}`] as [string, string],
    ),
    ...state.leads.map(
      (l) => [`lead:${l.id}`, `リード / ${l.company || "無題"}`] as [string, string],
    ),
  ];

  function add() {
    if (!newText.trim() || !target) return;
    const [kind, id] = target.split(":");
    void mutate(
      (s) => {
        const item = {
          id: "A" + Date.now().toString(36),
          text: newText.trim(),
          due: newDue,
          done: false,
          source: "hub",
        };
        if (kind === "case") s.cases.find((c) => c.id === id)?.nextActions.push(item);
        else s.leads.find((l) => l.id === id)?.nextActions.push(item);
      },
      [target],
    );
    setNewText("");
    setNewDue("");
  }

  function toggle(a: HubAction) {
    if (a.sourceType === "case_auto") return; // 自動分は元データで消える
    void mutate(
      (s) => {
        const list =
          a.sourceType === "case"
            ? s.cases.find((c) => c.id === a.sourceId)?.nextActions
            : s.leads.find((l) => l.id === a.sourceId)?.nextActions;
        const t = list?.find((x) => x.id === a.id);
        if (t) {
          t.done = !t.done;
          t.doneAt = t.done ? new Date().toISOString() : undefined;
        }
      },
      [`${a.sourceType === "case" ? "case" : "lead"}:${a.sourceId}`],
    );
  }

  function snooze(a: HubAction, days: number) {
    if (a.sourceType === "case_auto") return;
    void mutate(
      (s) => {
        const list =
          a.sourceType === "case"
            ? s.cases.find((c) => c.id === a.sourceId)?.nextActions
            : s.leads.find((l) => l.id === a.sourceId)?.nextActions;
        const t = list?.find((x) => x.id === a.id);
        if (t) {
          const base = t.due ? new Date(t.due) : new Date();
          base.setDate(base.getDate() + days);
          t.due = base.toISOString().slice(0, 10);
        }
      },
      [`${a.sourceType === "case" ? "case" : "lead"}:${a.sourceId}`],
    );
  }

  function remove(a: HubAction) {
    if (a.sourceType === "case_auto") return;
    void mutate(
      (s) => {
        const list =
          a.sourceType === "case"
            ? s.cases.find((c) => c.id === a.sourceId)?.nextActions
            : s.leads.find((l) => l.id === a.sourceId)?.nextActions;
        const i = list?.findIndex((x) => x.id === a.id) ?? -1;
        if (list && i >= 0) list.splice(i, 1);
      },
      [`${a.sourceType === "case" ? "case" : "lead"}:${a.sourceId}`],
    );
  }

  function jump(a: HubAction) {
    void mutate((s) => {
      if (a.sourceType === "lead") {
        s.currentMode = "leads";
        s.currentLeadId = a.sourceId;
      } else {
        s.currentMode = "cases";
        s.currentCaseId = a.sourceId;
      }
    });
    onClose();
  }

  const counts = {
    open: all.filter((a) => !a.done).length,
    overdue: all.filter((a) => !a.done && classifyDue(a.due).overdue).length,
  };

  return (
    <Modal open={open} onClose={onClose} title="次にやること" wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              className={`btn btn-sm ${f === filter ? "btn-primary" : ""}`}
              onClick={() => setFilter(f)}
            >
              {label}
              {f === "open" && counts.open > 0 && (
                <span className="num text-[11px]">{counts.open}</span>
              )}
              {f === "overdue" && counts.overdue > 0 && (
                <span className="num text-[11px]">{counts.overdue}</span>
              )}
            </button>
          ))}
        </div>

        {counts.overdue > 0 && filter !== "overdue" && (
          <Note tone="alert">期限を過ぎたものが {counts.overdue} 件あります。</Note>
        )}

        {shown.length === 0 ? (
          <Empty>
            {filter === "open"
              ? "未完了のものはありません。"
              : filter === "overdue"
                ? "期限切れはありません。"
                : filter === "week"
                  ? "今週までのものはありません。"
                  : "完了済みはありません。"}
          </Empty>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((a) => {
              const due = classifyDue(a.due);
              const auto = a.sourceType === "case_auto";
              return (
                <li
                  key={`${a.sourceId}-${a.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2.5"
                  style={{
                    borderColor: due.overdue ? "rgba(184,92,56,0.4)" : "var(--color-line)",
                    background: due.overdue ? "rgba(184,92,56,0.07)" : "var(--color-ink-850)",
                  }}
                >
                  <input
                    type="checkbox"
                    className="accent-[#0e7490]"
                    checked={a.done}
                    disabled={auto}
                    onChange={() => toggle(a)}
                    title={auto ? "自動で出ている項目です（元の日付を直すと消えます）" : undefined}
                  />
                  <div className="min-w-[180px] flex-1">
                    <div
                      className="text-[13px] leading-snug"
                      style={a.done ? { textDecoration: "line-through", opacity: 0.55 } : undefined}
                    >
                      {a.text || a.title}
                      {auto && (
                        <span className="ml-2">
                          <Badge color="#3B6E8F">自動</Badge>
                        </span>
                      )}
                    </div>
                    <button
                      className="mt-0.5 text-[11px] text-paper-faint hover:text-brand-hi"
                      onClick={() => jump(a)}
                    >
                      <Mask>{a.sourceName || "（名称未設定）"}</Mask> を開く
                    </button>
                  </div>
                  <Badge color={due.color}>{a.due ? `${a.due}・${due.label}` : due.label}</Badge>
                  {!a.done && !auto && (
                    <div className="flex gap-1">
                      <button className="btn btn-ghost btn-sm" onClick={() => snooze(a, 1)}>
                        +1日
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => snooze(a, 7)}>
                        +1週
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => remove(a)}
                        aria-label="削除"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-line pt-4">
          <Sec>その場で足す</Sec>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label className="field-label" htmlFor="hub-text">
                やること
              </label>
              <input
                id="hub-text"
                className="field"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") add();
                }}
              />
            </div>
            <div className="w-[150px]">
              <label className="field-label" htmlFor="hub-due">
                期限
              </label>
              <input
                id="hub-due"
                type="date"
                className="field num"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
              />
            </div>
            <div className="w-[220px]">
              <label className="field-label" htmlFor="hub-target">
                どこに足すか
              </label>
              <select
                id="hub-target"
                className="field"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {targets.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={add}
              disabled={!newText.trim() || !target}
            >
              足す
            </button>
          </div>
        </div>

        <Note tone="info">
          自動で出る項目: 面談日（①）、面談後で⑤メモが未記入の案件、契約終了日（⑥）、未入金の支払期日（④）、継続サポートの次の請求日・契約終了日と今月分の月次レポート（⑧）、三方良しの次回確認日（⑩）。元の日付を直すか入れると反映されます。完了・失注にした案件の自動分は出ません。
        </Note>
      </div>
    </Modal>
  );
}
