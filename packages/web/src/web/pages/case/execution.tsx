/** ⑥実行管理 — タスク・成果物・KPI・枕をおさえる・三つの喜び・規矩・知見台帳 */
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import {
  Area,
  Check,
  Empty,
  Field,
  Grid,
  Note,
  NumField,
  Panel,
  Select,
  Stat,
} from "../../components/kit";
import type { Execution } from "../../domain/types";
import { KnowledgeLedger } from "./knowledge";

const PILLOW: [string, string][] = [
  ["p1", "「とりあえずAIを使ってみる」で始めていない（目的を先に決めた）"],
  ["p2", "現場の合意を取らずに、上からの号令だけで進めていない"],
  ["p3", "ベテランを外して若手だけで進めていない（暗黙知が流れ出る）"],
  ["p4", "数字の目標を置いている（置かないと成功か失敗か判断できない）"],
  ["p5", "1つの業務で最後まで通す体験を作る前に、横に広げていない"],
];

const JOYS: [string, string, string][] = [
  ["make", "作って喜ぶ", "自分（受託者）が面白がって作れているか"],
  ["sell", "売って喜ぶ", "社内で推してくれる担当者が誇れる内容か"],
  ["buy", "買って喜ぶ", "実際に使う現場が楽になっているか"],
];

const TASK_STATUS: [string, string][] = [
  ["todo", "未着手"],
  ["inprogress", "進行中"],
  ["done", "完了"],
  ["hold", "保留"],
];

const DELIVERY_STATUS: [string, string][] = [
  ["todo", "未作成"],
  ["draft", "下書き"],
  ["delivered", "納品済み"],
];

const CONTRACT_TYPES: [string, string][] = [
  ["", "未設定"],
  ["single", "単発"],
  ["1m", "1ヶ月"],
  ["3m", "3ヶ月"],
  ["monthly", "月額継続"],
];

/** 限定構築の4段階 */
const BUILD_STAGES: [string, string, string][] = [
  ["s1", "S1 仕様の固定", "対象・範囲・成果の形を書面で固定する"],
  ["s2", "S2 試作", "小さい範囲で試作し、顧客に触ってもらう"],
  ["s3", "S3 検証", "試験範囲で動かし、例外の扱いを確認する"],
  ["s4", "S4 引渡し", "手順書・台帳とともに運用へ引き渡す"],
];

const STAGE_STATUS: [string, string][] = [
  ["todo", "未着手"],
  ["doing", "進行中"],
  ["done", "完了"],
];

/** 実行状態（資料4.3の11状態。空欄を「正常」に読み替えない） */
const RUN_STATES: [string, string][] = [
  ["draft", "下書き"],
  ["inputMissing", "入力不足"],
  ["ready", "実行可能"],
  ["running", "実行中"],
  ["checking", "確認中"],
  ["awaitingApproval", "承認待ち"],
  ["awaitingDelivery", "納品待ち"],
  ["done", "完了"],
  ["failed", "失敗"],
  ["safeStopped", "安全停止"],
  ["closed", "終了"],
];

const INCIDENT_STATUS: [string, string][] = [
  ["open", "対応中"],
  ["fixed", "修正済み"],
  ["closed", "終了"],
];

function emptyExecution(): Execution {
  return {
    contractType: "",
    contractStart: "",
    contractEnd: "",
    tasks: [],
    kpi: { reductionBefore: 0, reductionAfter: 0, autorunRate: 0, reworkCount: 0 },
    deliverables: [
      { name: "プロンプト集", status: "todo", deliveredAt: "" },
      { name: "手順書", status: "todo", deliveredAt: "" },
      { name: "チェックリスト", status: "todo", deliveredAt: "" },
      { name: "運用台帳", status: "todo", deliveredAt: "" },
    ],
    graduationChecks: {
      promptDelivered: false,
      autorunCompleted: false,
      opsLedgerRunning: false,
    },
    pillowChecks: { p1: false, p2: false, p3: false, p4: false, p5: false },
    threeJoys: { make: false, sell: false, buy: false },
    kiku: { kiku1NumGoal: "", kiku2Suitability: "", kiku3OpsLog: "" },
    sankaiWeeks: 0,
    buildStages: {
      s1: { status: "todo", agreedAt: "", note: "" },
      s2: { status: "todo", agreedAt: "", note: "" },
      s3: { status: "todo", agreedAt: "", note: "" },
      s4: { status: "todo", agreedAt: "", note: "" },
    },
    runItems: [],
    approvals: [],
    incidents: [],
  };
}

export function CaseExecution() {
  const { c, patch } = useCurrentCase();
  const { mutate } = useVault();
  if (!c) return null;

  const ex = c.execution;
  const setEx = (fn: (e: Execution) => void) =>
    void patch((x) => {
      if (!x.execution) x.execution = emptyExecution();
      fn(x.execution);
    });

  if (!ex) {
    return (
      <Panel title="実行管理" note="契約が決まったら、ここで進行を管理します。">
        <Empty>
          まだ始まっていません。
          <br />
          <button className="btn btn-primary mt-3" onClick={() => setEx(() => undefined)}>
            実行管理を始める
          </button>
        </Empty>
      </Panel>
    );
  }

  const tasks = ex.tasks ?? [];
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const measures = c.flowAnalysis?.result?.measures ?? [];
  const joys = ex.threeJoys;
  const allJoy = joys.make && joys.sell && joys.buy;
  const someJoy = !allJoy && (joys.make || joys.sell || joys.buy);
  const sankai = Number(ex.sankaiWeeks ?? 0);
  const kpi = ex.kpi;
  const reduction =
    kpi.reductionBefore > 0
      ? Math.round(((kpi.reductionBefore - kpi.reductionAfter) / kpi.reductionBefore) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <Panel title="契約の期間">
        <Grid cols={3}>
          <Select
            label="契約の型"
            value={ex.contractType}
            onChange={(v) => setEx((e) => void (e.contractType = v))}
            options={CONTRACT_TYPES}
          />
          <Field
            label="開始日"
            type="date"
            value={ex.contractStart ?? ""}
            onChange={(v) => setEx((e) => void (e.contractStart = v))}
          />
          <Field
            label="終了日"
            type="date"
            value={ex.contractEnd ?? ""}
            onChange={(v) => setEx((e) => void (e.contractEnd = v))}
            hint="この日が近づくと「次にやること」に更新確認が自動で出ます。"
          />
        </Grid>
      </Panel>

      <Panel
        title="タスク"
        note={`${doneCount} / ${tasks.length} 完了`}
        right={
          <>
            {measures.length > 0 && (
              <button
                className="btn btn-sm"
                onClick={() =>
                  setEx((e) => {
                    const existing = new Set(e.tasks.map((t) => t.name));
                    measures.forEach((m) => {
                      const name = m.name.replace(/^⭐ /, "");
                      if (existing.has(name)) return;
                      e.tasks.push({
                        id: "T" + Date.now().toString(36) + m.no,
                        name,
                        owner: "",
                        due: "",
                        status: "todo",
                        note: `優先度 ${m.priority} / 道具 ${m.tool}`,
                      });
                    });
                  })
                }
              >
                ③の打ち手から取り込む（{measures.length}件）
              </button>
            )}
            <button
              className="btn btn-primary btn-sm"
              onClick={() =>
                setEx((e) =>
                  e.tasks.push({
                    id: "T" + Date.now().toString(36),
                    name: "",
                    owner: "",
                    due: "",
                    status: "todo",
                    note: "",
                  }),
                )
              }
            >
              + タスク
            </button>
          </>
        }
      >
        {tasks.length === 0 ? (
          <Empty>タスクがありません。③フロー分析の打ち手から取り込むと早いです。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[760px]">
              <thead>
                <tr>
                  <th>やること</th>
                  <th className="w-28">担当</th>
                  <th className="w-36">期限</th>
                  <th className="w-28">状態</th>
                  <th>メモ</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => (
                  <tr key={t.id}>
                    <td>
                      <input
                        className="field py-1"
                        value={t.name}
                        onChange={(e) => setEx((x) => void (x.tasks[i].name = e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        className="field py-1"
                        value={t.owner}
                        onChange={(e) => setEx((x) => void (x.tasks[i].owner = e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        className="field num py-1"
                        value={t.due}
                        onChange={(e) => setEx((x) => void (x.tasks[i].due = e.target.value))}
                      />
                    </td>
                    <td>
                      <select
                        className="field py-1"
                        value={t.status}
                        onChange={(e) =>
                          setEx((x) => {
                            x.tasks[i].status = e.target.value;
                            if (e.target.value === "done")
                              x.tasks[i].doneAt = new Date().toISOString();
                          })
                        }
                      >
                        {TASK_STATUS.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="field py-1"
                        value={t.note}
                        onChange={(e) => setEx((x) => void (x.tasks[i].note = e.target.value))}
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEx((x) => x.tasks.splice(i, 1))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="構築の4段階"
        note="限定構築は S1仕様→S2試作→S3検証→S4引渡し の順で進めます。各段階の合意日を残します。"
      >
        <div className="space-y-2">
          {BUILD_STAGES.map(([k, label, hint]) => {
            const st = ex.buildStages?.[k as "s1" | "s2" | "s3" | "s4"];
            return (
              <div
                key={k}
                className="rounded-sm border border-line bg-ink-850 px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-paper">{label}</span>
                  <select
                    className="field w-[110px] py-1"
                    value={st?.status ?? "todo"}
                    onChange={(e) =>
                      setEx((x) => void (x.buildStages[k as "s1" | "s2" | "s3" | "s4"].status = e.target.value as "todo" | "doing" | "done"))
                    }
                  >
                    {STAGE_STATUS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="field num w-[150px] py-1"
                    value={st?.agreedAt ?? ""}
                    onChange={(e) =>
                      setEx((x) => void (x.buildStages[k as "s1" | "s2" | "s3" | "s4"].agreedAt = e.target.value))
                    }
                    title="合意日"
                  />
                </div>
                <div className="mt-1 text-[11px] text-paper-faint">{hint}</div>
                <input
                  className="field mt-1.5 py-1"
                  value={st?.note ?? ""}
                  onChange={(e) =>
                    setEx((x) => void (x.buildStages[k as "s1" | "s2" | "s3" | "s4"].note = e.target.value))
                  }
                  placeholder="この段階で決めたこと・残件"
                />
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="実行状態"
        note="AIに任せた仕事ごとの今の状態です。11状態のどれかを必ず明示し、空欄を「正常」と読み替えません。"
        right={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              setEx((e) =>
                e.runItems.push({
                  id: "R" + Date.now().toString(36),
                  title: "",
                  state: "draft",
                  updatedAt: new Date().toISOString().slice(0, 10),
                  note: "",
                }),
              )
            }
          >
            + 仕事
          </button>
        }
      >
        {(ex.runItems ?? []).length === 0 ? (
          <Empty>記録する仕事がありません。AIに任せた作業が動き始めたら登録してください。</Empty>
        ) : (
          <div className="space-y-2">
            {(ex.runItems ?? []).map((r, i) => (
              <div key={r.id} className="rounded-sm border border-line bg-ink-850 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-[11px] text-paper-faint" title="実行ID">
                    {r.id}
                  </span>
                  <input
                    className="field min-w-[180px] flex-1 py-1"
                    value={r.title}
                    onChange={(e) => setEx((x) => void (x.runItems[i].title = e.target.value))}
                    placeholder="例：見積書の下書き生成"
                  />
                  <select
                    className="field w-[150px] py-1"
                    value={r.state}
                    onChange={(e) =>
                      setEx((x) => {
                        x.runItems[i].state = e.target.value as typeof r.state;
                        x.runItems[i].updatedAt = new Date().toISOString().slice(0, 10);
                      })
                    }
                  >
                    {RUN_STATES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="field num w-[150px] py-1"
                    value={r.updatedAt}
                    onChange={(e) => setEx((x) => void (x.runItems[i].updatedAt = e.target.value))}
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEx((x) => x.runItems.splice(i, 1))}
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input
                    className="field py-1"
                    value={r.owner ?? ""}
                    onChange={(e) => setEx((x) => void (x.runItems[i].owner = e.target.value))}
                    placeholder="担当（AI・人のどちらが動かすか）"
                  />
                  <input
                    className="field py-1"
                    value={r.inputRef ?? ""}
                    onChange={(e) => setEx((x) => void (x.runItems[i].inputRef = e.target.value))}
                    placeholder="入力識別子（どの入力データか）"
                  />
                  <input
                    className="field py-1"
                    value={r.configVersion ?? ""}
                    onChange={(e) => setEx((x) => void (x.runItems[i].configVersion = e.target.value))}
                    placeholder="設定版"
                  />
                  <input
                    className="field py-1"
                    value={r.expected ?? ""}
                    onChange={(e) => setEx((x) => void (x.runItems[i].expected = e.target.value))}
                    placeholder="期待結果（こうなるはず）"
                  />
                  <input
                    className="field py-1"
                    value={r.actual ?? ""}
                    onChange={(e) => setEx((x) => void (x.runItems[i].actual = e.target.value))}
                    placeholder="実結果（未確認は空欄のまま）"
                  />
                  <input
                    className="field py-1"
                    value={r.evidence ?? ""}
                    onChange={(e) => setEx((x) => void (x.runItems[i].evidence = e.target.value))}
                    placeholder="証拠（保存先・記録の参照。秘密情報そのものは入れない）"
                  />
                  <input
                    className="field py-1"
                    value={r.verifier ?? ""}
                    onChange={(e) => setEx((x) => void (x.runItems[i].verifier = e.target.value))}
                    placeholder="確認者（実行者と分ける。空欄は未確認）"
                  />
                  <input
                    className="field py-1 md:col-span-2"
                    value={r.untestedReason ?? ""}
                    onChange={(e) => setEx((x) => void (x.runItems[i].untestedReason = e.target.value))}
                    placeholder="未実施理由（試験していない場合に記入。未実施を合格にしない）"
                  />
                  <input
                    className="field py-1 md:col-span-3"
                    value={r.note}
                    onChange={(e) => setEx((x) => void (x.runItems[i].note = e.target.value))}
                    placeholder="メモ"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {(ex.runItems ?? []).some((r) => r.state === "failed" || r.state === "safeStopped") && (
          <div className="mt-3">
            <Note tone="alert">
              失敗または安全停止の仕事があります。下の「変更・事故の記録」に原因の仮説と対応を残してください。
            </Note>
          </div>
        )}
      </Panel>

      <Panel
        title="承認台帳"
        note="AIが実行し人が承認する重要操作の記録です。承認者・対象・有効条件を固定し、承認後に内容が変わったら再承認にします。結果が未入力のものを承認済みと読み替えません。"
        right={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              setEx((e) =>
                e.approvals.push({
                  id: "AP" + Date.now().toString(36),
                  operation: "",
                  approver: "",
                  target: "",
                  validCondition: "",
                  approvedAt: "",
                  changedAfter: false,
                  result: "",
                  createdAt: new Date().toISOString().slice(0, 10),
                }),
              )
            }
          >
            + 承認記録
          </button>
        }
      >
        {(ex.approvals ?? []).length === 0 ? (
          <Empty>承認記録はまだありません。送金・送信・公開などの重要操作をAIが扱うときに記録します。</Empty>
        ) : (
          <div className="space-y-2">
            {(ex.approvals ?? []).map((a, i) => (
              <div key={a.id} className="rounded-sm border border-line bg-ink-850 px-2.5 py-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input
                    className="field py-1"
                    value={a.operation}
                    onChange={(e) => setEx((x) => void (x.approvals[i].operation = e.target.value))}
                    placeholder="操作（例：請求書の送信）"
                  />
                  <input
                    className="field py-1"
                    value={a.approver}
                    onChange={(e) => setEx((x) => void (x.approvals[i].approver = e.target.value))}
                    placeholder="承認者"
                  />
                  <input
                    type="date"
                    className="field num py-1"
                    value={a.approvedAt}
                    onChange={(e) => setEx((x) => void (x.approvals[i].approvedAt = e.target.value))}
                    title="承認日"
                  />
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    className="field py-1"
                    value={a.target}
                    onChange={(e) => setEx((x) => void (x.approvals[i].target = e.target.value))}
                    placeholder="対象（内容・宛先・金額・対象版）"
                  />
                  <input
                    className="field py-1"
                    value={a.validCondition}
                    onChange={(e) => setEx((x) => void (x.approvals[i].validCondition = e.target.value))}
                    placeholder="有効条件（この条件を外れたら再承認）"
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[12px] text-paper-faint">
                    <input
                      type="checkbox"
                      className="accent-[#0e7490]"
                      checked={a.changedAfter}
                      onChange={(e) => setEx((x) => void (x.approvals[i].changedAfter = e.target.checked))}
                    />
                    承認後に内容が変わった（要再承認）
                  </label>
                  <input
                    className="field min-w-[200px] flex-1 py-1"
                    value={a.result}
                    onChange={(e) => setEx((x) => void (x.approvals[i].result = e.target.value))}
                    placeholder="実行結果（未実行は空欄のまま）"
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEx((x) => x.approvals.splice(i, 1))}
                  >
                    ✕
                  </button>
                </div>
                {a.changedAfter && (
                  <div className="mt-2">
                    <Note tone="warn">承認後に内容が変わっています。元の承認は無効として、再度承認を取ってください。</Note>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="変更・事故の記録"
        note="影響・原因の仮説・停止の有無・対応・再試験・費用の扱いを残します。起きた事実だけを書き、原因はあくまで仮説として記録します。"
        right={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              setEx((e) =>
                e.incidents.push({
                  id: "IC" + Date.now().toString(36),
                  foundAt: new Date().toISOString().slice(0, 10),
                  impact: "",
                  causeHypothesis: "",
                  stopped: false,
                  action: "",
                  retest: "",
                  costNote: "",
                  status: "open",
                }),
              )
            }
          >
            + 記録
          </button>
        }
      >
        {(ex.incidents ?? []).length === 0 ? (
          <Empty>記録はまだありません。変更や事故が起きたとき、その場で残します。</Empty>
        ) : (
          <div className="space-y-2">
            {(ex.incidents ?? []).map((ic, i) => (
              <div key={ic.id} className="rounded-sm border border-line bg-ink-850 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    className="field num w-[150px] py-1"
                    value={ic.foundAt}
                    onChange={(e) => setEx((x) => void (x.incidents[i].foundAt = e.target.value))}
                    title="発見日"
                  />
                  <select
                    className="field w-[120px] py-1"
                    value={ic.status}
                    onChange={(e) =>
                      setEx((x) => void (x.incidents[i].status = e.target.value as typeof ic.status))
                    }
                  >
                    {INCIDENT_STATUS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-[12px] text-paper-faint">
                    <input
                      type="checkbox"
                      className="accent-[#0e7490]"
                      checked={ic.stopped}
                      onChange={(e) => setEx((x) => void (x.incidents[i].stopped = e.target.checked))}
                    />
                    安全停止した
                  </label>
                  <button
                    className="btn btn-ghost btn-sm ml-auto"
                    title="この例外を知見台帳の候補として登録します（一般化は台帳側で行います）"
                    onClick={() =>
                      void mutate(
                        (s) => {
                          if (!Array.isArray(s.knowledge)) s.knowledge = [];
                          const now = new Date().toISOString();
                          s.knowledge.push({
                            id: "KN" + Date.now().toString(36),
                            title: ic.impact ? ic.impact.slice(0, 40) : "",
                            kind: "例外対応",
                            problem: ic.impact,
                            generalized: "",
                            conditions: "",
                            exclusions: "",
                            basis: "",
                            confirmedScope: "",
                            unconfirmedScope: "",
                            rightsReview: "",
                            rightsNote: "",
                            version: "",
                            approvedBy: "",
                            approvedAt: "",
                            reviewDue: "",
                            state: "候補",
                            publish: "非公開",
                            appliedRefs: [],
                            createdAt: now,
                            updatedAt: now,
                          });
                        },
                        ["meta:app"],
                      )
                    }
                  >
                    知見候補にする
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEx((x) => x.incidents.splice(i, 1))}
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    className="field py-1"
                    value={ic.impact}
                    onChange={(e) => setEx((x) => void (x.incidents[i].impact = e.target.value))}
                    placeholder="影響（何に・どれくらい）"
                  />
                  <input
                    className="field py-1"
                    value={ic.causeHypothesis}
                    onChange={(e) => setEx((x) => void (x.incidents[i].causeHypothesis = e.target.value))}
                    placeholder="原因の仮説（断定しない）"
                  />
                  <input
                    className="field py-1"
                    value={ic.action}
                    onChange={(e) => setEx((x) => void (x.incidents[i].action = e.target.value))}
                    placeholder="対応（やったこと）"
                  />
                  <input
                    className="field py-1"
                    value={ic.retest}
                    onChange={(e) => setEx((x) => void (x.incidents[i].retest = e.target.value))}
                    placeholder="再試験（どう確認したか）"
                  />
                  <input
                    className="field py-1"
                    value={ic.costNote}
                    onChange={(e) => setEx((x) => void (x.incidents[i].costNote = e.target.value))}
                    placeholder="費用の扱い（誰がどう負担するか）"
                  />
                  <input
                    className="field py-1"
                    value={ic.responsibility ?? ""}
                    onChange={(e) => setEx((x) => void (x.incidents[i].responsibility = e.target.value))}
                    placeholder="責任の所在の検討（断定しない）"
                  />
                  <input
                    className="field py-1 md:col-span-2"
                    value={ic.evidence ?? ""}
                    onChange={(e) => setEx((x) => void (x.incidents[i].evidence = e.target.value))}
                    placeholder="証拠（保存先・記録の参照。秘密情報そのものは入れない）"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="成果物" note="納品済みにしたものが、⑨法務チェックの書類の成果物リストに入ります。">
        <div className="space-y-2">
          {(ex.deliverables ?? []).map((d, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-ink-850 px-2.5 py-2"
            >
              <input
                className="field min-w-[160px] flex-1 py-1"
                value={d.name}
                onChange={(e) => setEx((x) => void (x.deliverables[i].name = e.target.value))}
              />
              <input
                className="field w-[90px] py-1"
                value={d.version ?? ""}
                onChange={(e) => setEx((x) => void (x.deliverables[i].version = e.target.value))}
                placeholder="版"
                title="成果物の版"
              />
              <select
                className="field w-[130px] py-1"
                value={d.status}
                onChange={(e) =>
                  setEx((x) => {
                    x.deliverables[i].status = e.target.value;
                    if (e.target.value === "delivered")
                      x.deliverables[i].deliveredAt = new Date().toISOString().slice(0, 10);
                  })
                }
              >
                {DELIVERY_STATUS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              {d.deliveredAt && (
                <span className="num text-[11px] text-paper-faint">{d.deliveredAt}</span>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setEx((x) => x.deliverables.splice(i, 1))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn btn-sm"
            onClick={() =>
              setEx((x) => x.deliverables.push({ name: "", status: "todo", deliveredAt: "" }))
            }
          >
            + 成果物
          </button>
        </div>
      </Panel>

      <Panel title="数字で見る成果" note="⑦月次報告のROI計算とは別に、業務そのものの変化を追います。">
        <Grid cols={4}>
          <NumField
            label="導入前の所要時間"
            value={kpi.reductionBefore}
            onChange={(v) => setEx((e) => void (e.kpi.reductionBefore = v))}
            suffix="分/件"
          />
          <NumField
            label="導入後の所要時間"
            value={kpi.reductionAfter}
            onChange={(v) => setEx((e) => void (e.kpi.reductionAfter = v))}
            suffix="分/件"
          />
          <NumField
            label="人手を離れた割合"
            value={kpi.autorunRate}
            onChange={(v) => setEx((e) => void (e.kpi.autorunRate = v))}
            suffix="%"
            min={0}
            max={100}
          />
          <NumField
            label="やり直しの発生"
            value={kpi.reworkCount}
            onChange={(v) => setEx((e) => void (e.kpi.reworkCount = v))}
            suffix="件/月"
          />
        </Grid>
        {kpi.reductionBefore > 0 && (
          <div className="mt-3">
            <Stat
              label="削減率"
              value={`${reduction}%`}
              sub={`${kpi.reductionBefore}分 → ${kpi.reductionAfter}分`}
              color={reduction >= 30 ? "#4A7C59" : reduction > 0 ? "#C9A961" : "#B85C38"}
            />
          </div>
        )}
      </Panel>

      <Panel
        title="枕をおさえる"
        note="始める前に、よくある5つの失敗筋を先に封じておくための確認です。"
      >
        <div className="space-y-1">
          {PILLOW.map(([k, label]) => (
            <Check
              key={k}
              label={label}
              checked={!!ex.pillowChecks[k]}
              onChange={(v) => setEx((e) => void (e.pillowChecks[k] = v))}
            />
          ))}
        </div>
        {Object.values(ex.pillowChecks).filter(Boolean).length < 5 && (
          <div className="mt-3">
            <Note tone="warn">
              未確認の項目があります。ここを飛ばした導入は、あとで現場が動かなくなりやすいところです。
            </Note>
          </div>
        )}
      </Panel>

      <Panel
        title="成果が止まっていないか"
        note="同じ手で2週間動かなければ、手を替えるか対象業務を替えます。"
      >
        <div className="flex items-end gap-3">
          <div className="w-32">
            <NumField
              label="成果が出ていない週数"
              value={sankai}
              onChange={(v) => setEx((e) => void (e.sankaiWeeks = v))}
              suffix="週"
              min={0}
              max={52}
            />
          </div>
        </div>
        {sankai >= 2 && (
          <div className="mt-3">
            <Note tone="alert">
              {sankai}週間、成果が出ていません。ここまでかけた手間に引きずられず、
              別の手か別の業務に切り替えることを検討してください。
            </Note>
          </div>
        )}
      </Panel>

      <Panel title="三つの喜び" note="3つ揃わない導入は、どこかで止まります。">
        <Grid cols={3}>
          {JOYS.map(([k, label, hint]) => {
            const on = !!joys[k as keyof typeof joys];
            return (
              <button
                key={k}
                onClick={() =>
                  setEx((e) => void (e.threeJoys[k as keyof typeof e.threeJoys] = !on))
                }
                className="rounded-sm border px-3 py-3 text-left transition-colors"
                style={{
                  borderColor: on ? "rgba(74,124,89,0.5)" : "var(--color-line)",
                  background: on ? "rgba(74,124,89,0.1)" : "var(--color-ink-850)",
                }}
              >
                <div className="text-[13px] font-medium text-paper">{label}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-paper-faint">{hint}</div>
              </button>
            );
          })}
        </Grid>
        <div className="mt-3">
          {allJoy ? (
            <Note tone="ok">3つ揃っています。この形なら続きます。</Note>
          ) : someJoy ? (
            <Note tone="warn">
              揃っていません。欠けている側が誰なのかを確かめてから次へ進んでください。
            </Note>
          ) : null}
        </div>
      </Panel>

      <Panel title="守るべき3つの寸法" note="ここが曖昧なままだと、終わったあと成功か失敗か判断できません。">
        <div className="space-y-3">
          <Area
            label="1. 成功の定義（必ず数字で）"
            value={ex.kiku.kiku1NumGoal}
            onChange={(v) => setEx((e) => void (e.kiku.kiku1NumGoal = v))}
            rows={2}
            hint="「効率化する」「改善する」は目標になりません。何を何分から何分にするのか、数字で書きます。"
          />
          <Area
            label="2. 誰が・どのAIを・何のために使うか"
            value={ex.kiku.kiku2Suitability}
            onChange={(v) => setEx((e) => void (e.kiku.kiku2Suitability = v))}
            rows={2}
          />
          <Area
            label="3. 運用の改善ログ"
            value={ex.kiku.kiku3OpsLog}
            onChange={(v) => setEx((e) => void (e.kiku.kiku3OpsLog = v))}
            rows={3}
            hint="業務完了報告書の「AI利用状況」欄にそのまま使えます。"
          />
        </div>
      </Panel>

      <Panel
        title="こちらが抜けても回るか"
        note="3つ揃ったら、伴走を終える相談に入れます。"
      >
        <div className="space-y-1">
          <Check
            label="プロンプト集を渡し、担当者が自分で直せる状態になっている"
            checked={ex.graduationChecks.promptDelivered}
            onChange={(v) => setEx((e) => void (e.graduationChecks.promptDelivered = v))}
          />
          <Check
            label="対象業務が、こちらの介入なしで1周した"
            checked={ex.graduationChecks.autorunCompleted}
            onChange={(v) => setEx((e) => void (e.graduationChecks.autorunCompleted = v))}
          />
          <Check
            label="運用台帳がクライアント側で回っている"
            checked={ex.graduationChecks.opsLedgerRunning}
            onChange={(v) => setEx((e) => void (e.graduationChecks.opsLedgerRunning = v))}
          />
        </div>
        {Object.values(ex.graduationChecks).every(Boolean) && (
          <div className="mt-3">
            <Note tone="ok">
              3つ揃いました。⑧継続サポートで、月額に切り替えるか一度終えるかを整理してください。
            </Note>
          </div>
        )}
      </Panel>

      <KnowledgeLedger caseId={c.id} caseName={c.settings.companyName} />
    </div>
  );
}
