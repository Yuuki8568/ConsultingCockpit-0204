/** ②ヒアリング設計 — 質問シート生成・回答記録・成熟度診断・提案書骨子 */
import { useMemo, useState } from "react";
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import {
  Area,
  Badge,
  CopyButton,
  Empty,
  Grid,
  Modal,
  Note,
  Panel,
  Sec,
  Stat,
} from "../../components/kit";
import { CATEGORY_NAMES, INDUSTRY_NOTES } from "../../domain/data/question-bank";
import { GARTNER_DEFS, MATURITY_AXES } from "../../domain/data/diagnosis-legal";
import { PROPOSAL_SECTIONS } from "../../domain/data/templates-msg";
import { buildSheet, generateProposalSkeleton, identifyThemes } from "../../domain/logic/sheet";
import { calcFlowCoverage } from "../../domain/logic/flow";
import { autoInferMaturity, calcMaturityStage } from "../../domain/logic/maturity";
import { jpDate } from "../../domain/logic/util";
import type { SheetQuestion } from "../../domain/types";

const STAGE_COLOR: Record<string, string> = {
  Defend: "#3B6E8F",
  Extend: "#C9A961",
  Transform: "#4A7C59",
};

/** FDE受注条件（2026-09-20統合資料2章）。1つでも未確認なら受注可否は未判定 */
const FDE_FIT_ITEMS: [string, string][] = [
  ["monthlyWork", "毎月案件が動き、照合・未処理・例外の判断が繰り返し発生する"],
  ["ownerAndProxy", "顧客の責任者と代行者がおり、原資料と最終業務判断を担える"],
  ["clientCanStop", "顧客が事務所の操作を待たずに停止・手動処理・資料取得を行える"],
  ["manualFallback", "代表的な繁忙量でも、手動代替が実際の期限内に終わる"],
  ["leaveData", "データ、設定、手順、試験結果、必要な利用権を顧客側に残せる"],
  ["comparable", "内製・他社等との費用・品質・負担の比較ができる"],
  ["draftValue", "下書き・月次点検で価値があり、即応や無人での重要操作を必要としない"],
];

export function CaseSheet() {
  const { c, patch } = useCurrentCase();
  const { state, audit } = useVault();
  const [openProposal, setOpenProposal] = useState(false);
  const [openAnswers, setOpenAnswers] = useState<Record<string, boolean>>({});

  // フックは早期 return より前に置く（描画のたびに同じ数を呼ぶ必要があるため）
  const coverage = useMemo(() => (c ? calcFlowCoverage(c) : null), [c]);
  const themes = useMemo(() => (c ? identifyThemes(c) : []), [c]);

  if (!c || !state || !coverage) return null;

  const industryNote = (
    INDUSTRY_NOTES as Record<string, { name: string; ng: string[]; icebreaker: string[] }>
  )[c.settings.industry];

  function generate() {
    void patch((x) => {
      x.sheet = buildSheet(x.settings);
    });
    audit("sheet_generate");
  }

  const sheet = c.sheet;

  return (
    <div className="space-y-4">
      <Panel
        title="質問シート"
        note={
          sheet
            ? `${jpDate(sheet.generatedAt)}に生成 / ${sheet.totalQuestions}問（面談${sheet.duration}分）`
            : "面談相手の層と時間から、聞く順に並べた質問を選び出します。"
        }
        right={
          <button className="btn btn-primary btn-sm" onClick={generate}>
            {sheet ? "作り直す" : "シートを作る"}
          </button>
        }
      >
        {!sheet ? (
          <Empty>
            ①案件設定で「面談相手の層」と「面談時間」を決めてから、シートを作ります。
            <br />
            経営層・管理職・現場で聞くべきことの重みが変わります。
          </Empty>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {Object.entries(sheet.counts ?? {}).map(([cat, n]) => (
                <Badge key={cat}>
                  {cat} {CATEGORY_NAMES[cat as keyof typeof CATEGORY_NAMES]} {n}問
                </Badge>
              ))}
            </div>

            {industryNote && (
              <div className="mb-4 space-y-2">
                <Note tone="alert">
                  <span className="font-medium">{industryNote.name}で言わない方がよい表現</span>
                  <ul className="mt-1.5 space-y-0.5">
                    {industryNote.ng.map((n, i) => (
                      <li key={i}>・{n}</li>
                    ))}
                  </ul>
                </Note>
              </div>
            )}

            <Sec>今回の面談で持ち帰るもの</Sec>
            <ul className="mb-4 space-y-1 text-[13px] text-paper">
              {themes.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="num text-paper-faint">{i + 1}.</span>
                  {t}
                </li>
              ))}
            </ul>

            <div className="space-y-5">
              {Object.entries(sheet.questions ?? {}).map(([cat, qs]) =>
                qs.length === 0 ? null : (
                  <div key={cat}>
                    <Sec>
                      {cat}. {CATEGORY_NAMES[cat as keyof typeof CATEGORY_NAMES]}
                    </Sec>
                    <div className="space-y-2.5">
                      {qs.map((q) => (
                        <QuestionRow
                          key={q.id}
                          q={q}
                          answer={c.answers[q.id] ?? ""}
                          expanded={!!openAnswers[q.id]}
                          onToggle={() =>
                            setOpenAnswers((o) => ({ ...o, [q.id]: !o[q.id] }))
                          }
                          onAnswer={(v) => void patch((x) => void (x.answers[q.id] = v))}
                          onEdit={(text) =>
                            void patch((x) => {
                              const arr = x.sheet?.questions[cat];
                              const t = arr?.find((z) => z.id === q.id);
                              if (t) {
                                t.text = text;
                                t.q = text;
                                t.edited = true;
                              }
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              <CopyButton text={sheetAsText(sheet, c.settings.companyName)} label="シートをコピー" />
              <CopyButton
                text={answersAsText(sheet, c.answers, c.settings.companyName)}
                label="回答つきでコピー"
              />
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="FDE受注条件の確認"
        note="受注前に確認する7項目（2026-09-20統合資料2章）。1つでも「確認できない」が残る案件は、受注可否を未判定のままにします。"
      >
        <div className="space-y-1">
          {FDE_FIT_ITEMS.map(([key, label]) => (
            <div
              key={key}
              className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-ink-850 px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-paper">{label}</span>
              <div className="flex shrink-0 gap-1">
                {(["ok", "ng", "unknown"] as const).map((v) => {
                  const cur = c.fdeFit?.[key] ?? "";
                  const on = cur === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        void patch((x) => {
                          if (!x.fdeFit) x.fdeFit = {};
                          x.fdeFit[key] = on ? "" : v;
                        })
                      }
                      className={`rounded-sm border px-2 py-0.5 text-[11px] transition-colors ${
                        on
                          ? v === "ok"
                            ? "border-[#4A7C59]/60 bg-[#4A7C59]/15 text-[#4A7C59]"
                            : v === "ng"
                              ? "border-[#B85C38]/60 bg-[#B85C38]/15 text-[#B85C38]"
                              : "border-[#C9A961]/60 bg-[#C9A961]/15 text-[#C9A961]"
                          : "border-line bg-ink-900 text-paper-faint hover:text-paper"
                      }`}
                    >
                      {v === "ok" ? "確認済み" : v === "ng" ? "不適合" : "確認できない"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-3">
          <Area
            label="適合・不適合の理由"
            value={c.fdeFitReason ?? ""}
            onChange={(v) => void patch((x) => void (x.fdeFitReason = v))}
            rows={2}
            placeholder="不適合が判明した場合は、停止・是正・再計画・精算を整理してから進めます。"
          />
          <Grid cols={2}>
            <Area
              label="顧客の現行管理費・承認負担"
              value={c.fdeFitCost ?? ""}
              onChange={(v) => void patch((x) => void (x.fdeFitCost = v))}
              rows={2}
              hint="内製・他社等との費用・品質・負担の比較に使います（A/F比較のA側の材料）。"
            />
            <Area
              label="手動代替の可否"
              value={c.fdeFitManual ?? ""}
              onChange={(v) => void patch((x) => void (x.fdeFitManual = v))}
              rows={2}
              hint="代表的な繁忙量でも、手動代替が実際の期限内に終わるか。"
            />
          </Grid>
        </div>
      </Panel>

      <Panel
        title="③業務フロー分析に必要な回答の充足率"
        note="ここが埋まっていないと、フロー分析の精度が落ちます。"
      >
        <Grid cols={4}>
          {Object.entries(coverage)
            .filter(([k]) => k !== "overall")
            .map(([k, v]) => {
              const d = v as { label: string; filled: number; total: number; pct: number };
              return (
                <Stat
                  key={k}
                  label={d.label}
                  value={`${d.pct}%`}
                  sub={`${d.filled} / ${d.total} 問`}
                  color={d.pct >= 70 ? "#4A7C59" : d.pct >= 40 ? "#C9A961" : "#B85C38"}
                />
              );
            })}
        </Grid>
        {coverage.overall.missing.length > 0 && (
          <div className="mt-3">
            <Note tone="warn">
              まだ聞けていない項目：{coverage.overall.missing.slice(0, 10).join("、")}
              {coverage.overall.missing.length > 10 && ` ほか${coverage.overall.missing.length - 10}件`}
            </Note>
          </div>
        )}
      </Panel>

      <Panel
        title="アイスブレイクで拾ったこと"
        note="雑談で出た話も、③フロー分析の材料に混ぜられます（混ぜるかは1件ずつ選べます）。"
      >
        {industryNote && industryNote.icebreaker.length > 0 && (
          <div className="mb-4">
            <Sec>{industryNote.name}での切り出し方</Sec>
            <div className="space-y-1.5">
              {industryNote.icebreaker.map((q, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-sm border border-line bg-ink-850 px-2.5 py-2 text-[13px] leading-relaxed"
                >
                  <span className="min-w-0 flex-1">{q}</span>
                  <CopyButton text={q} label="コピー" />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-3">
          {[0, 1, 2].map((i) => {
            const cur = c.icebreakAnswers[String(i)] ?? { text: "", useInFlow: false };
            return (
              <div key={i} className="rounded-sm border border-line bg-ink-850 p-3">
                <Area
                  label={`雑談メモ ${i + 1}`}
                  value={cur.text}
                  rows={2}
                  onChange={(v) =>
                    void patch((x) => {
                      x.icebreakAnswers[String(i)] = { ...cur, text: v };
                    })
                  }
                />
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-paper-dim">
                  <input
                    type="checkbox"
                    className="accent-[#0e7490]"
                    checked={cur.useInFlow}
                    onChange={(e) =>
                      void patch((x) => {
                        x.icebreakAnswers[String(i)] = {
                          ...cur,
                          useInFlow: e.target.checked,
                        };
                      })
                    }
                  />
                  ③フロー分析の痛みの材料に含める（5文字を超えている場合のみ反映）
                </label>
              </div>
            );
          })}
        </div>
      </Panel>

      <MaturityPanel />

      <Panel
        title="提案書の骨子"
        note="ヒアリング回答・成熟度・単価から8セクションの下書きを組み立てます。"
        right={
          <button
            className="btn btn-sm"
            onClick={() => {
              void patch((x) => {
                x.proposalDraft = {
                  sections: generateProposalSkeleton(x, state),
                  lastEdited: new Date().toISOString(),
                };
              });
              setOpenProposal(true);
            }}
          >
            骨子を作る
          </button>
        }
      >
        {Object.keys(c.proposalDraft.sections).length === 0 ? (
          <Empty>まだ作っていません。②の回答と④単価を埋めてから作ると中身が濃くなります。</Empty>
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] text-paper-faint">
              最終更新 {jpDate(c.proposalDraft.lastEdited)}
            </p>
            <button className="btn btn-sm" onClick={() => setOpenProposal(true)}>
              骨子を開いて手直しする
            </button>
          </div>
        )}
      </Panel>

      <Modal
        open={openProposal}
        onClose={() => setOpenProposal(false)}
        title="提案書の骨子"
        wide
        footer={
          <CopyButton
            className="btn btn-primary btn-sm"
            text={PROPOSAL_SECTIONS.map(
              ([key, label]) => `■ ${label}\n${c.proposalDraft.sections[key] ?? ""}`,
            ).join("\n\n")}
            label="全文をコピー"
          />
        }
      >
        <div className="space-y-4">
          <Note tone="warn">
            ここは下書きです。数字と固有名詞は必ず自分で確認してから出してください。
            ROIは保証しない前提の書き方にしてあります。
          </Note>
          {PROPOSAL_SECTIONS.map(([key, label]) => (
            <Area
              key={key}
              label={label}
              rows={5}
              value={c.proposalDraft.sections[key] ?? ""}
              onChange={(v) =>
                void patch((x) => {
                  x.proposalDraft.sections[key] = v;
                  x.proposalDraft.lastEdited = new Date().toISOString();
                })
              }
            />
          ))}
        </div>
      </Modal>
    </div>
  );
}

function QuestionRow({
  q,
  answer,
  expanded,
  onToggle,
  onAnswer,
  onEdit,
}: {
  q: SheetQuestion;
  answer: string;
  expanded: boolean;
  onToggle: () => void;
  onAnswer: (v: string) => void;
  onEdit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const filled = answer.trim().length > 5;
  return (
    <div className="rounded-sm border border-line bg-ink-850">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <span
          className="num mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 text-[11px]"
          style={{
            color: filled ? "#4A7C59" : "#6B665F",
            background: filled ? "rgba(74,124,89,0.14)" : "rgba(255,255,255,0.03)",
          }}
        >
          {q.id}
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              className="field"
              rows={2}
              ref={(el) => el?.focus()}
              defaultValue={String(q.text ?? "")}
              onBlur={(e) => {
                onEdit(e.target.value);
                setEditing(false);
              }}
            />
          ) : (
            <button
              className="w-full cursor-text text-left text-[13px] leading-relaxed text-paper"
              onDoubleClick={() => setEditing(true)}
              onClick={onToggle}
              title="クリックで詳細、ダブルクリックで質問文を編集"
            >
              {String(q.text ?? "")}
              {q.edited && <span className="ml-1.5 text-[10px] text-warn">編集済み</span>}
            </button>
          )}
        </div>
        <button className="btn btn-ghost btn-sm shrink-0" onClick={onToggle}>
          {expanded ? "閉じる" : "開く"}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          {q.intent ? (
            <p className="text-[12px] leading-relaxed text-paper-dim">
              <span className="text-paper-faint">この質問の狙い：</span>
              {String(q.intent)}
            </p>
          ) : null}
          {q.askingTips ? (
            <p className="text-[12px] leading-relaxed text-paper-dim">
              <span className="text-paper-faint">答えに詰まったときは：</span>
              {String(q.askingTips)}
            </p>
          ) : null}
          {q.followup ? (
            <p className="text-[12px] leading-relaxed text-paper-dim">
              <span className="text-paper-faint">追いかけの一言：</span>
              {String(q.followup)}
            </p>
          ) : null}
          {q.patterns ? (
            <p className="text-[12px] leading-relaxed text-paper-faint">
              よくある答え：{String(q.patterns)}
            </p>
          ) : null}
          <Area label="回答" value={answer} rows={3} onChange={onAnswer} />
        </div>
      )}

      {!expanded && filled && (
        <div className="border-t border-line px-3 py-2 text-[12px] leading-relaxed text-paper-dim">
          {answer.length > 120 ? answer.slice(0, 120) + "…" : answer}
        </div>
      )}
    </div>
  );
}

function MaturityPanel() {
  const { c, patch } = useCurrentCase();
  const { audit } = useVault();
  if (!c) return null;
  const scores = c.maturity.scores;
  const filled = Object.keys(scores).length;
  const res = calcMaturityStage(scores);
  const def = res.stage ? GARTNER_DEFS[res.stage as keyof typeof GARTNER_DEFS] : null;

  return (
    <Panel
      title="AI成熟度の診断"
      note="6つの軸で今の状態を置き、ガートナーの3段階に当てます。"
      right={
        <>
          <button
            className="btn btn-sm"
            onClick={() =>
              void patch((x) => {
                x.maturity.scores = autoInferMaturity(x);
                x.maturity.autoInferred = true;
              })
            }
            title="②の回答テキストから粗い初期値を置きます。必ず目で確認してください。"
          >
            回答から下書き
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={filled === 0}
            onClick={() => {
              void patch((x) => {
                const r = calcMaturityStage(x.maturity.scores);
                x.maturity.currentStage = r.stage;
                x.maturity.history.push({
                  at: new Date().toISOString(),
                  scores: { ...x.maturity.scores },
                  stage: r.stage,
                  avg: r.avg,
                });
                if (!x.gartner.stage) x.gartner.stage = r.stage;
              });
              audit("maturity_diagnose");
            }}
          >
            この内容で記録する
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {MATURITY_AXES.map((ax) => (
          <div key={ax.id}>
            <span className="field-label">{ax.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {ax.opts.map(([v, l]) => {
                const on = scores[ax.id] === v;
                return (
                  <button
                    key={v}
                    onClick={() =>
                      void patch((x) => {
                        x.maturity.scores[ax.id] = v;
                        x.maturity.autoInferred = false;
                      })
                    }
                    className={`rounded-sm border px-2.5 py-1 text-[12px] transition-colors ${
                      on
                        ? "border-brand/60 bg-brand-soft text-paper"
                        : "border-line bg-ink-850 text-paper-dim hover:text-paper"
                    }`}
                  >
                    <span className="num mr-1 text-[10px] text-paper-faint">{v}</span>
                    {l}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {c.maturity.autoInferred && (
        <div className="mt-3">
          <Note tone="warn">
            回答テキストからの下書きです。キーワードで機械的に置いただけなので、
            実際の手応えと合っているか目で確かめてから記録してください。
          </Note>
        </div>
      )}

      {filled > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <Grid cols={3}>
            <Stat
              label="判定"
              value={res.stage || "—"}
              sub={`平均 ${res.avg.toFixed(2)} / 3.00`}
              color={STAGE_COLOR[res.stage] ?? undefined}
            />
            <Stat label="回答済みの軸" value={`${filled} / ${MATURITY_AXES.length}`} />
            <Stat label="記録回数" value={c.maturity.history.length} />
          </Grid>
          {def && (
            <div className="mt-3 space-y-1.5 text-[13px] leading-relaxed">
              <p>
                <span className="text-paper-dim">状態：</span>
                {def.state}
              </p>
              <p>
                <span className="text-paper-dim">やること：</span>
                {def.action}
              </p>
              <p>
                <span className="text-paper-dim">単価の目安：</span>
                {def.price}
              </p>
              <p>
                <span className="text-paper-dim">次の一手：</span>
                {def.nextMove}
              </p>
            </div>
          )}
          {c.maturity.history.length >= 2 && (
            <div className="mt-4">
              <Sec>推移</Sec>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>記録日</th>
                    <th>判定</th>
                    <th className="n">平均</th>
                  </tr>
                </thead>
                <tbody>
                  {c.maturity.history
                    .slice()
                    .reverse()
                    .map((h, i) => (
                      <tr key={i}>
                        <td className="num">{jpDate(h.at)}</td>
                        <td>
                          <Badge color={STAGE_COLOR[h.stage]}>{h.stage}</Badge>
                        </td>
                        <td className="n">{h.avg.toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function sheetAsText(sheet: NonNullable<import("../../domain/types").Sheet>, company: string) {
  const lines: string[] = [`${company || "【企業名】"} 様 ヒアリングシート（${sheet.duration}分）`, ""];
  Object.entries(sheet.questions).forEach(([cat, qs]) => {
    if (qs.length === 0) return;
    lines.push(`【${cat}. ${CATEGORY_NAMES[cat as keyof typeof CATEGORY_NAMES]}】`);
    qs.forEach((q) => {
      lines.push(`${q.id}. ${String(q.text ?? "")}`);
      if (q.followup) lines.push(`    └ 追い: ${String(q.followup)}`);
    });
    lines.push("");
  });
  return lines.join("\n");
}

function answersAsText(
  sheet: NonNullable<import("../../domain/types").Sheet>,
  answers: Record<string, string>,
  company: string,
) {
  const lines: string[] = [`${company || "【企業名】"} 様 ヒアリング記録`, ""];
  Object.entries(sheet.questions).forEach(([cat, qs]) => {
    if (qs.length === 0) return;
    lines.push(`【${cat}. ${CATEGORY_NAMES[cat as keyof typeof CATEGORY_NAMES]}】`);
    qs.forEach((q) => {
      lines.push(`Q ${q.id}. ${String(q.text ?? "")}`);
      lines.push(`A ${answers[q.id] || "（未記入）"}`);
      lines.push("");
    });
  });
  return lines.join("\n");
}
