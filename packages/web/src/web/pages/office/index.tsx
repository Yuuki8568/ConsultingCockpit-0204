/** 自社モード — 共通時間・AI費用・容量判定・承認/事故の横断一覧 */
import { useMemo, useState } from "react";
import { useVault } from "../../hooks/use-vault";
import {
  Area,
  Empty,
  Grid,
  Note,
  NumField,
  Panel,
  Stat,
} from "../../components/kit";
import { Mask } from "../../components/mask";
import { formatYen } from "../../domain/logic/pricing";
import type { OfficeMonth } from "../../domain/types";

/** 本人の月間実働の上限（分）。資料の100時間。 */
const SELF_LIMIT_MIN = 100 * 60;
/** 容量判定で使う事故等の予約枠の既定値（時間）。資料の42時間。 */
const DEFAULT_RESERVE_H = 42;

function emptyMonth(): OfficeMonth {
  return {
    commonSelfMin: 0,
    commonAiMin: 0,
    aiCost: 0,
    note: "",
    planCommonH: null,
    planBuildH: null,
    planDiagH: null,
    planSetupH: null,
    planExtraH: null,
    planReserveH: null,
  };
}

const RUN_STATE_LABEL: Record<string, string> = {
  draft: "下書き",
  inputMissing: "入力不足",
  ready: "実行可能",
  running: "実行中",
  checking: "確認中",
  awaitingApproval: "承認待ち",
  awaitingDelivery: "納品待ち",
  done: "完了",
  failed: "失敗",
  safeStopped: "安全停止",
  closed: "終了",
};

const INCIDENT_STATUS_LABEL: Record<string, string> = {
  open: "対応中",
  fixed: "修正済み",
  closed: "終了",
};

export function OfficePage() {
  const { state, mutate } = useVault();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const rec = useMemo(() => {
    const months = state?.office?.months ?? {};
    return months[month] ?? null;
  }, [state, month]);

  const caseRows = useMemo(() => {
    if (!state) return [];
    return state.cases.map((c) => {
      const reps = (c.reports ?? []).filter((r) => r.month === month);
      const self = reps.reduce((a, r) => a + (r.timeFour?.selfMin ?? 0), 0);
      const ai = reps.reduce((a, r) => a + (r.timeFour?.aiMin ?? 0), 0);
      const wait = reps.reduce((a, r) => a + (r.timeFour?.waitMin ?? 0), 0);
      const client = reps.reduce((a, r) => a + (r.timeFour?.clientMin ?? 0), 0);
      return { id: c.id, name: c.settings.companyName || "無題の案件", self, ai, wait, client };
    });
  }, [state, month]);

  const crossApprovals = useMemo(() => {
    if (!state) return [];
    const rows: {
      caseId: string;
      company: string;
      id: string;
      operation: string;
      approver: string;
      approvedAt: string;
      changedAfter: boolean;
      result: string;
    }[] = [];
    state.cases.forEach((c) =>
      (c.execution?.approvals ?? []).forEach((a) =>
        rows.push({
          caseId: c.id,
          company: c.settings.companyName || "無題の案件",
          id: a.id,
          operation: a.operation,
          approver: a.approver,
          approvedAt: a.approvedAt,
          changedAfter: a.changedAfter,
          result: a.result,
        }),
      ),
    );
    return rows.sort((a, b) => (b.approvedAt || "").localeCompare(a.approvedAt || ""));
  }, [state]);

  const crossIncidents = useMemo(() => {
    if (!state) return [];
    const rows: {
      caseId: string;
      company: string;
      id: string;
      foundAt: string;
      impact: string;
      stopped: boolean;
      status: string;
    }[] = [];
    state.cases.forEach((c) =>
      (c.execution?.incidents ?? []).forEach((ic) =>
        rows.push({
          caseId: c.id,
          company: c.settings.companyName || "無題の案件",
          id: ic.id,
          foundAt: ic.foundAt,
          impact: ic.impact,
          stopped: ic.stopped,
          status: ic.status,
        }),
      ),
    );
    return rows.sort((a, b) => (b.foundAt || "").localeCompare(a.foundAt || ""));
  }, [state]);

  if (!state) return null;

  const m = rec ?? emptyMonth();
  const setM = (fn: (x: OfficeMonth) => void) =>
    void mutate(
      (s) => {
        if (!s.office) s.office = { months: {} };
        if (!s.office.months[month]) s.office.months[month] = emptyMonth();
        fn(s.office.months[month]);
      },
      ["meta:app"],
    );

  // 記録済みの本人実働（共通＋各案件の自己申告分）
  const recordedSelfMin =
    (m.commonSelfMin ?? 0) + caseRows.reduce((a, r) => a + r.self, 0);
  const recordedAiMin = (m.commonAiMin ?? 0) + caseRows.reduce((a, r) => a + r.ai, 0);

  // 容量判定：H = C(共通) + 顧客 + B(構築) + D(診断) + S(立上げ) + E(例外) + 予約枠
  const planParts: [string, number | null][] = [
    ["C 共通", m.planCommonH],
    ["B 構築", m.planBuildH],
    ["D 診断", m.planDiagH],
    ["S 立上げ", m.planSetupH],
    ["E 例外・顧客", m.planExtraH],
    ["予約枠（事故等）", m.planReserveH],
  ];
  const planFilled = planParts.every(([, v]) => v !== null);
  const planTotalH = planFilled
    ? planParts.reduce((a, [, v]) => a + (v ?? 0), 0)
    : null;
  const planTotalMin = planTotalH !== null ? planTotalH * 60 : null;

  return (
    <div className="space-y-4">
      <Panel
        title="自社の月次記録"
        note="案件に紐づかない共通の時間とAI費用を記録します。月を切り替えると、その月の記録に移ります。"
        right={
          <input
            type="month"
            className="field num w-[150px] py-1"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        }
      >
        {!rec && (
          <Note tone="info">
            {month} の記録はまだありません。入力すると自動で作成されます。
          </Note>
        )}
        <Grid cols={3}>
          <NumField
            label="共通の本人実働"
            value={m.commonSelfMin}
            onChange={(v) => setM((x) => void (x.commonSelfMin = v))}
            suffix="分"
            hint="発信・営業・経理・保守・見直しの合計。月100時間の上限に含めます。"
          />
          <NumField
            label="共通のAI稼働"
            value={m.commonAiMin}
            onChange={(v) => setM((x) => void (x.commonAiMin = v))}
            suffix="分"
            hint="AIが動いた時間。月100時間の本人上限には含めません。"
          />
          <NumField
            label="AI等の純増費"
            value={m.aiCost}
            onChange={(v) => setM((x) => void (x.aiCost = v))}
            suffix="円"
            step={1000}
            hint="その月に新たに掛かったAI関連の費用。"
          />
        </Grid>
        <div className="mt-3">
          <Area
            label="この月のメモ"
            value={m.note}
            onChange={(v) => setM((x) => void (x.note = v))}
            rows={2}
          />
        </div>
      </Panel>

      <Panel
        title={`${month} の時間の記録`}
        note="⑦月次報告に記入した時間4区分を案件ごとに集計したものです。案件側の入力が正本です。"
      >
        {caseRows.every((r) => r.self + r.ai + r.wait + r.client === 0) ? (
          <Empty>この月に記録された時間はまだありません。各案件の⑦月次報告で4区分を入力してください。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[640px]">
              <thead>
                <tr>
                  <th>案件</th>
                  <th className="w-24">本人</th>
                  <th className="w-24">AI</th>
                  <th className="w-24">待ち</th>
                  <th className="w-24">顧客</th>
                </tr>
              </thead>
              <tbody>
                {caseRows
                  .filter((r) => r.self + r.ai + r.wait + r.client > 0)
                  .map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Mask>{r.name}</Mask>
                      </td>
                      <td className="n">{r.self} 分</td>
                      <td className="n">{r.ai} 分</td>
                      <td className="n">{r.wait} 分</td>
                      <td className="n">{r.client} 分</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4">
          <Grid cols={3}>
            <Stat
              label="本人実働の合計（共通＋案件）"
              value={`${Math.floor(recordedSelfMin / 60)} 時間 ${recordedSelfMin % 60} 分`}
              sub={`上限 ${SELF_LIMIT_MIN / 60} 時間`}
              color={recordedSelfMin > SELF_LIMIT_MIN ? "#B85C38" : "#4A7C59"}
            />
            <Stat
              label="AI稼働の合計"
              value={`${Math.floor(recordedAiMin / 60)} 時間 ${recordedAiMin % 60} 分`}
              sub="本人上限には含めない"
            />
            <Stat
              label="AI等の純増費"
              value={<Mask>¥{formatYen(m.aiCost)}</Mask>}
            />
          </Grid>
        </div>
        {recordedSelfMin > SELF_LIMIT_MIN && (
          <div className="mt-3">
            <Note tone="alert">
              本人の実働が月 {SELF_LIMIT_MIN / 60} 時間の上限を超えています。受注の追加は止め、
              待ち時間やAIへの移し方を見直してください。
            </Note>
          </div>
        )}
      </Panel>

      <Panel
        title="容量判定（計画）"
        note="受注の前に、翌月の計画時間を入れて判定します。H = C共通 + B構築 + D診断 + S立上げ + E例外・顧客 + 予約枠。未入力の欄は0ではなく未確定として扱います。"
      >
        <Grid cols={3}>
          {planParts.map(([label, val]) => (
            <div key={label}>
              <label className="mb-1 block text-[11px] text-paper-faint">{label}（時間）</label>
              <input
                type="number"
                className="field num py-1"
                value={val === null ? "" : val}
                min={0}
                onChange={(e) =>
                  setM((x) => {
                    const raw = e.target.value;
                    const num = raw === "" ? null : Number(raw) || 0;
                    const key =
                      label === "C 共通"
                        ? "planCommonH"
                        : label === "B 構築"
                          ? "planBuildH"
                          : label === "D 診断"
                            ? "planDiagH"
                            : label === "S 立上げ"
                              ? "planSetupH"
                              : label === "E 例外・顧客"
                                ? "planExtraH"
                                : "planReserveH";
                    x[key] = num;
                  })
                }
                placeholder={label === "予約枠（事故等）" ? `例：${DEFAULT_RESERVE_H}` : "未入力"}
              />
            </div>
          ))}
        </Grid>
        <div className="mt-3">
          {planTotalMin === null ? (
            <Note tone="info">
              未入力の欄があるため判定していません。空欄を0に読み替えず、全て埋めてから判定します。
            </Note>
          ) : planTotalMin <= SELF_LIMIT_MIN ? (
            <Note tone="ok">
              計画合計 {planTotalH} 時間は、上限 {SELF_LIMIT_MIN / 60} 時間の範囲内です。
            </Note>
          ) : (
            <Note tone="alert">
              計画合計 {planTotalH} 時間は、上限 {SELF_LIMIT_MIN / 60}{" "}
              時間を超えています。この月の新規受注は見送るか、既存のどれかを縮小してください。
            </Note>
          )}
        </div>
      </Panel>

      <Panel
        title="承認の横断一覧"
        note="全案件の承認台帳を並べます。結果が未入力のものは実行済みと読み替えません。"
      >
        {crossApprovals.length === 0 ? (
          <Empty>承認記録はまだありません。各案件の⑥実行管理から記録します。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[720px]">
              <thead>
                <tr>
                  <th>案件</th>
                  <th>操作</th>
                  <th className="w-28">承認者</th>
                  <th className="w-28">承認日</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {crossApprovals.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Mask>{a.company}</Mask>
                    </td>
                    <td>{a.operation || "（未記入）"}</td>
                    <td>{a.approver || "—"}</td>
                    <td className="n">{a.approvedAt || "—"}</td>
                    <td>
                      {a.result ? (
                        a.result
                      ) : (
                        <span className="text-[12px] text-warn">結果未記入</span>
                      )}
                      {a.changedAfter && (
                        <span className="ml-2 badge border-alert/45 bg-alert/15 text-alert">
                          要再承認
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="変更・事故の横断一覧"
        note="全案件の記録を並べます。対応中のものが残っていれば先に潰します。"
      >
        {crossIncidents.length === 0 ? (
          <Empty>記録はまだありません。各案件の⑥実行管理から記録します。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[680px]">
              <thead>
                <tr>
                  <th>案件</th>
                  <th className="w-28">発見日</th>
                  <th>影響</th>
                  <th className="w-24">停止</th>
                  <th className="w-24">状態</th>
                </tr>
              </thead>
              <tbody>
                {crossIncidents.map((ic) => (
                  <tr key={ic.id}>
                    <td>
                      <Mask>{ic.company}</Mask>
                    </td>
                    <td className="n">{ic.foundAt || "—"}</td>
                    <td>{ic.impact || "（未記入）"}</td>
                    <td className="n">{ic.stopped ? "停止済み" : "—"}</td>
                    <td>
                      <span
                        className={`badge ${
                          ic.status === "open"
                            ? "border-alert/45 bg-alert/15 text-alert"
                            : ic.status === "fixed"
                              ? "border-warn/45 bg-warn/15 text-warn"
                              : "border-line text-paper-dim"
                        }`}
                      >
                        {INCIDENT_STATUS_LABEL[ic.status] ?? ic.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {crossIncidents.some((ic) => ic.status === "open") && (
          <div className="mt-3">
            <Note tone="alert">対応中の変更・事故があります。新しい受注の前に片付けてください。</Note>
          </div>
        )}
      </Panel>

      <Panel
        title="実行状態の横断一覧"
        note="全案件の「一つの仕事」の現在状態です。"
      >
        <RunItemsCross />
      </Panel>
    </div>
  );
}

function RunItemsCross() {
  const { state } = useVault();
  if (!state) return null;
  const rows: {
    caseId: string;
    company: string;
    id: string;
    title: string;
    state: string;
    updatedAt: string;
  }[] = [];
  state.cases.forEach((c) =>
    (c.execution?.runItems ?? []).forEach((r) =>
      rows.push({
        caseId: c.id,
        company: c.settings.companyName || "無題の案件",
        id: r.id,
        title: r.title,
        state: r.state,
        updatedAt: r.updatedAt,
      }),
    ),
  );
  if (rows.length === 0)
    return <Empty>記録はまだありません。各案件の⑥実行管理から登録します。</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl min-w-[640px]">
        <thead>
          <tr>
            <th>案件</th>
            <th>仕事</th>
            <th className="w-28">状態</th>
            <th className="w-28">更新日</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Mask>{r.company}</Mask>
              </td>
              <td>{r.title || "（未記入）"}</td>
              <td className="text-[12px]">{RUN_STATE_LABEL[r.state] ?? r.state}</td>
              <td className="n">{r.updatedAt || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
