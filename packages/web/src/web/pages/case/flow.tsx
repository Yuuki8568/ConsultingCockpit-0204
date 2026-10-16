/** ③業務フロー分析 — As-Is / To-Be / ギャップ / 施策一覧 */
import { useMemo } from "react";
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import {
  Area,
  Badge,
  Chips,
  CopyButton,
  Empty,
  Field,
  Grid,
  Note,
  NumField,
  Panel,
  Stat,
} from "../../components/kit";
import { Mask } from "../../components/mask";
import { buildFlowDefaults, calcFlowCoverage, runFlowAnalysis } from "../../domain/logic/flow";
import { FLOW_MATERIAL_HINT } from "../../domain/data/flow-pricing";
import type { FlowInputs } from "../../domain/types";

const DIRECTIONS: [string, string][] = [
  ["時間短縮", "時間短縮"],
  ["属人化解消", "属人化解消"],
  ["ミス削減", "ミス削減"],
  ["コスト削減", "コスト削減"],
  ["顧客満足度向上", "顧客満足度向上"],
  ["従業員負担軽減", "従業員負担軽減"],
  ["DX化推進", "DX化推進"],
];

const OPTIONS: [string, string][] = [
  ["AI", "AI（生成AI・OCR）"],
  ["RPA", "RPA（画面操作の自動化）"],
  ["クラウド", "クラウドサービス"],
  ["開発", "個別開発"],
];

const P_COLOR: Record<string, string> = { P1: "#B85C38", P2: "#C9A961", P3: "#6B665F" };

export function CaseFlow() {
  const { c, patch } = useCurrentCase();
  const { audit } = useVault();
  const coverage = useMemo(() => (c ? calcFlowCoverage(c) : null), [c]);

  if (!c || !coverage) return null;

  const fa = c.flowAnalysis;
  const inputs: FlowInputs = fa?.inputs ?? buildFlowDefaults(c);
  const result = fa?.result;

  const setInputs = (fn: (i: FlowInputs) => void) =>
    void patch((x) => {
      const cur: FlowInputs = x.flowAnalysis?.inputs ?? buildFlowDefaults(x);
      fn(cur);
      x.flowAnalysis = { ...x.flowAnalysis, inputs: cur };
    });

  function pullFromAnswers() {
    void patch((x) => {
      x.flowAnalysis = { ...x.flowAnalysis, inputs: buildFlowDefaults(x) };
    });
  }

  function analyze() {
    void patch((x) => {
      const cur: FlowInputs = x.flowAnalysis?.inputs ?? buildFlowDefaults(x);
      x.flowAnalysis = {
        inputs: cur,
        result: runFlowAnalysis(cur, x),
        analyzedAt: new Date().toISOString(),
      };
    });
    audit("flow_analyze");
  }

  const derivation = inputs._hearingDerivation as
    | {
        flowSources?: string[];
        painSources?: string[];
        icebreakUsed?: number[];
        taskSource?: string;
        constraintSource?: string[];
      }
    | undefined;

  return (
    <div className="space-y-4">
      {coverage.overall.pct < 50 && (
        <Note tone="warn">
          ②ヒアリングの回答がまだ {coverage.overall.pct}%
          しか埋まっていません。この状態で解析しても、工程がほとんど拾えません。
          特に {coverage.overall.missing.slice(0, 4).join("、")} を先に聞いておくと精度が上がります。
        </Note>
      )}

      <Panel
        title="解析の材料"
        note="②の回答から下書きできます。足りない部分は直接書き足してください。"
        right={
          <>
            <button className="btn btn-sm" onClick={pullFromAnswers}>
              ②の回答から下書き
            </button>
            <button className="btn btn-primary btn-sm" onClick={analyze}>
              解析する
            </button>
          </>
        }
      >
        <Grid cols={2}>
          <Field
            label="対象業務の名前"
            value={inputs.taskName}
            onChange={(v) => setInputs((i) => void (i.taskName = v))}
            placeholder="受発注改善"
          />
          <NumField
            label="関係する部署数"
            value={inputs.deptCount}
            onChange={(v) => setInputs((i) => void (i.deptCount = v))}
            min={1}
            max={20}
            suffix="部署"
          />
        </Grid>

        <div className="mt-4 space-y-3">
          <Area
            label="現状の業務の流れ"
            value={inputs.flowText}
            onChange={(v) => setInputs((i) => void (i.flowText = v))}
            rows={7}
            hint="1行に1工程。行頭の記号や番号は自動で外れます。「電話で受注」「紙をエクセルに転記」のように動作で書くと拾いやすくなります。"
          />
          <Area
            label="困っていること"
            value={inputs.painPoints}
            onChange={(v) => setInputs((i) => void (i.painPoints = v))}
            rows={5}
            hint="ここに書いた言葉が工程と照らし合わされ、ボトルネックの判定に使われます。"
          />
          <Chips
            label="目指す方向"
            values={DIRECTIONS}
            selected={inputs.direction}
            onToggle={(v) =>
              setInputs((i) => {
                i.direction = i.direction.includes(v)
                  ? i.direction.filter((x) => x !== v)
                  : [...i.direction, v];
              })
            }
          />
          <Chips
            label="使ってよい手段"
            values={OPTIONS}
            selected={inputs.options}
            onToggle={(v) =>
              setInputs((i) => {
                i.options = i.options.includes(v)
                  ? i.options.filter((x) => x !== v)
                  : [...i.options, v];
              })
            }
            hint="ここで外した手段は、改善案にも出てきません。"
          />
          <Grid cols={2}>
            <Area
              label="制約"
              value={inputs.constraints}
              onChange={(v) => setInputs((i) => void (i.constraints = v))}
              rows={2}
            />
            <Area
              label="既存システム"
              value={inputs.existingSystem}
              onChange={(v) => setInputs((i) => void (i.existingSystem = v))}
              rows={2}
            />
          </Grid>
        </div>

        {derivation && (
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-[12px] text-paper-dim">
              どの回答から下書きしたか
            </summary>
            <div className="mt-2 space-y-1 text-[12px] leading-relaxed text-paper-faint">
              {derivation.flowSources && derivation.flowSources.length > 0 && (
                <p>
                  業務の流れ：
                  {derivation.flowSources
                    .map((k) => (FLOW_MATERIAL_HINT as Record<string, string>)[k] ?? k)
                    .join("、")}
                </p>
              )}
              {derivation.painSources && derivation.painSources.length > 0 && (
                <p>
                  困っていること：
                  {derivation.painSources
                    .map((k) => (FLOW_MATERIAL_HINT as Record<string, string>)[k] ?? k)
                    .join("、")}
                </p>
              )}
              {derivation.icebreakUsed && derivation.icebreakUsed.length > 0 && (
                <p>雑談メモ {derivation.icebreakUsed.join("、")} 番も混ぜています</p>
              )}
              {derivation.constraintSource && derivation.constraintSource.length > 0 && (
                <p>制約：{derivation.constraintSource.join("、")}</p>
              )}
            </div>
          </details>
        )}
      </Panel>

      {!result ? (
        <Empty>まだ解析していません。材料を入れて「解析する」を押してください。</Empty>
      ) : (
        <>
          <Panel title="今と、変えた後の差" note="工数の数字は工程の内容から機械的に見積もったものです。">
            <Grid cols={4}>
              <Stat
                label="工程数"
                value={`${result.gap.asisCount} → ${result.gap.tobeCount}`}
                sub={`${result.gap.stepReduction}% 減`}
                color={result.gap.stepReduction > 0 ? "#4A7C59" : undefined}
              />
              <Stat
                label="所要時間（1件あたり）"
                value={`${result.gap.asisTime} → ${result.gap.tobeTime}分`}
                sub={`${result.gap.timeReduction}% 減`}
                color={result.gap.timeReduction > 0 ? "#4A7C59" : undefined}
              />
              <Stat
                label="手作業の割合"
                value={`${result.gap.asisManualRate}% → ${result.gap.tobeManualRate}%`}
                sub={
                  result.gap.manualDelta > 0
                    ? `${result.gap.manualDelta}ポイント減`
                    : result.gap.manualDelta < 0
                      ? `${-result.gap.manualDelta}ポイント増（人の判断を残す工程が多い）`
                      : "変化なし"
                }
                color={result.gap.manualDelta > 0 ? "#4A7C59" : undefined}
              />
              <Stat
                label="ミスの起きやすさ"
                value={`${result.gap.asisMistakeLevel} → ${result.gap.tobeMistakeLevel}`}
              />
            </Grid>
            <div className="mt-3">
              <Note tone="warn">
                この数字は工程の書き方から推定した概算です。実際の効果は現場の体制と続け方で変わります。
                提案時はレンジで示し、確約はしないでください。
              </Note>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="今の流れ（As-Is）" note="オレンジがボトルネックと推定した工程です。">
              <ol className="space-y-1.5">
                {result.asis.steps.map((s, i) => (
                  <li
                    key={s.id}
                    className="flex items-start gap-2 rounded-sm border px-2.5 py-2 text-[13px]"
                    style={{
                      borderColor: s.isBottleneck ? "rgba(184,92,56,0.45)" : "var(--color-line)",
                      background: s.isBottleneck ? "rgba(184,92,56,0.09)" : "var(--color-ink-850)",
                    }}
                  >
                    <span className="num shrink-0 text-[11px] text-paper-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <Mask>{s.raw}</Mask>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {s.actor && <Badge>{s.actor}</Badge>}
                        {s.manual && <Badge color="#B85C38">手作業</Badge>}
                        <span className="num text-[11px] text-paper-faint">約{s.time}分</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="変えた後の流れ（To-Be）" note="緑が自動化できる工程、黄色が人の判断を残す工程です。">
              <ol className="space-y-1.5">
                {result.tobe.steps.map((s, i) => (
                  <li
                    key={s.id}
                    className="flex items-start gap-2 rounded-sm border px-2.5 py-2 text-[13px]"
                    style={{
                      borderColor: s.auto ? "rgba(74,124,89,0.45)" : "rgba(201,169,97,0.4)",
                      background: s.auto ? "rgba(74,124,89,0.09)" : "rgba(201,169,97,0.07)",
                    }}
                  >
                    <span className="num shrink-0 text-[11px] text-paper-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      {s.label}
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge color={s.auto ? "#4A7C59" : "#C9A961"}>{s.type}</Badge>
                        {s.merged && <Badge color="#3B6E8F">まとめて処理</Badge>}
                        <span className="num text-[11px] text-paper-faint">約{s.time}分</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>

          <Panel title="今の問題点">
            <ul className="space-y-1.5 text-[13px] leading-relaxed">
              {result.problems.map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-paper-faint">・</span>
                  <Mask>{p}</Mask>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="打ち手の一覧"
            note="⭐ は①案件設定と②の回答から読み取った、経営が今力を入れているテーマに合うものです。"
            right={
              <CopyButton
                text={result.measures
                  .map(
                    (m) =>
                      `${m.no}. [${m.priority}] ${m.name}\n   効果:${m.effect} 手間:${m.effort} 道具:${m.tool} 費用:${m.cost}`,
                  )
                  .join("\n")}
                label="一覧をコピー"
              />
            }
          >
            {result.measures.length === 0 ? (
              <Empty>
                打ち手が出ませんでした。「使ってよい手段」を広げるか、業務の流れをもう少し具体的に書いてみてください。
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th className="w-14">優先</th>
                      <th>打ち手</th>
                      <th className="w-14">効果</th>
                      <th className="w-14">手間</th>
                      <th>道具の例</th>
                      <th>費用の目安</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.measures.map((m) => (
                      <tr key={m.no}>
                        <td className="num text-paper-faint">{m.no}</td>
                        <td>
                          <Badge color={P_COLOR[m.priority]}>{m.priority}</Badge>
                        </td>
                        <td>
                          <Mask>{m.name}</Mask>
                        </td>
                        <td>{m.effect}</td>
                        <td>{m.effort}</td>
                        <td className="text-[12px] text-paper-dim">{m.tool}</td>
                        <td className="text-[12px] text-paper-dim">{m.cost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3">
              <Note tone="info">
                道具の名前は例です。実際に選ぶときは、クライアントの既存システムと情報の扱い方を先に確認してください。
              </Note>
            </div>
          </Panel>

          <Panel title="図の元データ" note="Mermaid 記法です。図を作るツールに貼って使えます。">
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="field-label mb-0">As-Is</span>
                  <CopyButton text={result.mermaidAsIs} label="コピー" />
                </div>
                <pre className="doc max-h-52 overflow-auto text-[12px]">{result.mermaidAsIs}</pre>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="field-label mb-0">To-Be</span>
                  <CopyButton text={result.mermaidToBe} label="コピー" />
                </div>
                <pre className="doc max-h-52 overflow-auto text-[12px]">{result.mermaidToBe}</pre>
              </div>
            </div>
          </Panel>
        </>
      )}

      <Panel
        title="運用設計（人とAIの分担）"
        note="AIに任せる範囲と、人が判断・承認する範囲を分けて書きます。停止時の手動切替の手順まで決めておくと、事故時に止まり方を迷いません。"
      >
        <div className="space-y-3">
          <Area
            label="人／AIの分担"
            value={c.flowAnalysis?.opsDesign?.humanAiSplit ?? ""}
            onChange={(v) =>
              void patch((x) => {
                if (!x.flowAnalysis) x.flowAnalysis = {};
                if (!x.flowAnalysis.opsDesign)
                  x.flowAnalysis.opsDesign = {
                    humanAiSplit: "",
                    dataPath: "",
                    approvalPoints: "",
                    stopManual: "",
                  };
                x.flowAnalysis.opsDesign.humanAiSplit = v;
              })
            }
            rows={3}
            placeholder="AI：取込・照合・下書き作成／人：例外判断・対外送信の承認 など"
          />
          <Area
            label="データ経路"
            value={c.flowAnalysis?.opsDesign?.dataPath ?? ""}
            onChange={(v) =>
              void patch((x) => {
                if (!x.flowAnalysis) x.flowAnalysis = {};
                if (!x.flowAnalysis.opsDesign)
                  x.flowAnalysis.opsDesign = {
                    humanAiSplit: "",
                    dataPath: "",
                    approvalPoints: "",
                    stopManual: "",
                  };
                x.flowAnalysis.opsDesign.dataPath = v;
              })
            }
            rows={2}
            placeholder="どのデータがどこを通るか。外部AIに渡す情報は許可された範囲だけにする。"
          />
          <Grid cols={2}>
            <Area
              label="承認点"
              value={c.flowAnalysis?.opsDesign?.approvalPoints ?? ""}
              onChange={(v) =>
                void patch((x) => {
                  if (!x.flowAnalysis) x.flowAnalysis = {};
                  if (!x.flowAnalysis.opsDesign)
                    x.flowAnalysis.opsDesign = {
                      humanAiSplit: "",
                      dataPath: "",
                      approvalPoints: "",
                      stopManual: "",
                    };
                  x.flowAnalysis.opsDesign.approvalPoints = v;
                })
              }
              rows={2}
              placeholder="どの操作に誰の承認が必要か"
            />
            <Area
              label="停止・手動切替"
              value={c.flowAnalysis?.opsDesign?.stopManual ?? ""}
              onChange={(v) =>
                void patch((x) => {
                  if (!x.flowAnalysis) x.flowAnalysis = {};
                  if (!x.flowAnalysis.opsDesign)
                    x.flowAnalysis.opsDesign = {
                      humanAiSplit: "",
                      dataPath: "",
                      approvalPoints: "",
                      stopManual: "",
                    };
                  x.flowAnalysis.opsDesign.stopManual = v;
                })
              }
              rows={2}
              placeholder="本人不在・事故疑いのとき、顧客が自分で手動処理に切り替える手順"
            />
          </Grid>
        </div>
      </Panel>
    </div>
  );
}
