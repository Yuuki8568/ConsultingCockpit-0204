/** ④単価設計 — 積算・3レンジ・アラート・トークスクリプト・成熟度連動レンジ・支援メニュー推奨 */
import { contractTodayJst, verifiedCalendarDate } from "../../domain/logic/contract-actions";
import { useState } from "react";
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import {
  Badge,
  Chips,
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
import {
  CLIENT_SIZE_LABEL,
  DECISION_LABEL,
  DELIVERABLE_LABELS,
  DIFFICULTY_LABELS,
  DURATION_LABEL,
  EXPERIENCE_LABEL,
  PAYMENT_LABEL,
  SCOPE_RISK_LABEL,
  URGENCY_LABEL,
} from "../../domain/data/flow-pricing";
import { PRICING_PRESETS, STAGE_PRICE_RANGE } from "../../domain/data/diagnosis-legal";
import {
  SERVICE_MENU_ITEMS,
  buildMenuProposalText,
  menuToPricingPatch,
  scoreMenus,
  type ServiceMenuItem,
} from "../../domain/data/service-menu";
import {
  buildAlerts,
  buildPricingDefaults,
  calculatePricing,
  formatYen,
  legacyNetToGross,
  grossToLegacyNet,
  generateTalk,
} from "../../domain/logic/pricing";
import { applySanpoAutofill } from "../../domain/logic/sanpo";
import type { PricingInputs } from "../../domain/types";

const toOpts = (o: Record<string, string>): [string, string][] => Object.entries(o);

export function CasePricing() {
  const { c, patch } = useCurrentCase();
  const { audit } = useVault();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  if (!c) return null;

  const inputs: PricingInputs = c.pricing?.inputs ?? buildPricingDefaults(c);
  const result = c.pricing?.result;
  const stage = c.maturity.currentStage || c.gartner.stage || "";
  const stageDef = stage ? (STAGE_PRICE_RANGE as Record<string, any>)[stage] : null;

  // クライアント条件からのメニュー推奨
  const menuCtx = {
    industry: c.settings.industry || "general",
    size: c.settings.size || "small",
    stage,
    aiLeader: c.gartner.aiLeaderExists || "",
    keywords: c.settings.keywords || "",
    knownInfo: c.settings.knownInfo || "",
    hypothesis: (c.memo && (c.memo.hypothesis as string)) || "",
    companyName: c.settings.companyName || "",
  };
  const ranked = scoreMenus(menuCtx);
  const top3 = ranked.slice(0, 3);
  const [pickedMenuId, setPickedMenuId] = useState<string | null>(null);
  const pickedId = pickedMenuId ?? c.pricing?.menuPick?.menuId ?? null;
  const pickedItem = pickedId
    ? (SERVICE_MENU_ITEMS.find((m) => m.id === pickedId) ?? null)
    : null;
  const proposalText = buildMenuProposalText(menuCtx, pickedItem ?? undefined);

  function applyMenu(item: ServiceMenuItem) {
    const p = menuToPricingPatch(item);
    void patch((x) => {
      const cur: PricingInputs = x.pricing?.inputs ?? buildPricingDefaults(x);
      const company = x.settings.companyName || "無題";
      const next: PricingInputs = {
        ...cur,
        projectTitle: `${company}向け ${p.projectTitleSuffix}`,
        hours: p.hours,
        duration: p.duration,
        deliverables: p.deliverables,
      };
      const preset = item.pricingPreset
        ? (PRICING_PRESETS as Record<string, any>)[item.pricingPreset]
        : null;
      if (preset) {
        next.baseline = preset.baseline;
        next.difficulty = preset.difficulty;
        next.urgency = preset.urgency;
        next.scopeRisk = preset.scopeRisk;
        next.payment = preset.payment;
        next.decisionMakers = preset.decisionMakers;
        next.experience = preset.experience;
      }
      x.pricing = {
        inputs: next,
        result: calculatePricing(next),
        calculatedAt: new Date().toISOString(),
        menuPick: { menuId: item.id, pickedAt: new Date().toISOString() },
      };
      if (x.execution) {
        x.execution.contractType = item.contractType;
      }
      x.plan = item.id === "spot" ? "light" : item.id === "intro1m" ? "1m" : item.id === "intensive3m" ? "3m" : item.id === "monthly" ? "monthly" : "";
    });
    audit("menu_apply", { menuId: item.id });
  }

  const setInputs = (fn: (i: PricingInputs) => void) =>
    void patch((x) => {
      const cur: PricingInputs = x.pricing?.inputs ?? buildPricingDefaults(x);
      fn(cur);
      x.pricing = { ...x.pricing, inputs: cur };
    });

  function calc() {
    void patch((x) => {
      const cur: PricingInputs = x.pricing?.inputs ?? buildPricingDefaults(x);
      x.pricing = {
        inputs: cur,
        result: calculatePricing(cur),
        calculatedAt: new Date().toISOString(),
      };
    });
    audit("pricing_calculate");
  }

  function applyPreset(key: string) {
    const p = (PRICING_PRESETS as Record<string, any>)[key];
    if (!p) return;
    void patch((x) => {
      const cur: PricingInputs = x.pricing?.inputs ?? buildPricingDefaults(x);
      const company = x.settings.companyName || "無題";
      const next: PricingInputs = {
        ...cur,
        projectTitle: `${company}向け ${p.title}`,
        hours: p.hours,
        baseline: p.baseline,
        difficulty: p.difficulty,
        urgency: p.urgency,
        clientSize: cur.clientSize || p.clientSize,
        experience: p.experience,
        scopeRisk: p.scopeRisk,
        payment: p.payment,
        decisionMakers: p.decisionMakers,
        deliverables: p.deliverables,
        duration: p.duration,
      };
      x.pricing = { ...x.pricing, inputs: next };
      const planMap: Record<string, string> = {
        spot: "light",
        design: "",
        intro: "1m",
        intensive: "3m",
        monthly: "monthly",
        training: "",
      };
      x.plan = planMap[key] ?? "";
      if (x.execution) {
        if (key === "spot" || key === "design" || key === "training") x.execution.contractType = "single";
        else if (key === "intro") x.execution.contractType = "1m";
        else if (key === "intensive") x.execution.contractType = "3m";
        else if (key === "monthly") x.execution.contractType = "monthly";
      }
    });
  }

  const flowHours = c.flowAnalysis?.result?.gap
    ? Math.round((c.flowAnalysis.result.gap.asisTime / 60) * 0.3)
    : null;

  return (
    <div className="space-y-4">
      <Panel title="よく使う型から始める" note="押すと入力欄がまとめて埋まります。あとから調整できます。">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PRICING_PRESETS).map(([k, p]) => (
            <button key={k} className="btn btn-sm" onClick={() => applyPreset(k)}>
              {(p as { title: string }).title}
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title="このクライアントに合いそうな支援メニュー"
        note="①設定の業種・規模と②の成熟度診断から点数づけしています。選ぶと「何を・どれくらい」が積算に反映されます。"
      >
        {top3.length === 0 ? (
          <Empty>①案件設定で業種・規模・想定課題を入れると、ここに推奨が出ます。</Empty>
        ) : (
          <div className="space-y-2">
            {top3.map(({ item, score, reasons }, i) => {
              const open = openMenuId === item.id;
              const isPicked = pickedId === item.id;
              return (
                <div
                  key={item.id}
                  className={`rounded-sm border px-3 py-2.5 ${isPicked ? "border-accent bg-accent-050" : "border-line bg-ink-850"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-paper-faint">{i + 1}位</span>
                    <span className="text-[13px] font-medium text-paper">{item.name}</span>
                    <span className="text-[11px] text-paper-dim">{item.catchcopy}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="text-[11px] text-paper-faint">{score}点</span>
                      {isPicked && <Badge color="#0e7490">積算に反映済み</Badge>}
                      <button
                        className="btn btn-sm"
                        onClick={() => setOpenMenuId(open ? null : item.id)}
                      >
                        {open ? "閉じる" : "内容を見る"}
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setPickedMenuId(item.id)}
                      >
                        提案文を見る
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setPickedMenuId(item.id);
                          applyMenu(item);
                        }}
                      >
                        このメニューを積算に反映
                      </button>
                    </span>
                  </div>
                  {open && (
                    <div className="mt-3 space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed">
                      <div>
                        <Sec>やること</Sec>
                        <ul className="list-disc pl-5">
                          {item.includes.map((t, j) => (
                            <li key={j}>{t}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex flex-wrap gap-4 text-paper-dim">
                        <span>期間：{item.period}</span>
                        <span>工数の目安：{item.hoursMin}〜{item.hoursMax}時間</span>
                        <span>料金の目安：{item.priceNote}</span>
                      </div>
                      <div>
                        <Sec>お渡しするもの</Sec>
                        <ul className="list-disc pl-5">
                          {item.deliverables.map((d, j) => (
                            <li key={j}>{d}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <Sec>この料金に含まれないもの</Sec>
                        <ul className="list-disc pl-5 text-paper-dim">
                          {item.excludes.map((e, j) => (
                            <li key={j}>{e}</li>
                          ))}
                        </ul>
                      </div>
                      {reasons.length > 0 && (
                        <p className="text-[12px] text-paper-faint">
                          推した理由：{reasons.join("／")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {pickedItem && (
          <div className="mt-3 rounded-sm border border-line bg-ink-900 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12px] text-paper-dim">
                提案書・見積に差し込める文面（{pickedItem.name}）
              </span>
              <CopyButton text={proposalText} label="提案文をコピー" />
            </div>
            <div className="doc max-h-[220px] overflow-auto whitespace-pre-wrap text-[12px]">
              {proposalText}
            </div>
          </div>
        )}
      </Panel>

      {stageDef && (
        <Panel
          title="成熟度から見た価格の目安"
          note={`②の診断で「${stage}」と出ています。この段階に見合った金額の考え方です。`}
          right={
            <button
              className="btn btn-sm"
              onClick={() =>
                setInputs((i) => {
                  // 標準額に合わせて時間単価を逆算する（工数は動かさない）
                  const hours = i.hours || 1;
                  i.baseline = Math.max(1000, Math.round(stageDef.std / hours / 100) * 100);
                })
              }
            >
              標準額に合わせる
            </button>
          }
        >
          <Grid cols={3}>
            <Stat label="下限" value={`¥${formatYen(legacyNetToGross(stageDef.lo))}`} color="#6B665F" />
            <Stat label="標準" value={`¥${formatYen(legacyNetToGross(stageDef.std))}`} color="#0e7490" />
            <Stat label="上限" value={`¥${formatYen(legacyNetToGross(stageDef.hi))}`} color="#4A7C59" />
          </Grid>
          <div className="mt-3 space-y-1.5 text-[13px] leading-relaxed">
            <p>
              <span className="text-paper-dim">推奨メニュー：</span>
              {stageDef.name}（{stageDef.desc}）
            </p>
            <p>
              <span className="text-paper-dim">この額にする理由：</span>
              {stageDef.why}
            </p>
            <p>
              <span className="text-paper-dim">上振れの条件：</span>
              {stageDef.upCond}
            </p>
            <p>
              <span className="text-paper-dim">月額に切り替えるなら：</span>
              {stageDef.monthly}
            </p>
          </div>
        </Panel>
      )}

      <Panel
        title="積算の材料"
        note="時間単価に、難易度・急ぎ・リスク・規模の係数を掛けて出します。"
        right={
          <button className="btn btn-primary btn-sm" onClick={calc}>
            計算する
          </button>
        }
      >
        <Grid cols={2}>
          <Field
            label="案件名"
            value={inputs.projectTitle}
            onChange={(v) => setInputs((i) => void (i.projectTitle = v))}
          />
          <NumField
            label="想定総工数"
            value={inputs.hours}
            onChange={(v) => setInputs((i) => void (i.hours = v))}
            suffix="時間"
            min={1}
            max={2000}
            hint={
              flowHours != null
                ? `③フロー分析の所要時間からの目安は ${flowHours} 時間です。`
                : undefined
            }
          />
          <NumField
            label="自分の時間単価（税込）"
            value={legacyNetToGross(inputs.baseline)}
            onChange={(v) => setInputs((i) => void (i.baseline = grossToLegacyNet(v)))}
            suffix="円/時"
            step={500}
          />
          <Select
            label="難易度"
            value={String(inputs.difficulty)}
            onChange={(v) => setInputs((i) => void (i.difficulty = Number(v)))}
            options={toOpts(DIFFICULTY_LABELS as unknown as Record<string, string>)}
          />
          <Select
            label="急ぎ度"
            value={inputs.urgency}
            onChange={(v) => setInputs((i) => void (i.urgency = v))}
            options={toOpts(URGENCY_LABEL)}
          />
          <Select
            label="クライアント規模"
            value={inputs.clientSize}
            onChange={(v) => setInputs((i) => void (i.clientSize = v))}
            options={toOpts(CLIENT_SIZE_LABEL)}
          />
          <Select
            label="この領域の経験"
            value={inputs.experience}
            onChange={(v) => setInputs((i) => void (i.experience = v))}
            options={toOpts(EXPERIENCE_LABEL)}
          />
          <Select
            label="範囲が動くリスク"
            value={inputs.scopeRisk}
            onChange={(v) => setInputs((i) => void (i.scopeRisk = v))}
            options={toOpts(SCOPE_RISK_LABEL)}
          />
          <Select
            label="支払条件"
            value={inputs.payment}
            onChange={(v) => setInputs((i) => void (i.payment = v))}
            options={toOpts(PAYMENT_LABEL)}
            hint="運用は前払い（入金確認後に着手）が基本です。後払いにする場合、支払期日は給付を受領した日から起算します（取適法）。検収日起算にしないでください。"
          />
          <Select
            label="決める人の数"
            value={inputs.decisionMakers}
            onChange={(v) => setInputs((i) => void (i.decisionMakers = v))}
            options={toOpts(DECISION_LABEL)}
          />
          <Select
            label="期間"
            value={inputs.duration}
            onChange={(v) => setInputs((i) => void (i.duration = v))}
            options={toOpts(DURATION_LABEL)}
          />
          <NumField
            label="他社の見積（税込・分かれば）"
            value={legacyNetToGross(inputs.competitor)}
            onChange={(v) => setInputs((i) => void (i.competitor = grossToLegacyNet(v)))}
            suffix="円"
            step={100000}
            hint="入れると、高すぎ・安すぎの注意が出ます。"
          />
        </Grid>

        <div className="mt-4">
          <Chips
            label="出す成果物"
            values={toOpts(DELIVERABLE_LABELS)}
            selected={inputs.deliverables}
            onToggle={(v) =>
              setInputs((i) => {
                i.deliverables = i.deliverables.includes(v)
                  ? i.deliverables.filter((x) => x !== v)
                  : [...i.deliverables, v];
              })
            }
            hint="1つにつき基準額の5%を加算します。"
          />
        </div>
      </Panel>

      {!result ? (
        <Empty>まだ計算していません。材料を入れて「計算する」を押してください。</Empty>
      ) : (
        <>
          <Panel title="出た金額" note="税込です。消費税を重ねて上乗せしないでください。内訳は請求書ごと・税率ごとに計算します。">
            <Grid cols={3}>
              <Stat
                label="堅実プラン"
                value={<Mask>¥{formatYen(legacyNetToGross(result.safe))}</Mask>}
                sub="範囲を絞ったとき"
                color="#6B665F"
              />
              <Stat
                label="推奨プラン"
                value={<Mask>¥{formatYen(legacyNetToGross(result.recommended))}</Mask>}
                sub={`時間単価に換算すると ¥${formatYen(Math.round(legacyNetToGross(result.recommended) / Math.max(1, inputs.hours)))}/h`}
                color="#0e7490"
              />
              <Stat
                label="挑戦プラン"
                value={<Mask>¥{formatYen(legacyNetToGross(result.challenge))}</Mask>}
                sub="内容を広げたとき"
                color="#4A7C59"
              />
            </Grid>

            <div className="mt-4">
              <Sec>金額の内訳（税込換算の目安）</Sec>
              <table className="tbl">
                <tbody>
                  <tr>
                    <td>基準額</td>
                    <td className="text-[12px] text-paper-dim">
                      {inputs.hours}時間 × ¥{formatYen(legacyNetToGross(inputs.baseline))}/h
                    </td>
                    <td className="n">
                      <Mask>¥{formatYen(legacyNetToGross(result.base))}</Mask>
                    </td>
                  </tr>
                  <tr>
                    <td>難易度</td>
                    <td className="text-[12px] text-paper-dim">
                      {(DIFFICULTY_LABELS as Record<string, string>)[String(inputs.difficulty)]}
                    </td>
                    <td className="n">×{result.difficultyCoef.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>急ぎ度</td>
                    <td className="text-[12px] text-paper-dim">
                      {(URGENCY_LABEL as Record<string, string>)[inputs.urgency]}
                    </td>
                    <td className="n">×{result.urgencyCoef.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>リスク合計</td>
                    <td className="text-[12px] text-paper-dim">
                      範囲{(result.scopeAdd * 100).toFixed(0)}% + 支払
                      {(result.paymentAdd * 100).toFixed(0)}% + 決裁
                      {(result.decisionAdd * 100).toFixed(0)}%
                    </td>
                    <td className="n">×{result.riskCoef.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>クライアント規模</td>
                    <td className="text-[12px] text-paper-dim">
                      {(CLIENT_SIZE_LABEL as Record<string, string>)[inputs.clientSize]}
                    </td>
                    <td className="n">×{result.sizeCoef.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>経験</td>
                    <td className="text-[12px] text-paper-dim">
                      {(EXPERIENCE_LABEL as Record<string, string>)[inputs.experience]}
                    </td>
                    <td className="n">×{result.expCoef.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>成果物の加算</td>
                    <td className="text-[12px] text-paper-dim">
                      {result.deliverableCount}点 × 基準額の5%
                    </td>
                    <td className="n">
                      <Mask>+¥{formatYen(legacyNetToGross(result.deliverableAdd))}</Mask>
                    </td>
                  </tr>
                  <tr>
                    <td className="font-medium">合計（丸める前）</td>
                    <td />
                    <td className="n font-medium">
                      <Mask>¥{formatYen(legacyNetToGross(result.adjusted))}</Mask>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="出す前に見ておくこと">
            <div className="space-y-2">
              {buildAlerts(inputs, result).map((a, i) => (
                <div
                  key={i}
                  className="rounded-sm border border-line bg-ink-850 px-3 py-2.5 text-[13px] leading-relaxed"
                >
                  <span className="font-medium text-warn">{a.title}</span>
                  <p className="mt-1 text-paper-dim">{a.body}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="伝え方の下書き"
            note="そのまま読むのではなく、自分の言葉に直してから使ってください。"
            right={<CopyButton text={generateTalk(inputs, result)} label="コピー" />}
          >
            <div className="doc max-h-[420px] overflow-auto">
              <Mask>{generateTalk(inputs, result)}</Mask>
            </div>
            <div className="mt-3">
              <Note tone="warn">
                削減時間・金額換算はいずれも概算です。「見込まれます」までに留め、
                成果を約束する言い方にはしないでください（免責事項 第6条）。
              </Note>
            </div>
          </Panel>

          <Panel
            title="見積として確定させる"
            note="ここで入れた金額が⑨法務チェックの書類に差し込まれます。金額を確定すると、⑩三方良しの空欄に確定内容の下書きが自動で入ります（あとから手で直せます）。"
          >
            <Grid cols={3}>
              <NumField
                label="税込金額"
                value={c.estimate.totalIncTax}
                onChange={(v) =>
                  void patch((x) => {
                    x.estimate.totalIncTax = v;
                    if (v > 0) applySanpoAutofill(x, "④単価設計で見積を確定");
                  })
                }
                suffix="円"
                step={10000}
                hint={`推奨プランの税込は ¥${formatYen(legacyNetToGross(result.recommended))} です。`}
              />
              <Field
                label="見積の有効期限"
                type="date"
                value={c.estimate.validUntil}
                onChange={(v) =>
                  void patch((x) => {
                    x.estimate.validUntil = v;
                    if (x.estimate.totalIncTax > 0)
                      applySanpoAutofill(x, "④単価設計で見積を確定");
                  })
                }
              />
              <Field
                label="発行日"
                type="date"
                value={c.estimate.issuedAt}
                onChange={(v) =>
                  void patch((x) => {
                    x.estimate.issuedAt = v;
                    if (x.estimate.totalIncTax > 0)
                      applySanpoAutofill(x, "④単価設計で見積を確定");
                  })
                }
              />
            </Grid>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                className="btn btn-sm"
                onClick={() =>
                  void patch((x) => {
                    x.estimate.totalIncTax = legacyNetToGross(result.safe);
                    applySanpoAutofill(x, "④単価設計で見積を確定");
                  })
                }
              >
                堅実プランの税込を入れる
              </button>
              <button
                className="btn btn-sm"
                onClick={() =>
                  void patch((x) => {
                    x.estimate.totalIncTax = legacyNetToGross(result.recommended);
                    applySanpoAutofill(x, "④単価設計で見積を確定");
                  })
                }
              >
                推奨プランの税込を入れる
              </button>
              <button
                className="btn btn-sm"
                onClick={() =>
                  void patch((x) => {
                    x.estimate.totalIncTax = legacyNetToGross(result.challenge);
                    applySanpoAutofill(x, "④単価設計で見積を確定");
                  })
                }
              >
                挑戦プランの税込を入れる
              </button>
            </div>

            <div className="mt-4">
              <Sec>請求と入金</Sec>
              <Grid cols={4}>
                <Field
                  label="支払条件"
                  value={c.invoice.paymentTerm}
                  onChange={(v) =>
                    void patch((x) => {
                      x.invoice.paymentTerm = v;
                      if (x.estimate.totalIncTax > 0)
                        applySanpoAutofill(x, "④単価設計で見積を確定");
                    })
                  }
                  placeholder="前払い（入金確認後に着手）"
                />
                <Field
                  label="請求書送付日"
                  type="date"
                  value={c.invoice.billingDate}
                  onChange={(v) => void patch((x) => void (x.invoice.billingDate = v))}
                />
                <Field
                  label="入金期限"
                  type="date"
                  value={c.invoice.dueDate}
                  onChange={(v) => void patch((x) => void (x.invoice.dueDate = v))}
                  hint="前払いの入金期限です。未入金のままこの日が来ると、次にやることに「入金待ち・着手保留」が自動で出ます。"
                />
                <Field label="確認した実入金日" type="date" value={c.invoice.paidAt} onChange={(v) => void patch((x) => { x.invoice.paidAt = v; x.invoice.paidFlag = false; })} hint="予定日や今日の日付で補いません。実入金日を入力し、下のボタンで証拠確認を記録してください。" />
                <div>
                  <span className="field-label">入金（確認後に着手）</span>
                  <button
                    className={`btn w-full ${c.invoice.paidFlag ? "btn-primary" : ""}`}
                    onClick={() =>
                      void patch((x) => {
                        if (!x.invoice.paidFlag && (!verifiedCalendarDate(x.invoice.paidAt) || x.invoice.paidAt > contractTodayJst())) { window.alert("確認済みの実入金日を入力してください。未来日や未入力を入金済みとは扱いません。"); return; }
                        x.invoice.paidFlag = !x.invoice.paidFlag;
                      })
                    }
                  >
                    {c.invoice.paidFlag ? `入金確認済み（${c.invoice.paidAt}）。合意・通知した開始日を確認` : "未入金・着手保留"}
                  </button>
                </div>
              </Grid>
            </div>
          </Panel>
        </>
      )}

      <Panel
        title="継続価値の比較（A/F）"
        note="A＝同等の範囲・品質・停止条件を満たす最良代替案の全管理費用。F＝当事務所料金＋顧客に残る管理負担＋追加継続費。Aが不明なら未判定のままにします。削減時間をそのまま現金削減と呼ばないでください。"
      >
        <Grid cols={3}>
          <Field
            label="A: 最良代替の全管理費用（円/月）"
            type="number"
            value={String(c.pricing?.af?.alternative ?? 0)}
            onChange={(v) =>
              void patch((x) => {
                if (!x.pricing) x.pricing = {};
                if (!x.pricing.af)
                  x.pricing.af = {
                    alternative: 0,
                    alternativeNote: "",
                    fee: 0,
                    clientBurden: 0,
                    extraCost: 0,
                  };
                x.pricing.af.alternative = Number(v) || 0;
              })
            }
            hint="0のままは未判定"
          />
          <Field
            label="F: 料金（円/月）"
            type="number"
            value={String(c.pricing?.af?.fee ?? 0)}
            onChange={(v) =>
              void patch((x) => {
                if (!x.pricing) x.pricing = {};
                if (!x.pricing.af)
                  x.pricing.af = {
                    alternative: 0,
                    alternativeNote: "",
                    fee: 0,
                    clientBurden: 0,
                    extraCost: 0,
                  };
                x.pricing.af.fee = Number(v) || 0;
              })
            }
          />
          <Field
            label="F: 顧客に残る管理負担（円/月）"
            type="number"
            value={String(c.pricing?.af?.clientBurden ?? 0)}
            onChange={(v) =>
              void patch((x) => {
                if (!x.pricing) x.pricing = {};
                if (!x.pricing.af)
                  x.pricing.af = {
                    alternative: 0,
                    alternativeNote: "",
                    fee: 0,
                    clientBurden: 0,
                    extraCost: 0,
                  };
                x.pricing.af.clientBurden = Number(v) || 0;
              })
            }
            hint="顧客へ移した確認時間も含める"
          />
        </Grid>
        <Grid cols={2} className="mt-3">
          <Field
            label="F: 追加継続費（円/月）"
            type="number"
            value={String(c.pricing?.af?.extraCost ?? 0)}
            onChange={(v) =>
              void patch((x) => {
                if (!x.pricing) x.pricing = {};
                if (!x.pricing.af)
                  x.pricing.af = {
                    alternative: 0,
                    alternativeNote: "",
                    fee: 0,
                    clientBurden: 0,
                    extraCost: 0,
                  };
                x.pricing.af.extraCost = Number(v) || 0;
              })
            }
          />
          <Field
            label="Aの根拠"
            value={c.pricing?.af?.alternativeNote ?? ""}
            onChange={(v) =>
              void patch((x) => {
                if (!x.pricing) x.pricing = {};
                if (!x.pricing.af)
                  x.pricing.af = {
                    alternative: 0,
                    alternativeNote: "",
                    fee: 0,
                    clientBurden: 0,
                    extraCost: 0,
                  };
                x.pricing.af.alternativeNote = v;
              })
            }
            placeholder="どの代替案（内製・標準ソフト・他社）か"
          />
        </Grid>
        {(() => {
          const af = c.pricing?.af;
          if (!af) return null;
          const f = (af.fee || 0) + (af.clientBurden || 0) + (af.extraCost || 0);
          const a = af.alternative || 0;
          if (f <= 0 || a <= 0)
            return (
              <p className="mt-3 text-[12px] text-paper-faint">
                AとFの両方を入れると比較が出ます。代替費用が不明なら未判定です。
              </p>
            );
          const ratio = a / f;
          return (
            <div className="mt-3">
              <Note tone={ratio >= 1.5 ? "ok" : ratio >= 1 ? "warn" : "alert"}>
                F={f.toLocaleString()}円/月、A={a.toLocaleString()}円/月、A/F=
                {ratio.toFixed(2)}（A−F={(a - f).toLocaleString()}円/月）。
                {ratio >= 1.5
                  ? "暫定目安（A/F≧1.5）を満たしています。未計測費用への余裕として置いた仮説なので、実額・品質条件・顧客判断で再評価してください。"
                  : "暫定目安（A/F≧1.5）を下回っています。範囲・品質条件の見直しか、縮小・内製・他社の選択肢を提示してください。"}
              </Note>
            </div>
          );
        })()}
      </Panel>
    </div>
  );
}
