/** リード② 一覧 — 絞り込み・状態変更・案件化・CSV書き出し */
import { useMemo, useState } from "react";
import { useVault } from "../../hooks/use-vault";
import {
  Badge,
  ConfirmButton,
  Empty,
  Panel,
  Select,
  Stat,
  Grid,
} from "../../components/kit";
import { Mask } from "../../components/mask";
import {
  LEAD_STATUS_LABEL,
  LEAD_SOURCES,
  LOST_REASON_TAGS,
  SALES_STAGES,
} from "../../domain/data/sales";
import { calcQualScore, qualHealthLabel } from "../../domain/logic/sales";
import { formatYen } from "../../domain/logic/pricing";
import { makeEmptyCase } from "../../domain/logic/state";
import { downloadCsv } from "../../lib/export/xlsx";
import type { LeadStatus } from "../../domain/types";

const STAGE_LABEL = Object.fromEntries(SALES_STAGES.map(([k, l]) => [k, l]));

export function LeadList() {
  const { state, mutate, audit } = useVault();
  const [f, setF] = useState({ status: "", stage: "", source: "" });

  const leads = useMemo(
    () =>
      (state?.leads ?? []).filter(
        (l) =>
          (!f.status || l.status === f.status) &&
          (!f.stage || (l.salesStage || "approach") === f.stage) &&
          (!f.source || l.source === f.source),
      ),
    [state?.leads, f],
  );

  if (!state) return null;

  const totalValue = leads.reduce((a, l) => a + (Number(l.dealValue) || 0), 0);

  function convert(leadId: string) {
    void mutate((s) => {
      const lead = s.leads.find((z) => z.id === leadId);
      if (!lead || lead.convertedCaseId) return;
      const c = makeEmptyCase(lead.company);
      // リードで分かっていることを案件へ引き継ぐ
      c.settings.contactName = lead.name;
      c.settings.knownInfo = [lead.contact, lead.hypothesis].filter(Boolean).join("\n");
      c.settings.kakuyaku.contact = lead.name;
      c.settings.kakuyaku.contactDept = lead.dept;
      c.settings.kakuyaku.contactTitle = lead.role;
      c.settings.kakuyaku.contactEmail = lead.email;
      c.settings.kakuyaku.industryLabel = lead.industry;
      if (lead.hypothesis) c.settings.keywords = lead.hypothesis.slice(0, 60);
      if (lead.prepSheet) {
        c.memo.summary = [
          lead.prepSheet.companyResearch && `【下調べ】${lead.prepSheet.companyResearch}`,
          lead.prepSheet.assumedIssues && `【課題の見立て】${lead.prepSheet.assumedIssues}`,
          lead.prepSheet.keyPerson && `【鍵になる人】${lead.prepSheet.keyPerson}`,
        ]
          .filter(Boolean)
          .join("\n");
        c.memo.budget = lead.prepSheet.budget ?? "";
        c.memo.decisionMaker = lead.prepSheet.keyPerson ?? "";
      }
      if (lead.dealValue > 0) c.estimate.totalIncTax = lead.dealValue;
      c.leadId = lead.id;
      s.cases.unshift(c);
      lead.convertedCaseId = c.id;
      lead.status = "converted";
      lead.salesStage = "won";
      lead.funnelStatus = "engaged";
      s.currentCaseId = c.id;
      s.currentMode = "cases";
      s.currentTab = "setup";
    });
    audit("lead_convert", { leadId });
  }

  function exportCsv() {
    downloadCsv(
      `リード一覧_${new Date().toISOString().slice(0, 10)}`,
      [
        "企業名",
        "担当者",
        "部署",
        "役職",
        "メール",
        "業種",
        "流入",
        "状態",
        "営業ステージ",
        "想定金額",
        "評価%",
        "作成日",
        "送信日",
        "返信日",
        "案件化",
      ],
      leads.map((l) => [
        l.company,
        l.name,
        l.dept,
        l.role,
        l.email,
        l.industry,
        l.source ?? "",
        LEAD_STATUS_LABEL[l.status as keyof typeof LEAD_STATUS_LABEL] ?? l.status,
        STAGE_LABEL[l.salesStage] ?? l.salesStage,
        l.dealValue,
        calcQualScore(l).pct,
        l.createdAt,
        l.sentAt ?? "",
        l.repliedAt ?? "",
        l.convertedCaseId ? "済" : "",
      ]),
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        title="絞り込み"
        right={
          <button className="btn btn-sm" onClick={exportCsv} disabled={leads.length === 0}>
            CSV で書き出す
          </button>
        }
      >
        <Grid cols={3}>
          <Select
            label="状態"
            value={f.status}
            onChange={(v) => setF((x) => ({ ...x, status: v }))}
            options={[
              ["", "すべて"],
              ...Object.entries(LEAD_STATUS_LABEL).map(([k, v]) => [k, v] as [string, string]),
              ["lost", "失注"],
            ]}
          />
          <Select
            label="営業ステージ"
            value={f.stage}
            onChange={(v) => setF((x) => ({ ...x, stage: v }))}
            options={[["", "すべて"], ...SALES_STAGES.map(([k, l]) => [k, l] as [string, string])]}
          />
          <Select
            label="流入元"
            value={f.source}
            onChange={(v) => setF((x) => ({ ...x, source: v }))}
            options={[["", "すべて"], ...LEAD_SOURCES.map((s) => [s, s] as [string, string])]}
          />
        </Grid>
        <div className="mt-3">
          <Grid cols={3}>
            <Stat label="表示件数" value={leads.length} sub={`全 ${state.leads.length} 件`} />
            <Stat label="想定金額の合計" value={<Mask>¥{formatYen(totalValue)}</Mask>} />
            <Stat
              label="案件化"
              value={state.leads.filter((l) => l.convertedCaseId).length}
              color="#4A7C59"
            />
          </Grid>
        </div>
      </Panel>

      <Panel title="リード一覧">
        {leads.length === 0 ? (
          <Empty>
            {state.leads.length === 0
              ? "まだリードがありません。「① 追加・文面」から登録します。"
              : "この条件に合うリードはありません。"}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[1000px]">
              <thead>
                <tr>
                  <th>企業・担当</th>
                  <th className="w-28">状態</th>
                  <th className="w-36">営業ステージ</th>
                  <th className="w-28">評価</th>
                  <th className="w-32">想定金額</th>
                  <th className="w-24">流入</th>
                  <th className="w-44" />
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => {
                  const q = calcQualScore(l);
                  const h = qualHealthLabel(q.pct);
                  // 同名企業の重複候補。自動統合はしない（人が確認して削る）
                  const dupCount = l.company
                    ? state.leads.filter((x) => x.company === l.company).length
                    : 0;
                  return (
                    <tr key={l.id}>
                      <td>
                        <button
                          className="text-left"
                          onClick={() =>
                            void mutate((s) => {
                              s.currentLeadId = l.id;
                            })
                          }
                        >
                          <div className="text-[13px] text-paper hover:text-brand-hi">
                            <Mask>{l.company || "無題"}</Mask>
                          </div>
                          <div className="text-[11px] text-paper-faint">
                            <Mask>
                              {[l.name, l.dept, l.role].filter(Boolean).join(" / ") || "—"}
                            </Mask>
                          </div>
                        </button>
                        {(l.contactStop?.stopped ||
                          dupCount > 1 ||
                          l.channel ||
                          l.leadKind === "hpInquiry") && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {l.contactStop?.stopped && <Badge color="#B85C38">連絡停止</Badge>}
                            {dupCount > 1 && (
                              <Badge color="#C9A961">同名企業 {dupCount} 件</Badge>
                            )}
                            {l.channel === "email" && <Badge color="#3B6E8F">メール送信</Badge>}
                            {l.channel === "form" && <Badge color="#3B6E8F">フォーム送信</Badge>}
                            {l.leadKind === "hpInquiry" && <Badge color="#4A7C59">HP相談</Badge>}
                          </div>
                        )}
                      </td>
                      <td>
                        <select
                          className="field py-1 text-[12px]"
                          value={l.status}
                          onChange={(e) =>
                            void mutate(
                              (s) => {
                                const t = s.leads.find((z) => z.id === l.id);
                                if (t) t.status = e.target.value as LeadStatus;
                              },
                              [`lead:${l.id}`],
                            )
                          }
                        >
                          {Object.entries(LEAD_STATUS_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                          <option value="lost">失注</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="field py-1 text-[12px]"
                          value={l.salesStage}
                          onChange={(e) =>
                            void mutate(
                              (s) => {
                                const t = s.leads.find((z) => z.id === l.id);
                                if (t) {
                                  t.salesStage = e.target.value as typeof t.salesStage;
                                  t.stageEnteredAt = new Date().toISOString();
                                }
                              },
                              [`lead:${l.id}`],
                            )
                          }
                        >
                          {SALES_STAGES.map(([k, lab]) => (
                            <option key={k} value={k}>
                              {lab}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Badge color={h.color}>{q.pct}%</Badge>
                      </td>
                      <td className="n">
                        <input
                          type="number"
                          className="field num py-1 text-right"
                          value={l.dealValue}
                          step={100000}
                          onChange={(e) =>
                            void mutate(
                              (s) => {
                                const t = s.leads.find((z) => z.id === l.id);
                                if (t) t.dealValue = Number(e.target.value) || 0;
                              },
                              [`lead:${l.id}`],
                            )
                          }
                        />
                      </td>
                      <td className="text-[12px] text-paper-dim">{l.source || "—"}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {l.convertedCaseId ? (
                            <button
                              className="btn btn-sm"
                              onClick={() =>
                                void mutate((s) => {
                                  s.currentCaseId = l.convertedCaseId!;
                                  s.currentMode = "cases";
                                })
                              }
                            >
                              案件を開く
                            </button>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => convert(l.id)}
                            >
                              案件にする
                            </button>
                          )}
                          <ConfirmButton
                            label="削除"
                            onConfirm={() =>
                              void mutate((s) => {
                                const i = s.leads.findIndex((z) => z.id === l.id);
                                if (i >= 0) s.leads.splice(i, 1);
                                if (s.currentLeadId === l.id)
                                  s.currentLeadId = s.leads[0]?.id ?? null;
                              })
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <LostReasonPanel />
    </div>
  );
}

function LostReasonPanel() {
  const { state, mutate } = useVault();
  if (!state) return null;
  const lost = state.leads.filter((l) => l.status === "lost");
  if (lost.length === 0) return null;

  return (
    <Panel
      title="失注の理由"
      note="なぜ決まらなかったかを残しておくと、③ダッシュボードで傾向が見えます。"
    >
      <div className="space-y-2">
        {lost.map((l) => (
          <div
            key={l.id}
            className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-ink-850 px-2.5 py-2"
          >
            <span className="min-w-[140px] text-[13px]">
              <Mask>{l.company}</Mask>
            </span>
            <div className="flex flex-wrap gap-1">
              {LOST_REASON_TAGS.map((tag) => {
                const on = l.lostReason?.tag === tag;
                return (
                  <button
                    key={tag}
                    className={`rounded-sm border px-2 py-0.5 text-[11px] ${
                      on
                        ? "border-alert/60 bg-alert/15 text-alert"
                        : "border-line text-paper-dim hover:text-paper"
                    }`}
                    onClick={() =>
                      void mutate(
                        (s) => {
                          const t = s.leads.find((z) => z.id === l.id);
                          if (t)
                            t.lostReason = on
                              ? null
                              : { tag, note: t.lostReason?.note ?? "", at: new Date().toISOString() };
                        },
                        [`lead:${l.id}`],
                      )
                    }
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <input
              className="field min-w-[180px] flex-1 py-1 text-[12px]"
              placeholder="補足"
              value={l.lostReason?.note ?? ""}
              onChange={(e) =>
                void mutate(
                  (s) => {
                    const t = s.leads.find((z) => z.id === l.id);
                    if (t)
                      t.lostReason = {
                        tag: t.lostReason?.tag ?? "その他",
                        note: e.target.value,
                        at: t.lostReason?.at ?? new Date().toISOString(),
                      };
                  },
                  [`lead:${l.id}`],
                )
              }
            />
          </div>
        ))}
      </div>
    </Panel>
  );
}
