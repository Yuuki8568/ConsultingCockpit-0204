/** リード④ 営業プロセス — ステージ進行・商談準備・評価・関係者・異議処理・週次KPI */
import { useState } from "react";
import { useVault } from "../../hooks/use-vault";
import { useCurrentLead } from "../../hooks/use-current";
import {
  Area,
  Check,
  ConfirmButton,
  CopyButton,
  Empty,
  Field,
  Grid,
  Modal,
  Note,
  NumField,
  Panel,
  Sec,
  Select,
  Stat,
} from "../../components/kit";
import { Mask } from "../../components/mask";
import {
  LEAD_KINDS,
  OBJECTION_HANDBOOK,
  QUALIFICATION_AXES,
  SALES_STAGES,
  STAGE_ACTIONS,
  STAGE_PROBABILITY,
  STAKEHOLDER_ROLES,
} from "../../domain/data/sales";
import {
  calcQualScore,
  computeNBA,
  getWeekKey,
  qualHealthLabel,
} from "../../domain/logic/sales";
import { formatYen } from "../../domain/logic/pricing";
import type { PrepSheet, SalesStage } from "../../domain/types";

const PREP_FIELDS: [keyof PrepSheet, string, string][] = [
  ["companyResearch", "下調べ", "公開情報・直近のニュース・採用ページで分かったこと"],
  ["assumedIssues", "課題の見立て", "何に困っていそうか。仮説でよい"],
  ["keyPerson", "鍵になる人", "誰が決めるか。誰が推してくれそうか"],
  ["budget", "予算感", "分かっている範囲で"],
  ["competitors", "比較されそうな相手", "他社・社内対応・何もしない"],
  ["questions", "この場で必ず聞くこと", "3つまでに絞る"],
  ["goal", "この商談のゴール", "次のアポを取る／決裁者に会う など"],
  ["nextStepPlan", "次の一歩の案", "その場で提示できるように用意しておく"],
];

const STANCE: [string, string][] = [
  ["", "未確認"],
  ["positive", "前向き"],
  ["neutral", "どちらでもない"],
  ["negative", "慎重・反対"],
];

/** FDE受注条件の7項目（資料2章）。案件側の確認と同じ条件を営業前に見る */
const FDE_FIT_ITEMS: [string, string][] = [
  ["monthlyWork", "毎月案件が動き、照合・未処理・例外の判断が繰り返し発生する"],
  ["ownerAndProxy", "顧客の責任者と代行者がおり、原資料と最終業務判断を担える"],
  ["clientCanStop", "顧客が事務所の操作を待たずに停止・手動処理・資料取得を行える"],
  ["manualFallback", "代表的な繁忙量でも、手動代替が実際の期限内に終わる"],
  ["leaveData", "データ、設定、手順、試験結果、必要な利用権を顧客側に残せる"],
  ["comparable", "内製・他社等との費用・品質・負担の比較ができる"],
  ["draftValue", "下書き・月次点検で価値があり、即応や無人での重要操作を必要としない"],
];

export function LeadProcess() {
  const { state, mutate } = useVault();
  const { l, patch } = useCurrentLead();
  const [objOpen, setObjOpen] = useState(false);

  if (!state) return null;
  if (!l)
    return (
      <Empty>
        {state.leads.length === 0
          ? "まだリードがありません。「① 追加・文面」から登録します。"
          : "左の一覧からリードを選んでください。"}
      </Empty>
    );

  const q = calcQualScore(l);
  const health = qualHealthLabel(q.pct);
  const nba = computeNBA(l);
  const stageIdx = SALES_STAGES.findIndex(([k]) => k === l.salesStage);
  const stageActions = (STAGE_ACTIONS as Record<string, string[]>)[l.salesStage] ?? [];
  const defaultProb = (STAGE_PROBABILITY as Record<string, number>)[l.salesStage] ?? 10;
  const daysInStage = Math.floor(
    (Date.now() - new Date(l.stageEnteredAt).getTime()) / 86400000,
  );

  const weekKey = getWeekKey(new Date());
  const thisWeek = state.salesKpi.log.find((w) => w.week === weekKey) ?? {
    week: weekKey,
    approach: 0,
    meeting: 0,
    proposal: 0,
  };
  const targets = state.salesKpi.targets;

  // 連絡停止は企業単位: 同じ企業名のいずれかのリードで停止が立っていれば、この企業全体を停止扱いにする
  const companyStopped = state.leads.some(
    (x) => x.company && x.company === l.company && x.contactStop?.stopped,
  );
  const inheritedStop =
    companyStopped && !l.contactStop?.stopped;
  // 禁止・停止要請は承認チェックだけでは解除できない。窓口判定か連絡停止の更新が先
  const contactBlocked = companyStopped || l.contactFit === "prohibited";

  function bumpWeek(field: "approach" | "meeting" | "proposal", delta: number) {
    void mutate((s) => {
      let w = s.salesKpi.log.find((x) => x.week === weekKey);
      if (!w) {
        w = { week: weekKey, approach: 0, meeting: 0, proposal: 0 };
        s.salesKpi.log.push(w);
      }
      w[field] = Math.max(0, w[field] + delta);
    }, ["meta:app"]);
  }

  return (
    <div className="space-y-4">
      <Panel
        title={
          <>
            <Mask>{l.company}</Mask> の進行
          </>
        }
        note={`いまのステージに入ってから ${daysInStage} 日`}
      >
        {/* ステージの帯 */}
        <div className="flex flex-wrap gap-1">
          {SALES_STAGES.map(([k, label, color], i) => {
            const passed = i <= stageIdx;
            const current = i === stageIdx;
            return (
              <button
                key={k}
                onClick={() =>
                  void patch((x) => {
                    x.salesStage = k as SalesStage;
                    x.stageEnteredAt = new Date().toISOString();
                    if (k === "won" && x.status !== "converted") x.status = "meeting";
                  })
                }
                className="min-w-[110px] flex-1 rounded-sm border px-2 py-2 text-[12px] transition-colors"
                style={{
                  borderColor: current ? color : passed ? `${color}66` : "var(--color-line)",
                  background: current ? `${color}26` : passed ? `${color}10` : "var(--color-ink-850)",
                  color: passed ? "var(--color-paper)" : "var(--color-paper-dim)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <Grid cols={4}>
            <NumField
              label="想定金額"
              value={l.dealValue}
              onChange={(v) => void patch((x) => void (x.dealValue = v))}
              suffix="円"
              step={100000}
            />
            <NumField
              label="確度（空ならステージ標準）"
              value={l.winProbability ?? defaultProb}
              onChange={(v) => void patch((x) => void (x.winProbability = v))}
              suffix="%"
              min={0}
              max={100}
              step={5}
              hint={`ステージ標準は ${defaultProb}%`}
            />
            <Stat
              label="見込み"
              value={
                <Mask>
                  ¥{formatYen(Math.round((l.dealValue * (l.winProbability ?? defaultProb)) / 100))}
                </Mask>
              }
            />
            <Stat label="評価" value={`${q.pct}%`} sub={health.label} color={health.color} />
          </Grid>
        </div>

        {stageActions.length > 0 && (
          <div className="mt-4">
            <Sec>このステージでやること</Sec>
            <div className="flex flex-wrap gap-1.5">
              {stageActions.map((a, i) => (
                <button
                  key={i}
                  className="btn btn-sm"
                  onClick={() =>
                    void patch((x) =>
                      x.nextActions.push({
                        id: "A" + Date.now().toString(36) + i,
                        text: a,
                        due: "",
                        done: false,
                        source: "stage",
                      }),
                    )
                  }
                  title="次にやることに追加"
                >
                  + {a}
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="次の一手" note="評価の欠けとステージから、いま埋めるべきものを出しています。">
        {nba.length === 0 ? (
          <Note tone="ok">主要な項目は埋まっています。あとは前に進めるだけです。</Note>
        ) : (
          <ul className="space-y-1.5">
            {nba.map((n, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-sm border border-line bg-ink-850 px-3 py-2 text-[13px] leading-relaxed"
              >
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand" />
                <span className="flex-1">{n}</span>
                <button
                  className="btn btn-ghost btn-sm shrink-0"
                  onClick={() =>
                    void patch((x) =>
                      x.nextActions.push({
                        id: "A" + Date.now().toString(36) + i,
                        text: n,
                        due: "",
                        done: false,
                        source: "nba",
                      }),
                    )
                  }
                >
                  追加
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="案件の見立て" note="0＝未確認、1＝ある程度、2＝確認できている。">
        <div className="space-y-2.5">
          {(["BANT", "MEDDIC"] as const).map((fw) => (
            <div key={fw}>
              <Sec>{fw}</Sec>
              <div className="space-y-1.5">
                {QUALIFICATION_AXES.filter((a) => a.fw === fw).map((a) => {
                  const cur = Number(l.qualification[a.id] ?? 0);
                  return (
                    <div key={a.id} className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[220px] flex-1">
                        <div className="text-[13px] text-paper">{a.label}</div>
                        <div className="text-[11px] text-paper-faint">{a.hint}</div>
                      </div>
                      <div className="flex gap-1">
                        {[0, 1, 2].map((v) => (
                          <button
                            key={v}
                            onClick={() => void patch((x) => void (x.qualification[a.id] = v))}
                            className={`num w-9 rounded-sm border py-1 text-[12px] transition-colors ${
                              cur === v
                                ? "border-brand/60 bg-brand-soft text-paper"
                                : "border-line text-paper-dim hover:text-paper"
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Stat
            label="合計"
            value={`${q.score} / ${q.max}（${q.pct}%）`}
            sub={health.label}
            color={health.color}
          />
        </div>
      </Panel>

      <Panel
        title="FDE適合確認"
        note="受けていい仕事かを、受注前に7項目で確認します。空欄は未確認のまま残し、「問題ない」と読み替えません。"
      >
        <div className="space-y-2">
          {FDE_FIT_ITEMS.map(([key, label]) => {
            const cur = l.fit?.items?.[key] ?? "";
            return (
              <div
                key={key}
                className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-ink-850 px-3 py-2"
              >
                <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-paper">
                  {label}
                </span>
                <div className="flex gap-1">
                  {(["ok", "ng", "unknown"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() =>
                        void patch((x) => {
                          if (!x.fit) x.fit = { items: {}, verdict: "", reason: "", contactApproved: false };
                          x.fit.items[key] = x.fit.items[key] === v ? "" : v;
                        })
                      }
                      className={`w-[68px] rounded-sm border py-1 text-[11px] transition-colors ${
                        cur === v
                          ? v === "ok"
                            ? "border-[#4A7C59]/60 bg-[#4A7C59]/15 text-paper"
                            : v === "ng"
                              ? "border-[#B85C38]/60 bg-[#B85C38]/15 text-paper"
                              : "border-[#C9A961]/60 bg-[#C9A961]/15 text-paper"
                          : "border-line text-paper-dim hover:text-paper"
                      }`}
                    >
                      {v === "ok" ? "合っている" : v === "ng" ? "合わない" : "未確認"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <Grid cols={2}>
            <Select
              label="判定"
              value={l.fit?.verdict ?? ""}
              onChange={(v) =>
                void patch((x) => {
                  if (!x.fit) x.fit = { items: {}, verdict: "", reason: "", contactApproved: false };
                  x.fit.verdict = v as typeof x.fit.verdict;
                })
              }
              options={[
                ["", "未判定"],
                ["fit", "適合する（受けられる）"],
                ["unfit", "適合しない（受けない）"],
                ["undecided", "判断保留"],
              ]}
            />
            <Select
              label="FDE営業段階"
              value={l.fdeStage ?? ""}
              onChange={(v) => void patch((x) => void (x.fdeStage = v as typeof x.fdeStage))}
              options={[
                ["", "未設定"],
                ["fit", "適合確認"],
                ["diagnosis", "診断受注"],
                ["build", "構築受注"],
                ["trial", "月次試行"],
                ["retained", "有料継続"],
              ]}
            />
          </Grid>
        </div>
        <div className="mt-3">
          <Area
            label="判定の理由"
            value={l.fit?.reason ?? ""}
            rows={2}
            onChange={(v) =>
              void patch((x) => {
                if (!x.fit) x.fit = { items: {}, verdict: "", reason: "", contactApproved: false };
                x.fit.reason = v;
              })
            }
            hint="受ける・受けないの判断の根拠を残します。判定なしに営業を進めません。"
          />
        </div>
        <div className="mt-3">
          {contactBlocked && (
            <div className="mb-2">
              <Note tone="alert">
                {companyStopped && "この企業は連絡停止が記録されています。"}
                {l.contactFit === "prohibited" && "窓口判定が「禁止・用途不一致」です。"}
                解除するには下の「出典と窓口」で根拠を確認して状態を更新します。承認チェックだけでは解除できません。
              </Note>
            </div>
          )}
          <label className="flex items-center gap-2 text-[12px] text-paper">
            <input
              type="checkbox"
              className="accent-[#0e7490]"
              disabled={contactBlocked}
              checked={l.fit?.contactApproved ?? false}
              onChange={(e) =>
                void patch((x) => {
                  if (!x.fit) x.fit = { items: {}, verdict: "", reason: "", contactApproved: false };
                  x.fit.contactApproved = e.target.checked;
                })
              }
            />
            この相手への接触（文面の送信）を承認する
          </label>
          <p className="mt-1 text-[11px] text-paper-faint">
            AIが作った文面は、送信前にこの承認を目視で入れます。
            {contactBlocked && "いまは連絡停止または窓口判定「禁止・用途不一致」のため承認できません。"}
          </p>
        </div>
        <div className="mt-4 border-t border-line pt-3">
          <Select
            label="このリードの情報の区別"
            value={l.infoBasis ?? ""}
            onChange={(v) => void patch((x) => void (x.infoBasis = v as typeof x.infoBasis))}
            options={[
              ["", "未設定"],
              ["declared", "本人申告（相手が直接答えた）"],
              ["interpretation", "こちらの解釈（推測を含む）"],
              ["unconfirmed", "未確認"],
            ]}
            hint="記録している情報がどれにあたるかを区別します。サイトの選択回答だけで受注可とは判定しません。"
          />
          <div className="mt-3">
            <Area
              label="相談メモの貼り付け"
              value={l.consultMemo ?? ""}
              rows={3}
              onChange={(v) => void patch((x) => void (x.consultMemo = v))}
              placeholder="サイトの相談フォーム等の内容を手動でコピーして貼り付ける欄です"
              hint="専用の取り込み機能はありません。貼り付けた内容は「本人申告」として上の区別に反映してください。"
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="出典と窓口"
        note="公開情報の根拠（出典）と、連絡してよい窓口かの判定を分けて記録します。「禁止の記載が見つからない」を受付可とは読み替えません。"
        right={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              void patch((x) => {
                if (!x.sources) x.sources = [];
                x.sources.push({
                  id: "SRC" + Date.now().toString(36),
                  url: "",
                  pageTitle: "",
                  excerpt: "",
                  confirmedAt: new Date().toISOString().slice(0, 10),
                });
              })
            }
          >
            + 出典
          </button>
        }
      >
        {(l.sources ?? []).length === 0 ? (
          <Empty>
            まだ出典がありません。募集ページや公式情報のURL・ページ題名・根拠の抜粋・確認日を記録します。
          </Empty>
        ) : (
          <div className="space-y-2">
            {(l.sources ?? []).map((src, i) => (
              <div key={src.id} className="rounded-sm border border-line bg-ink-850 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[240px] flex-1">
                    <Field
                      label="URL"
                      value={src.url}
                      onChange={(v) => void patch((x) => void (x.sources![i].url = v))}
                    />
                  </div>
                  <div className="w-[150px]">
                    <Field
                      label="確認日"
                      type="date"
                      value={src.confirmedAt}
                      onChange={(v) => void patch((x) => void (x.sources![i].confirmedAt = v))}
                    />
                  </div>
                  <ConfirmButton
                    label="削除"
                    onConfirm={() => void patch((x) => x.sources!.splice(i, 1))}
                  />
                </div>
                <div className="mt-2">
                  <Field
                    label="ページ題名"
                    value={src.pageTitle}
                    onChange={(v) => void patch((x) => void (x.sources![i].pageTitle = v))}
                  />
                </div>
                <div className="mt-2">
                  <Area
                    label="根拠の抜粋（必要最小限）"
                    value={src.excerpt}
                    rows={2}
                    onChange={(v) => void patch((x) => void (x.sources![i].excerpt = v))}
                    hint="判断の根拠になった一文だけを抜き出します。ページ全文の転載はしません。"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 border-t border-line pt-3">
          <Select
            label="募集種別"
            value={l.leadKind ?? ""}
            onChange={(v) => void patch((x) => void (x.leadKind = v as typeof x.leadKind))}
            options={LEAD_KINDS}
            hint="雇用求人は課題仮説の参考情報です。外注募集としては扱いません。"
          />
          {l.leadKind === "jobPosting" && (
            <div className="mt-2">
              <Note tone="alert">
                雇用求人への営業は行いません（採用応募フォームへのサービス営業は禁止）。課題の参考情報としてのみ記録します。
              </Note>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <Select
            label="接触経路（こちらから送った場合）"
            value={l.channel ?? ""}
            onChange={(v) => void patch((x) => void (x.channel = v as typeof x.channel))}
            options={[
              ["", "未設定"],
              ["email", "メール"],
              ["form", "問い合わせフォーム"],
            ]}
            hint="ファイル取り込みで自動で入ります。相手から届いた問い合わせは募集種別の「HP相談」で扱い、ここは空欄のままにします。"
          />
          {(l.channel || l.sentBody) && (
            <div className="mt-2">
              <Area
                label="送信した本文（記録）"
                value={l.sentBody ?? ""}
                rows={4}
                onChange={(v) => void patch((x) => void (x.sentBody = v))}
                hint="取り込んだ送信文の記録です。相手から届いた問い合わせの内容は上の相談メモに入れます。"
              />
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <Grid cols={3}>
            <Select
              label="窓口判定"
              value={l.contactFit ?? ""}
              onChange={(v) => void patch((x) => void (x.contactFit = v as typeof x.contactFit))}
              options={[
                ["", "未設定"],
                ["accepted", "受付明示あり"],
                ["prohibited", "禁止・用途不一致"],
                ["unknown", "不明"],
              ]}
              hint="「禁止の記載がない」を受付可と読み替えません。不明なら送信対象にしません。"
            />
            <Select
              label="送信状態"
              value={l.sendState ?? ""}
              onChange={(v) => void patch((x) => void (x.sendState = v as typeof x.sendState))}
              options={[
                ["", "未設定（未作成）"],
                ["draft", "下書き"],
                ["sent", "送信確認済み"],
                ["failed", "未送信確定"],
                ["unknown", "結果不明"],
              ]}
              hint="案件段階とは別に記録します。結果不明は自動再送せず、受付の有無を人が照合します。"
            />
            <Select
              label="返信状態"
              value={l.replyState ?? ""}
              onChange={(v) =>
                void patch((x) => {
                  x.replyState = v as typeof x.replyState;
                  if (v === "refused") {
                    if (!x.contactStop) x.contactStop = { stopped: false, reason: "", at: "" };
                    x.contactStop.stopped = true;
                    if (!x.contactStop.at) x.contactStop.at = new Date().toISOString().slice(0, 10);
                  }
                })
              }
              options={[
                ["", "未設定"],
                ["none", "未返信"],
                ["replied", "返信あり"],
                ["refused", "拒否・停止要請"],
              ]}
              hint="「拒否・停止要請」を選ぶと連絡停止も同時に記録します。返信ありから受注へ自動では進みません。"
            />
          </Grid>
        </div>

        <div className="mt-4 border-t border-line pt-3">
          {inheritedStop && (
            <div className="mb-2">
              <Note tone="alert">
                同じ企業の別リードで連絡停止が記録されているため、この企業全体が停止扱いです。
              </Note>
            </div>
          )}
          <Check
            label="この企業への連絡を停止する"
            checked={l.contactStop?.stopped ?? false}
            onChange={(v) =>
              void patch((x) => {
                if (!x.contactStop) x.contactStop = { stopped: false, reason: "", at: "" };
                x.contactStop.stopped = v;
                if (v && !x.contactStop.at)
                  x.contactStop.at = new Date().toISOString().slice(0, 10);
              })
            }
            hint="拒否・停止要請を受けたときに記録します。同じ企業名の全リードに継承されます。"
          />
          {(l.contactStop?.stopped ?? false) && (
            <div className="mt-2">
              <Grid cols={2}>
                <Field
                  label="停止を記録した日"
                  type="date"
                  value={l.contactStop?.at ?? ""}
                  onChange={(v) => void patch((x) => void (x.contactStop!.at = v))}
                />
                <Field
                  label="停止の理由"
                  value={l.contactStop?.reason ?? ""}
                  onChange={(v) => void patch((x) => void (x.contactStop!.reason = v))}
                />
              </Grid>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="商談の準備" note="ここを埋めてから商談に入ると、聞き漏らしが減ります。">
        <div className="space-y-3">
          {PREP_FIELDS.map(([k, label, hint]) => (
            <Area
              key={k}
              label={label}
              value={l.prepSheet[k] ?? ""}
              rows={2}
              onChange={(v) =>
                void patch((x) => {
                  x.prepSheet[k] = v;
                })
              }
              hint={hint}
            />
          ))}
        </div>
        <div className="mt-3">
          <CopyButton
            text={PREP_FIELDS.map(
              ([k, label]) =>
                `【${label}】\n${l.prepSheet[k] || "（未記入）"}`,
            ).join("\n\n")}
            label="準備シートをコピー"
          />
        </div>
      </Panel>

      <Panel
        title="関係者"
        note="決める人・推してくれる人・抵抗する人を分けて把握します。"
        right={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              void patch((x) =>
                x.stakeholders.push({
                  id: "S" + Date.now().toString(36),
                  name: "",
                  role: "user",
                  stance: "",
                  note: "",
                }),
              )
            }
          >
            + 関係者
          </button>
        }
      >
        {l.stakeholders.length === 0 ? (
          <Empty>まだ登録していません。少なくとも「最終的に決める人」は押さえておきます。</Empty>
        ) : (
          <div className="space-y-2">
            {l.stakeholders.map((sh, i) => {
              const roleDef = STAKEHOLDER_ROLES.find(([k]) => k === sh.role);
              return (
                <div key={sh.id} className="rounded-sm border border-line bg-ink-850 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[140px] flex-1">
                      <Field
                        label="氏名・役職"
                        value={sh.name}
                        onChange={(v) => void patch((x) => void (x.stakeholders[i].name = v))}
                      />
                    </div>
                    <div className="w-[130px]">
                      <Select
                        label="立場"
                        value={sh.role}
                        onChange={(v) => void patch((x) => void (x.stakeholders[i].role = v))}
                        options={STAKEHOLDER_ROLES.map(([k, lab]) => [k, lab] as [string, string])}
                      />
                    </div>
                    <div className="w-[150px]">
                      <Select
                        label="こちらへの姿勢"
                        value={sh.stance}
                        onChange={(v) => void patch((x) => void (x.stakeholders[i].stance = v))}
                        options={STANCE}
                      />
                    </div>
                    <ConfirmButton
                      label="削除"
                      onConfirm={() => void patch((x) => x.stakeholders.splice(i, 1))}
                    />
                  </div>
                  {roleDef && (
                    <p className="mt-1.5 text-[11px]" style={{ color: roleDef[2] }}>
                      {roleDef[3]}
                    </p>
                  )}
                  <div className="mt-2">
                    <input
                      className="field py-1 text-[12px]"
                      placeholder="メモ（気にしている点・過去のやり取りなど）"
                      value={sh.note}
                      onChange={(e) =>
                        void patch((x) => void (x.stakeholders[i].note = e.target.value))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="断られたときの返し方"
        note="値引きで応じるのではなく、範囲で調整します。"
        right={
          <button className="btn btn-sm" onClick={() => setObjOpen(true)}>
            開く
          </button>
        }
      >
        <p className="text-[12px] leading-relaxed text-paper-dim">
          よくある{OBJECTION_HANDBOOK.length}
          パターンについて、共感の一言・確認すべき本質・取れる選択肢を並べています。
        </p>
      </Panel>

      <Panel title="今週の動き" note="件数を数えるだけの欄です。少なすぎたら手を動かします。">
        <Grid cols={3}>
          {(
            [
              ["approach", "新規の接触", targets.weeklyApproach],
              ["meeting", "商談", targets.weeklyMeeting],
              ["proposal", "提案", targets.monthlyProposal],
            ] as const
          ).map(([k, label, target]) => {
            const v = thisWeek[k];
            const reached = v >= target;
            return (
              <div key={k} className="rounded-sm border border-line bg-ink-850 px-3 py-2.5">
                <div className="text-[11px] text-paper-dim">{label}</div>
                <div className="mt-1 flex items-center gap-2">
                  <button className="btn btn-sm" onClick={() => bumpWeek(k, -1)}>
                    −
                  </button>
                  <span
                    className="num flex-1 text-center text-[19px] font-medium"
                    style={{ color: reached ? "#4A7C59" : undefined }}
                  >
                    {v}
                  </span>
                  <button className="btn btn-sm" onClick={() => bumpWeek(k, 1)}>
                    ＋
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-paper-faint">目標 {target}</div>
              </div>
            );
          })}
        </Grid>
        <div className="mt-3 border-t border-line pt-3">
          <Grid cols={3}>
            <NumField
              label="週の接触目標"
              value={targets.weeklyApproach}
              onChange={(v) =>
                void mutate((s) => void (s.salesKpi.targets.weeklyApproach = v), ["meta:app"])
              }
              suffix="件"
            />
            <NumField
              label="週の商談目標"
              value={targets.weeklyMeeting}
              onChange={(v) =>
                void mutate((s) => void (s.salesKpi.targets.weeklyMeeting = v), ["meta:app"])
              }
              suffix="件"
            />
            <NumField
              label="月の提案目標"
              value={targets.monthlyProposal}
              onChange={(v) =>
                void mutate((s) => void (s.salesKpi.targets.monthlyProposal = v), ["meta:app"])
              }
              suffix="件"
            />
          </Grid>
        </div>
      </Panel>

      <Modal open={objOpen} onClose={() => setObjOpen(false)} title="断られたときの返し方" wide>
        <div className="space-y-4">
          {OBJECTION_HANDBOOK.map((o, i) => (
            <div key={i} className="rounded-sm border border-line bg-ink-850 p-3.5">
              <div className="mb-2 text-[14px] font-medium text-paper">{o.objection}</div>
              <div className="space-y-2 text-[13px] leading-relaxed">
                <p>
                  <span className="text-paper-faint">まず受け止める：</span>
                  {o.empathy}
                </p>
                <p>
                  <span className="text-paper-faint">見極める：</span>
                  {o.essence}
                </p>
                <p>
                  <span className="text-paper-faint">取れる手：</span>
                  {o.options}
                </p>
              </div>
              <div className="mt-2">
                <CopyButton
                  text={`${o.objection}\n\n${o.empathy}\n\n${o.essence}\n\n${o.options}`}
                  label="コピー"
                />
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
