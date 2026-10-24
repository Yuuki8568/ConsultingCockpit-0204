/**
 * 共通シェル。左サイドバー（モード切替＋一覧）と上部ヘッダー（同期・マスク・施錠）。
 * 業務中に一番よく触る場所なので、余白より一覧性を優先する。
 */
import { useMemo, useState } from "react";
import { useVault } from "../hooks/use-vault";
import { computeCaseProgress, collectAllNextActions, classifyDue, sanpoHasConcern } from "../domain/logic/case";
import { relativeTime } from "../domain/logic/util";
import { LEAD_STATUS_LABEL } from "../domain/data/sales";
import type { Mode } from "../domain/types";
import { BackupBadge } from "./automatic-backup";
import { Mask } from "./mask";

interface ShellProps {
  children: React.ReactNode;
  onOpenSettings: () => void;
  onOpenActions: () => void;
  onNewCase: () => void;
  onNewLead: () => void;
}

export function Shell({
  children,
  onOpenSettings,
  onOpenActions,
  onNewCase,
  onNewLead,
}: ShellProps) {
  const { state, mutate, sync, masked, setMasked, lock, lockWarning, secondsToLock } = useVault();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const actions = useMemo(
    () => (state ? collectAllNextActions(state) : []),
    [state],
  );
  const overdue = actions.filter((a) => !a.done && classifyDue(a.due).overdue).length;
  const dueToday = actions.filter(
    (a) => !a.done && classifyDue(a.due).label === "今日",
  ).length;

  if (!state) return null;

  const mode = state.currentMode;

  const cases = state.cases.filter((c) =>
    filter ? (c.settings.companyName || "").includes(filter) : true,
  );
  const leads = state.leads.filter((l) =>
    filter ? (l.company || "").includes(filter) || (l.name || "").includes(filter) : true,
  );

  const setMode = (m: Mode) =>
    void mutate((s) => {
      s.currentMode = m;
    });

  return (
    <div className="flex min-h-screen bg-ink-900">
      {/* ---- サイドバー ---- */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-line bg-ink-850 transition-transform duration-150 lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="rise flex items-center gap-2.5 border-b border-line px-4 py-3.5">
          <img src="/logo.png" alt="山代業務改善事務所" className="size-7 shrink-0" />
          <div className="min-w-0">
            <div className="font-display truncate text-[13px] font-semibold text-paper">
              Consulting Cockpit
            </div>
            <div className="font-mono text-[10px] tracking-wider text-paper-faint">v4</div>
          </div>
        </div>

        {/* モード切替 */}
        <div className="grid grid-cols-3 gap-1 border-b border-line p-2">
          {(
            [
              ["cases", "案件", state.cases.length],
              ["leads", "リード", state.leads.length],
              ["office", "自社", null],
            ] as [Mode, string, number | null][]
          ).map(([m, label, n]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-[12px] font-medium transition-colors ${
                mode === m
                  ? "bg-brand-soft text-paper"
                  : "text-paper-dim hover:bg-ink-700 hover:text-paper"
              }`}
              style={mode === m ? { boxShadow: "inset 0 0 0 1px rgba(14,116,144,0.45)" } : undefined}
            >
              {label}
              {n !== null && <span className="num text-[11px] text-paper-faint">{n}</span>}
            </button>
          ))}
        </div>

        {mode !== "office" && (
          <div className="border-b border-line p-2">
            <input
              className="field py-1 text-[12px]"
              placeholder={mode === "cases" ? "案件を絞り込む" : "リードを絞り込む"}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        )}

        {/* 一覧 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {mode === "cases" ? (
            <CaseList cases={cases} filtered={filter !== ""} />
          ) : mode === "leads" ? (
            <LeadList leads={leads} />
          ) : (
            <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-paper-faint">
              共通の時間・AI費用・容量判定と、
              <br />
              承認・事故の横断一覧をまとめて見ます。
            </p>
          )}
        </div>

        <div className="border-t border-line p-2">
          {mode !== "office" && (
            <button
              className="btn btn-primary w-full"
              onClick={mode === "cases" ? onNewCase : onNewLead}
            >
              + {mode === "cases" ? "案件を追加" : "リードを追加"}
            </button>
          )}
          <button className="btn btn-ghost mt-1 w-full justify-start" onClick={onOpenSettings}>
            設定・書類雛形・保全
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          aria-label="閉じる"
          className="fixed inset-0 z-30 bg-black/55 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ---- 作業領域 ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="rise rise-1 sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-line bg-ink-900/95 px-3 py-2 backdrop-blur lg:px-4">
          <button
            className="btn btn-ghost btn-sm lg:hidden"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            ☰
          </button>

          <button className="btn btn-sm relative" onClick={onOpenActions}>
            次にやること
            {overdue > 0 ? (
              <span className="badge border-alert/45 bg-alert/15 text-alert">
                期限切れ <span className="num">{overdue}</span>
              </span>
            ) : dueToday > 0 ? (
              <span className="badge border-warn/45 bg-warn/15 text-warn">
                今日 <span className="num">{dueToday}</span>
              </span>
            ) : (
              <span className="num text-[11px] text-paper-faint">
                {actions.filter((a) => !a.done).length}
              </span>
            )}
          </button>

          <div className="flex-1" />

          <SyncBadge />
          <BackupBadge onOpenSettings={onOpenSettings} />

          <button
            className={`btn btn-sm ${masked ? "btn-primary" : ""}`}
            onClick={() => setMasked(!masked)}
            title="企業名・金額を伏せる（画面共有・外出先での表示用）"
          >
            {masked ? "伏せ中" : "伏せる"}
          </button>
          <button className="btn btn-sm" onClick={() => lock("manual")} title="金庫を閉じる">
            施錠
          </button>
        </header>

        {lockWarning && (
          <div className="border-b border-warn/35 bg-warn/10 px-4 py-2 text-[12px] text-warn">
            操作がないため、あと <span className="num">{secondsToLock}</span>{" "}
            秒で自動的に施錠します。画面をクリックすると解除されます。
          </div>
        )}
        {sync.state === "error" && (
          <div className="border-b border-alert/35 bg-alert/10 px-4 py-2 text-[12px] text-alert">
            同期できていません：{sync.lastError}
            {sync.pending > 0 && (
              <>
                {" "}
                未送信 <span className="num">{sync.pending}</span> 件は端末内に保持しています。
              </>
            )}
          </div>
        )}

        <main className="rise rise-2 min-w-0 flex-1 px-3 py-4 lg:px-5 lg:py-5">{children}</main>
      </div>
    </div>
  );
}

function SyncBadge() {
  const { sync, syncNow } = useVault();
  const label =
    sync.state === "syncing"
      ? "同期中"
      : sync.state === "offline"
        ? "オフライン"
        : sync.state === "error"
          ? "同期エラー"
          : sync.pending > 0
            ? "未送信あり"
            : "同期済み";
  const color =
    sync.state === "error"
      ? "#B85C38"
      : sync.state === "offline"
        ? "#C9A961"
        : sync.pending > 0
          ? "#C9A961"
          : "#4A7C59";
  return (
    <button
      className="btn btn-sm"
      onClick={() => void syncNow()}
      title={
        sync.lastSyncedAtMs
          ? `最終同期 ${relativeTime(sync.lastSyncedAtMs)}`
          : "まだ同期していません"
      }
    >
      <span
        className={`size-1.5 rounded-full ${sync.state === "syncing" ? "pulse-soft" : ""}`}
        style={{ background: color }}
      />
      <span className="hidden sm:inline">{label}</span>
      {sync.pending > 0 && <span className="num text-[11px]">{sync.pending}</span>}
    </button>
  );
}

/** 案件の状態の表示名。空（未設定）は進行中として扱う */
const CASE_STATUS_LABEL: Record<string, string> = {
  active: "進行中",
  paused: "休止中",
  done: "完了",
  lost: "失注",
};

function caseTouchedAt(c: import("../domain/types").CaseRecord): number {
  const t = Date.parse(String(c.updatedAt || c.createdAt || ""));
  return Number.isFinite(t) ? t : 0;
}

function CaseRow({ c }: { c: import("../domain/types").CaseRecord }) {
  const { state, mutate } = useVault();
  if (!state) return null;
  const active = state.currentCaseId === c.id;
  const prog = computeCaseProgress(c);
  const done = prog.filter(([, , d]) => d).length;
  const statusLabel = CASE_STATUS_LABEL[String(c.status ?? "")] ?? "";
  const touched = caseTouchedAt(c);
  return (
    <button
      onClick={() =>
        void mutate((s) => {
          s.currentCaseId = c.id;
          s.currentMode = "cases";
        })
      }
      className={`w-full rounded-sm px-2.5 py-2 text-left transition-colors ${
        active ? "bg-brand-soft" : "hover:bg-ink-700"
      }`}
      style={active ? { boxShadow: "inset 0 0 0 1px rgba(14,116,144,0.4)" } : undefined}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`truncate text-[13px] ${active ? "font-medium text-paper" : "text-paper"}`}
        >
          <Mask>{c.settings.companyName || "無題の案件"}</Mask>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {statusLabel && statusLabel !== "進行中" && (
            <span className="text-[10px] text-paper-faint">{statusLabel}</span>
          )}
          {sanpoHasConcern(c) && (
            <span className="text-[10px] font-medium" style={{ color: "#C9A961" }}>
              懸念あり
            </span>
          )}
          <span className="num text-[10px] text-paper-faint">{done}/10</span>
        </span>
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {prog.map(([tab, , d]) => (
          <span
            key={tab}
            className="h-[3px] flex-1 rounded-full"
            style={{ background: d ? "#0e7490" : "#2a2a2a" }}
          />
        ))}
      </div>
      {touched > 0 && (
        <div className="mt-1 text-[10px] text-paper-faint">
          最終更新 {relativeTime(touched)}
        </div>
      )}
    </button>
  );
}

function CaseList({
  cases,
  filtered,
}: {
  cases: import("../domain/types").CaseRecord[];
  filtered: boolean;
}) {
  // 終わった案件の折りたたみ。絞り込み中は一致したものを全部見せるため強制的に開く
  const [showClosedRaw, setShowClosed] = useState(false);
  const showClosed = showClosedRaw || filtered;
  if (cases.length === 0)
    return (
      <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-paper-faint">
        案件がありません。
        <br />
        下の「案件を追加」から始めます。
      </p>
    );

  // 状態で分けて、各グループは最終更新の新しい順に並べる。
  // 状態の変更は①案件設定で行う（操作経路は一本）。
  const byRecent = (
    a: import("../domain/types").CaseRecord,
    b: import("../domain/types").CaseRecord,
  ) => caseTouchedAt(b) - caseTouchedAt(a);
  const open = cases
    .filter((c) => !c.status || c.status === "active")
    .sort(byRecent);
  const paused = cases.filter((c) => c.status === "paused").sort(byRecent);
  const closed = cases
    .filter((c) => c.status === "done" || c.status === "lost")
    .sort(byRecent);

  return (
    <div className="space-y-3">
      <ul className="space-y-0.5">
        {open.map((c) => (
          <li key={c.id}>
            <CaseRow c={c} />
          </li>
        ))}
        {open.length === 0 && (
          <p className="px-2 py-3 text-center text-[11px] text-paper-faint">
            進行中の案件はありません。
          </p>
        )}
      </ul>

      {paused.length > 0 && (
        <div>
          <div className="px-2 pb-1 text-[10px] font-medium tracking-wide text-paper-faint">
            休止中 <span className="num">{paused.length}</span>
          </div>
          <ul className="space-y-0.5">
            {paused.map((c) => (
              <li key={c.id}>
                <CaseRow c={c} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {closed.length > 0 && (
        <div>
          <button
            className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] font-medium tracking-wide text-paper-faint hover:text-paper-dim"
            onClick={() => setShowClosed((v) => !v)}
          >
            <span>{showClosed ? "▾" : "▸"}</span>
            終わった案件 <span className="num">{closed.length}</span>
          </button>
          {showClosed && (
            <ul className="space-y-0.5">
              {closed.map((c) => (
                <li key={c.id}>
                  <CaseRow c={c} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function LeadList({ leads }: { leads: import("../domain/types").LeadRecord[] }) {
  const { state, mutate } = useVault();
  if (!state) return null;
  if (leads.length === 0)
    return (
      <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-paper-faint">
        リードがありません。
        <br />
        下の「リードを追加」から始めます。
      </p>
    );
  return (
    <ul className="space-y-0.5">
      {leads.map((l) => {
        const active = state.currentLeadId === l.id;
        const st = LEAD_STATUS_LABEL[l.status as keyof typeof LEAD_STATUS_LABEL] ?? l.status;
        return (
          <li key={l.id}>
            <button
              onClick={() =>
                void mutate((s) => {
                  s.currentLeadId = l.id;
                  s.currentMode = "leads";
                })
              }
              className={`w-full rounded-sm px-2.5 py-2 text-left transition-colors ${
                active ? "bg-brand-soft" : "hover:bg-ink-700"
              }`}
              style={active ? { boxShadow: "inset 0 0 0 1px rgba(14,116,144,0.4)" } : undefined}
            >
              <div className="truncate text-[13px] text-paper">
                <Mask>{l.company || "無題のリード"}</Mask>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-paper-faint">
                <span>{st}</span>
                {l.dealValue > 0 && (
                  <span className="num">
                    <Mask>¥{l.dealValue.toLocaleString("ja-JP")}</Mask>
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
