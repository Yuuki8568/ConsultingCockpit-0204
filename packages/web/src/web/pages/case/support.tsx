/** ⑧継続サポート — 月額契約・面談記録・範囲・自走ロードマップ・紹介依頼 */
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import {
  Area,
  Badge,
  ConfirmButton,
  CopyButton,
  Empty,
  Field,
  Grid,
  Note,
  NumField,
  Panel,
  Sec,
  Select,
  Stat,
} from "../../components/kit";
import { Mask } from "../../components/mask";
import { calcNextBillingAlert } from "../../domain/logic/case";
import { formatYen } from "../../domain/logic/pricing";
import { MSG_TEMPLATES } from "../../domain/data/templates-msg";
import { fillTemplate, gatherTemplateContext } from "../../domain/logic/docs";
import type { Support } from "../../domain/types";
import { KnowledgeReviewList } from "./knowledge";

const RENEW: [string, string][] = [
  ["1m", "1ヶ月ごと"],
  ["3m", "3ヶ月ごと"],
  ["6m", "6ヶ月ごと"],
  ["none", "自動更新なし"],
];

const ROADMAP: [string, string][] = [
  ["m1", "1ヶ月後"],
  ["m3", "3ヶ月後"],
  ["m6", "6ヶ月後"],
  ["m12", "12ヶ月後"],
];

const SCOPE_PRESETS = {
  included: [
    "月1回のオンライン面談（60分）",
    "チャットでの質問対応（営業日24時間以内に返信）",
    "プロンプトの見直しと改訂",
    "運用台帳のレビュー",
    "月次の成果サマリ1枚",
  ],
  excluded: [
    "システムの開発・保守",
    "AIサービスの利用料の負担",
    "個人情報を含むデータの直接処理",
    "補助金申請書類の作成代行（行政書士の業務範囲）",
    "24時間の障害対応",
  ],
};

function emptySupport(): Support {
  return {
    contract: {
      startDate: "",
      endDate: "",
      monthlyFee: 0,
      autoRenew: "1m",
      noticeDays: 30,
      billingDay: "",
    },
    meetings: [],
    scope: { included: [], excluded: [] },
    graduationActions: { summary1page: "", nextProposal: "", referralRequest: "" },
    roadmap: {
      m1: { milestone: "", achieved: false, date: "" },
      m3: { milestone: "", achieved: false, date: "" },
      m6: { milestone: "", achieved: false, date: "" },
      m12: { milestone: "", achieved: false, date: "" },
    },
    nextThemes: "",
    nextMonthChoice: { choice: "", agreedAt: "", note: "" },
    dependencyChanges: [],
    safetyDeadline: "",
    handover: {
      docVersion: "",
      clientCopy: "",
      rights: "",
      manualTraining: "",
      outstanding: "",
      deletion: "",
    },
  };
}

/** 次月の選択肢（資料の月次試行。継続・縮小・低頻度・内製・移管・終了） */
const NEXT_CHOICES: [string, string][] = [
  ["", "未選択"],
  ["continue", "継続"],
  ["shrink", "縮小"],
  ["lowfreq", "低頻度化"],
  ["inhouse", "内製へ移行"],
  ["transfer", "移管"],
  ["end", "終了"],
];

/** 開始日の6ヶ月後（その日がなければ月末）を "YYYY-MM-DD" で返す。事務所の基本「初回6ヶ月」の既定値用 */
function plus6Months(start: string): string {
  const m = start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const lastDay = new Date(y, mo + 6 + 1, 0).getDate();
  const t = new Date(y, mo + 6, Math.min(d, lastDay));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function CaseSupport() {
  const { c, patch } = useCurrentCase();
  const { state } = useVault();
  if (!c || !state) return null;

  const sp = c.support;
  const setSp = (fn: (s: Support) => void) =>
    void patch((x) => {
      if (!x.support) x.support = emptySupport();
      fn(x.support);
    });

  if (!sp) {
    // 月額プランで見積が確定しているなら、月額の既定値（税抜換算）を入れて始める。手で直せる
    const feeDefault =
      c.plan === "monthly" && (c.estimate?.totalIncTax ?? 0) > 0
        ? Math.round((c.estimate?.totalIncTax ?? 0) / 1.1)
        : 0;
    return (
      <Panel title="継続サポート" note="伴走を月額に切り替えるときは、ここから始めます。">
        <Empty>
          まだ設定していません。
          {feeDefault > 0 && (
            <>
              <br />
              ④で確定した見積（税込 {c.estimate.totalIncTax.toLocaleString("ja-JP")} 円）から、月額の既定値として税抜 {feeDefault.toLocaleString("ja-JP")} 円を入れて始めます。違えばあとで直してください。
            </>
          )}
          <br />
          <button
            className="btn btn-primary mt-3"
            onClick={() =>
              setSp((s) => {
                if (feeDefault > 0) s.contract.monthlyFee = feeDefault;
              })
            }
          >
            継続サポートを設定する
          </button>
        </Empty>
      </Panel>
    );
  }

  const billing = calcNextBillingAlert(sp.contract);
  const achieved = Object.values(sp.roadmap).filter((r) => r.achieved).length;

  return (
    <div className="space-y-4">
      <Panel title="月額契約" note="永久契約にはしません。初回6ヶ月・更新3ヶ月を基本にしています。">
        <Grid cols={3}>
          <NumField
            label="月額"
            value={sp.contract.monthlyFee}
            onChange={(v) => setSp((s) => void (s.contract.monthlyFee = v))}
            suffix="円（税抜）"
            step={10000}
          />
          <Field
            label="開始日"
            type="date"
            value={sp.contract.startDate}
            onChange={(v) =>
              setSp((s) => {
                s.contract.startDate = v;
                // 終了日が空のときだけ、基本の「初回6ヶ月」に沿って自動で入れる。手で直せる
                if (v && !s.contract.endDate) {
                  const end = plus6Months(v);
                  if (end) s.contract.endDate = end;
                }
              })
            }
          />
          <Field
            label="終了日"
            type="date"
            value={sp.contract.endDate}
            onChange={(v) => setSp((s) => void (s.contract.endDate = v))}
            hint="空欄のとき開始日を入れると6ヶ月後が自動で入ります。違えば直してください。"
          />
          <Select
            label="自動更新"
            value={sp.contract.autoRenew}
            onChange={(v) => setSp((s) => void (s.contract.autoRenew = v))}
            options={RENEW}
          />
          <NumField
            label="更新を断るときの予告"
            value={sp.contract.noticeDays}
            onChange={(v) => setSp((s) => void (s.contract.noticeDays = v))}
            suffix="日前"
          />
          <Field
            label="請求日"
            value={sp.contract.billingDay}
            onChange={(v) => setSp((s) => void (s.contract.billingDay = v))}
            placeholder="25"
            mono
            hint="毎月の日付（1〜31）を入れると、次の請求日を出します。"
          />
        </Grid>

        {billing && (
          <div className="mt-3">
            <Grid cols={2}>
              <Stat
                label="次の請求日"
                value={billing.date}
                sub={`あと ${billing.daysLeft} 日`}
                color={billing.daysLeft <= 3 ? "#C9A961" : undefined}
              />
              <Stat
                label="年間の見込み"
                value={<Mask>¥{formatYen(sp.contract.monthlyFee * 12)}</Mask>}
                sub="税抜・12ヶ月換算"
              />
            </Grid>
          </div>
        )}

        <div className="mt-3">
          <Note tone="info">
            支払いは前払い（当該月の開始前に請求・入金確認後にその月のサポートを開始）が基本です。後払いに変える場合、支払期日は給付を受領した日から起算します。検収日を起算日にすると取適法に触れます。
          </Note>
        </div>
      </Panel>

      <Panel
        title="どこまでやるか・やらないか"
        note="ここを曖昧にすると、月額の範囲がじわじわ広がります。文字にしておきます。"
      >
        <Grid cols={2}>
          <div>
            <Sec>含まれること</Sec>
            <ScopeList
              items={sp.scope.included}
              presets={SCOPE_PRESETS.included}
              onChange={(items) => setSp((s) => void (s.scope.included = items))}
            />
          </div>
          <div>
            <Sec>含まれないこと</Sec>
            <ScopeList
              items={sp.scope.excluded}
              presets={SCOPE_PRESETS.excluded}
              onChange={(items) => setSp((s) => void (s.scope.excluded = items))}
            />
          </div>
        </Grid>
      </Panel>

      <Panel
        title="面談の記録"
        right={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              setSp((s) =>
                s.meetings.push({
                  id: "M" + Date.now().toString(36),
                  date: new Date().toISOString().slice(0, 10),
                  topic: "",
                  decided: "",
                  next: "",
                }),
              )
            }
          >
            + 面談を追加
          </button>
        }
      >
        {sp.meetings.length === 0 ? (
          <Empty>まだありません。月1回の面談ごとに1件足していきます。</Empty>
        ) : (
          <div className="space-y-3">
            {sp.meetings
              .slice()
              .reverse()
              .map((m) => {
                const i = sp.meetings.findIndex((z) => z.id === m.id);
                return (
                  <div key={m.id} className="rounded-sm border border-line bg-ink-850 p-3">
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <input
                        type="date"
                        className="field num w-[160px] py-1"
                        value={m.date}
                        onChange={(e) =>
                          setSp((s) => void (s.meetings[i].date = e.target.value))
                        }
                      />
                      <ConfirmButton
                        label="削除"
                        onConfirm={() => setSp((s) => s.meetings.splice(i, 1))}
                      />
                    </div>
                    <div className="space-y-2.5">
                      <Field
                        label="話した内容"
                        value={m.topic}
                        onChange={(v) => setSp((s) => void (s.meetings[i].topic = v))}
                      />
                      <Grid cols={2}>
                        <Area
                          label="決まったこと"
                          value={m.decided}
                          rows={2}
                          onChange={(v) => setSp((s) => void (s.meetings[i].decided = v))}
                        />
                        <Area
                          label="次までにやること"
                          value={m.next}
                          rows={2}
                          onChange={(v) => setSp((s) => void (s.meetings[i].next = v))}
                        />
                      </Grid>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Panel>

      <Panel
        title="自走までの道筋"
        note={`${achieved} / 4 到達。ここが埋まると、伴走を終える話が具体的にできます。`}
      >
        <div className="space-y-2.5">
          {ROADMAP.map(([k, label]) => {
            const r = sp.roadmap[k] ?? { milestone: "", achieved: false, date: "" };
            return (
              <div
                key={k}
                className="rounded-sm border px-3 py-2.5"
                style={{
                  borderColor: r.achieved ? "rgba(74,124,89,0.45)" : "var(--color-line)",
                  background: r.achieved ? "rgba(74,124,89,0.08)" : "var(--color-ink-850)",
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Badge color={r.achieved ? "#4A7C59" : "#6B665F"}>{label}</Badge>
                  <div className="flex items-center gap-2">
                    {r.achieved && r.date && (
                      <span className="num text-[11px] text-paper-faint">{r.date}</span>
                    )}
                    <button
                      className={`btn btn-sm ${r.achieved ? "btn-primary" : ""}`}
                      onClick={() =>
                        setSp((s) => {
                          const t = (s.roadmap[k] ??= {
                            milestone: "",
                            achieved: false,
                            date: "",
                          });
                          t.achieved = !t.achieved;
                          t.date = t.achieved ? new Date().toISOString().slice(0, 10) : "";
                        })
                      }
                    >
                      {r.achieved ? "到達済み" : "未到達"}
                    </button>
                  </div>
                </div>
                <input
                  className="field py-1"
                  value={r.milestone}
                  placeholder="この時点で何ができている状態にするか"
                  onChange={(e) =>
                    setSp((s) => {
                      const t = (s.roadmap[k] ??= { milestone: "", achieved: false, date: "" });
                      t.milestone = e.target.value;
                    })
                  }
                />
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <Area
            label="次に扱いたいテーマ"
            value={sp.nextThemes ?? ""}
            rows={2}
            onChange={(v) => setSp((s) => void (s.nextThemes = v))}
          />
        </div>
      </Panel>

      <Panel
        title="終わり方の準備"
        note="続ける・終える・紹介してもらう。どれも先に文面を用意しておくと動きが早くなります。"
      >
        <div className="space-y-3">
          <Area
            label="成果サマリで一番に伝えること"
            value={sp.graduationActions.summary1page}
            rows={2}
            onChange={(v) => setSp((s) => void (s.graduationActions.summary1page = v))}
          />
          <Area
            label="次に出す提案"
            value={sp.graduationActions.nextProposal}
            rows={2}
            onChange={(v) => setSp((s) => void (s.graduationActions.nextProposal = v))}
          />
          <div>
            <Area
              label="紹介のお願いの文面"
              value={sp.graduationActions.referralRequest}
              rows={4}
              onChange={(v) => setSp((s) => void (s.graduationActions.referralRequest = v))}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                className="btn btn-sm"
                onClick={() => {
                  const tpl = MSG_TEMPLATES["終了"]?.find((t) => t.name === "紹介のお願い");
                  if (!tpl) return;
                  const ctx = gatherTemplateContext(c, state);
                  const filled = fillTemplate(tpl.body, ctx);
                  setSp((s) => void (s.graduationActions.referralRequest = filled.text));
                }}
              >
                雛形から入れる
              </button>
              {sp.graduationActions.referralRequest && (
                <CopyButton text={sp.graduationActions.referralRequest} />
              )}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Note tone="info">
            紹介をもらった場合、紹介料のやり取りはしない前提です（士業紹介での紹介料授受は避けます）。
          </Note>
        </div>
      </Panel>

      <Panel
        title="次月の選択"
        note="月次試行は1か月単位です。次月は自動で続けるのではなく、明示的に合意を取ります。"
      >
        <Grid cols={3}>
          <Select
            label="次月の方針"
            value={sp.nextMonthChoice?.choice ?? ""}
            onChange={(v) =>
              setSp((s) => void (s.nextMonthChoice.choice = v as typeof s.nextMonthChoice.choice))
            }
            options={NEXT_CHOICES}
          />
          <Field
            label="合意した日"
            type="date"
            value={sp.nextMonthChoice?.agreedAt ?? ""}
            onChange={(v) => setSp((s) => void (s.nextMonthChoice.agreedAt = v))}
          />
          <Field
            label="安全確認の期限"
            type="date"
            value={sp.safetyDeadline ?? ""}
            onChange={(v) => setSp((s) => void (s.safetyDeadline = v))}
            hint="この日までに安全性の再確認が取れなければ停止します。"
          />
        </Grid>
        <div className="mt-3">
          <Area
            label="方針の理由・条件"
            value={sp.nextMonthChoice?.note ?? ""}
            rows={2}
            onChange={(v) => setSp((s) => void (s.nextMonthChoice.note = v))}
            hint="縮小・低頻度化・内製への移行を選んだ場合、何をどこまで続けるかを書きます。"
          />
        </div>
        {sp.nextMonthChoice?.choice === "" && (
          <div className="mt-3">
            <Note tone="warn">次月の方針が未選択です。未選択のまま翌月に入る自動継続はしません。</Note>
          </div>
        )}
      </Panel>

      <Panel
        title="依存先の変更記録"
        note="外部サービス・権限・連絡先など、運用が依存している先の変更を記録します。M3の判断材料になります。"
        right={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              setSp((s) =>
                s.dependencyChanges.push({
                  id: "DC" + Date.now().toString(36),
                  at: new Date().toISOString().slice(0, 10),
                  source: "",
                  impact: "",
                  action: "",
                }),
              )
            }
          >
            + 記録
          </button>
        }
      >
        {(sp.dependencyChanges ?? []).length === 0 ? (
          <Empty>記録はまだありません。依存先の仕様変更や権限変更を検知したら残します。</Empty>
        ) : (
          <div className="space-y-2">
            {(sp.dependencyChanges ?? []).map((d, i) => (
              <div key={d.id} className="rounded-sm border border-line bg-ink-850 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    className="field num w-[150px] py-1"
                    value={d.at}
                    onChange={(e) => setSp((s) => void (s.dependencyChanges[i].at = e.target.value))}
                  />
                  <input
                    className="field min-w-[160px] flex-1 py-1"
                    value={d.source}
                    onChange={(e) => setSp((s) => void (s.dependencyChanges[i].source = e.target.value))}
                    placeholder="依存先（例：〇〇API、社内権限）"
                  />
                  <button
                    className="btn btn-ghost btn-sm ml-auto"
                    onClick={() => setSp((s) => s.dependencyChanges.splice(i, 1))}
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    className="field py-1"
                    value={d.impact}
                    onChange={(e) => setSp((s) => void (s.dependencyChanges[i].impact = e.target.value))}
                    placeholder="影響（変わらない／検証する／停止する）"
                  />
                  <input
                    className="field py-1"
                    value={d.action}
                    onChange={(e) => setSp((s) => void (s.dependencyChanges[i].action = e.target.value))}
                    placeholder="対応（いつまでに何をするか）"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="移管・終了票"
        note="内製化・移管・終了を選んだとき、引き継ぎの状態をここに固定します。"
      >
        <div className="space-y-3">
          <Grid cols={2}>
            <Area
              label="手順書・資料の版"
              value={sp.handover?.docVersion ?? ""}
              rows={2}
              onChange={(v) => setSp((s) => void (s.handover.docVersion = v))}
              hint="渡した資料の名前と版（日付）を書きます。"
            />
            <Area
              label="顧客側に残すもの"
              value={sp.handover?.clientCopy ?? ""}
              rows={2}
              onChange={(v) => setSp((s) => void (s.handover.clientCopy = v))}
              hint="プロンプト集・手順書・運用台帳のコピーなど。"
            />
            <Area
              label="権限の扱い"
              value={sp.handover?.rights ?? ""}
              rows={2}
              onChange={(v) => setSp((s) => void (s.handover.rights = v))}
              hint="こちらの権限は全て外す。顧客側の権限は誰に移すか。"
            />
            <Area
              label="手動で回す場合の手順の説明"
              value={sp.handover?.manualTraining ?? ""}
              rows={2}
              onChange={(v) => setSp((s) => void (s.handover.manualTraining = v))}
              hint="AIが止まっても業務が回るよう、手動手順を誰に説明したか。"
            />
            <Area
              label="未完了・残件"
              value={sp.handover?.outstanding ?? ""}
              rows={2}
              onChange={(v) => setSp((s) => void (s.handover.outstanding = v))}
            />
            <Area
              label="こちらが保持するデータの削除"
              value={sp.handover?.deletion ?? ""}
              rows={2}
              onChange={(v) => setSp((s) => void (s.handover.deletion = v))}
              hint="いつ・何を削除したか。削除しない場合はその理由。"
            />
          </Grid>
        </div>
      </Panel>

      <KnowledgeReviewList />
    </div>
  );
}

function ScopeList({
  items,
  presets,
  onChange,
}: {
  items: string[];
  presets: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className="field flex-1 py-1"
            value={it}
            onChange={(e) => {
              const next = items.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onChange(items.filter((_, z) => z !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <button className="btn btn-sm" onClick={() => onChange([...items, ""])}>
          + 追加
        </button>
        {presets
          .filter((p) => !items.includes(p))
          .slice(0, 3)
          .map((p) => (
            <button
              key={p}
              className="btn btn-sm text-[11px]"
              onClick={() => onChange([...items, p])}
              title="よく使う項目"
            >
              + {p.length > 16 ? p.slice(0, 16) + "…" : p}
            </button>
          ))}
      </div>
    </div>
  );
}
