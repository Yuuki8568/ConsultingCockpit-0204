/** リード③ ダッシュボード — ファネル・獲得KPI・失注傾向・月次推移・売上見込み */
import { useMemo } from "react";
import { useVault } from "../../hooks/use-vault";
import { Empty, Grid, Note, NumField, Panel, Sec, Stat, Badge } from "../../components/kit";
import { Mask } from "../../components/mask";
import {
  FUNNEL_STATUSES,
  LEAD_KINDS,
  LEAD_SOURCES,
  LOST_REASON_TAGS,
  SALES_STAGES,
} from "../../domain/data/sales";
import { calcPipelineForecast, calcPipelineVelocity } from "../../domain/logic/sales";
import { formatYen, legacyNetToGross } from "../../domain/logic/pricing";

export function LeadDashboard() {
  const { state, mutate } = useVault();
  // フックは早期 return より前に置く
  const leads = useMemo(() => state?.leads ?? [], [state]);
  const cases = useMemo(() => state?.cases ?? [], [state]);

  const forecast = useMemo(() => calcPipelineForecast(leads), [leads]);
  const velocity = useMemo(() => calcPipelineVelocity(leads, cases), [leads, cases]);

  const funnel = useMemo(() => {
    const counts: Record<string, number> = {};
    FUNNEL_STATUSES.forEach(([k]) => (counts[k] = 0));
    leads.forEach((l) => {
      if (l.funnelStatus) counts[l.funnelStatus] = (counts[l.funnelStatus] ?? 0) + 1;
    });
    return counts;
  }, [leads]);

  // 接触＝送信日または送信状態「送信確認済み」の記録があるもの。返信＝返信日または返信状態「返信あり」
  const bySource = useMemo(() => {
    const m: Record<string, { total: number; contacted: number; replied: number; won: number }> =
      {};
    LEAD_SOURCES.forEach((s) => (m[s] = { total: 0, contacted: 0, replied: 0, won: 0 }));
    leads.forEach((l) => {
      const k = l.source || "その他";
      m[k] ??= { total: 0, contacted: 0, replied: 0, won: 0 };
      m[k].total++;
      if (l.sentAt || l.sendState === "sent") m[k].contacted++;
      if (l.repliedAt || l.replyState === "replied") m[k].replied++;
      if (l.convertedCaseId || l.salesStage === "won") m[k].won++;
    });
    return m;
  }, [leads]);

  const byKind = useMemo(() => {
    const m: Record<string, { total: number; contacted: number; replied: number; won: number }> =
      {};
    leads.forEach((l) => {
      const k = l.leadKind || "";
      m[k] ??= { total: 0, contacted: 0, replied: 0, won: 0 };
      m[k].total++;
      if (l.sentAt || l.sendState === "sent") m[k].contacted++;
      if (l.repliedAt || l.replyState === "replied") m[k].replied++;
      if (l.convertedCaseId || l.salesStage === "won") m[k].won++;
    });
    return m;
  }, [leads]);

  // 結果不明の送信。自動再送はせず、人が受付の有無を照合する
  const unknownSends = useMemo(() => leads.filter((l) => l.sendState === "unknown"), [leads]);

  const lostByTag = useMemo(() => {
    const m: Record<string, number> = {};
    LOST_REASON_TAGS.forEach((t) => (m[t] = 0));
    leads.forEach((l) => {
      if (l.status === "lost" && l.lostReason?.tag) m[l.lostReason.tag]++;
    });
    return m;
  }, [leads]);

  const monthly = useMemo(() => {
    const m: Record<string, { created: number; won: number }> = {};
    leads.forEach((l) => {
      const ym = String(l.createdAt).slice(0, 7);
      if (!ym) return;
      m[ym] ??= { created: 0, won: 0 };
      m[ym].created++;
      if (l.convertedCaseId || l.salesStage === "won") m[ym].won++;
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  }, [leads]);

  const byStage = useMemo(() => {
    const m: Record<string, number> = {};
    SALES_STAGES.forEach(([k]) => (m[k] = 0));
    leads.forEach((l) => {
      if (l.status === "lost") return;
      m[l.salesStage || "approach"] = (m[l.salesStage || "approach"] ?? 0) + 1;
    });
    return m;
  }, [leads]);

  if (!state) return null;

  // 継続で入ってくる月額の合計
  const recurring = cases.reduce(
    (a, c) => a + legacyNetToGross(c.support?.contract?.monthlyFee ?? 0),
    0,
  );
  const engaged = leads.filter((l) => l.funnelStatus === "engaged").length;
  const goals = state.goals;


  if (leads.length === 0 && cases.length === 0) {
    return <Empty>まだ数字がありません。リードか案件を登録すると、ここに集計が出ます。</Empty>;
  }

  return (
    <div className="space-y-4">
      <Panel title="いま見えている売上（期待）" note="未受注リードの保存済み想定金額（税区分未確認）に、ステージごとの確度を掛けた見込みです。税込額の確定値ではありません。受注済みの金額は下の「受注済みと期待の分離」に集計しています。">
        <Grid cols={4}>
          <Stat
            label="確度を掛けた見込み"
            value={<Mask>¥{formatYen(forecast.weighted)}</Mask>}
            sub={`案件総額 ¥${formatYen(forecast.total)}`}
            color="#0e7490"
          />
          <Stat
            label="ほぼ確実（90%以上）"
            value={<Mask>¥{formatYen(forecast.commit)}</Mask>}
            color="#4A7C59"
          />
          <Stat
            label="五分以上（50%以上）"
            value={<Mask>¥{formatYen(forecast.best)}</Mask>}
            color="#C9A961"
          />
          <Stat
            label="継続で入る月額"
            value={<Mask>¥{formatYen(recurring)}</Mask>}
            sub={`税込・年換算 ¥${formatYen(recurring * 12)}`}
            color="#3B6E8F"
          />
        </Grid>
        {forecast.rows.length > 0 && (
          <div className="mt-4">
            <Sec>内訳</Sec>
            <table className="tbl">
              <thead>
                <tr>
                  <th>企業</th>
                  <th className="w-36">ステージ</th>
                  <th className="w-20">確度</th>
                  <th className="w-32">想定金額</th>
                  <th className="w-32">見込み</th>
                </tr>
              </thead>
              <tbody>
                {forecast.rows
                  .slice()
                  .sort((a, b) => b.w - a.w)
                  .map((r, i) => (
                    <tr key={i}>
                      <td>
                        <Mask>{r.company}</Mask>
                      </td>
                      <td className="text-[12px]">
                        {SALES_STAGES.find(([k]) => k === r.stage)?.[1] ?? r.stage}
                      </td>
                      <td className="n">{r.prob}%</td>
                      <td className="n">
                        <Mask>¥{formatYen(r.val)}</Mask>
                      </td>
                      <td className="n">
                        <Mask>¥{formatYen(r.w)}</Mask>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="受注済みと期待の分離"
        note="決まった売上と、まだ決まっていない期待を混ぜません。受注済みは案件の契約額（価格の状態が「合意済み」のもの）だけを数えます。"
      >
        {(() => {
          const agreed = cases.filter((cc) => cc.fde?.priceStatus === "agreed");
          const oneShot = agreed
            .filter((cc) => cc.fde?.productKind !== "monthly")
            .reduce((a, cc) => a + legacyNetToGross(cc.fde?.contractAmount ?? 0), 0);
          const monthlyAgreed = agreed
            .filter((cc) => cc.fde?.productKind === "monthly")
            .reduce((a, cc) => a + legacyNetToGross(cc.fde?.contractAmount ?? 0), 0);
          return (
            <Grid cols={4}>
              <Stat
                label="受注済み（単発・税込合計）"
                value={<Mask>¥{formatYen(oneShot)}</Mask>}
                sub={`合意済み ${agreed.filter((cc) => cc.fde?.productKind !== "monthly").length} 件`}
                color="#4A7C59"
              />
              <Stat
                label="受注済み（継続・税込月額）"
                value={<Mask>¥{formatYen(monthlyAgreed + recurring)}</Mask>}
                sub="月次運用＋継続サポート（税込）"
                color="#3B6E8F"
              />
              <Stat
                label="期待売上（税区分未確認・確度加重）"
                value={<Mask>¥{formatYen(forecast.weighted)}</Mask>}
                sub="未受注のリードのみ。受注済みは含まない"
                color="#C9A961"
              />
              <Stat
                label="今月の営業工数"
                value={(() => {
                  const ym = new Date().toISOString().slice(0, 7);
                  const rec = (state.salesKpi.effort ?? []).find((e) => e.month === ym);
                  return rec ? `${rec.minutes} 分` : "—";
                })()}
                sub="未記録なら「—」。0分とは書かない"
              />
            </Grid>
          );
        })()}
        <div className="mt-4 border-t border-line pt-4">
          <Sec>営業工数の記録（月ごと・分）</Sec>
          <div className="space-y-1.5">
            {(state.salesKpi.effort ?? [])
              .slice()
              .sort((a, b) => b.month.localeCompare(a.month))
              .map((e) => {
                const idx = (state.salesKpi.effort ?? []).findIndex((x) => x.month === e.month);
                return (
                  <div key={e.month} className="flex items-center gap-2">
                    <span className="num w-20 text-[12px] text-paper-dim">{e.month}</span>
                    <input
                      type="number"
                      className="field num w-28 py-1"
                      value={e.minutes}
                      min={0}
                      onChange={(ev) =>
                        void mutate(
                          (s) => void (s.salesKpi.effort![idx].minutes = Math.max(0, Number(ev.target.value) || 0)),
                          ["meta:app"],
                        )
                      }
                    />
                    <span className="text-[11px] text-paper-faint">分</span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        void mutate((s) => void s.salesKpi.effort!.splice(idx, 1), ["meta:app"])
                      }
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            <button
              className="btn btn-sm"
              onClick={() => {
                const ym = new Date().toISOString().slice(0, 7);
                void mutate((s) => {
                  if (!Array.isArray(s.salesKpi.effort)) s.salesKpi.effort = [];
                  if (!s.salesKpi.effort.some((e) => e.month === ym))
                    s.salesKpi.effort.push({ month: ym, minutes: 0 });
                }, ["meta:app"]);
              }}
            >
              + 今月分を追加
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-paper-faint">
            営業に使った本人の時間です。AIの稼働時間はここに含めません（自社モードの月次記録で分けて管理します）。
          </p>
        </div>
      </Panel>

      <Panel
        title="回り方"
        note="進行中の件数 × 成約率 × 平均単価 ÷ 平均日数。1日あたりいくら生み出しているかの目安です。"
      >
        <Grid cols={4}>
          <Stat
            label="1日あたり"
            value={<Mask>¥{formatYen(velocity.velocity)}</Mask>}
            color="#0e7490"
          />
          <Stat label="成約率" value={`${Math.round(velocity.winRate * 100)}%`} />
          <Stat label="平均単価" value={<Mask>¥{formatYen(velocity.avgDeal)}</Mask>} />
          <Stat
            label="決まるまでの日数"
            value={velocity.avgCycle > 0 ? `${velocity.avgCycle} 日` : "—"}
            sub={`進行中 ${velocity.openDeals} 件`}
          />
        </Grid>
        {velocity.avgCycle === 0 && (
          <div className="mt-3">
            <Note tone="info">
              受注に至ったリードがまだないため、日数と回り方は算出できません。1件でも案件化すると出ます。
            </Note>
          </div>
        )}
      </Panel>

      <Panel title="営業ステージの分布">
        <div className="space-y-2">
          {SALES_STAGES.map(([k, label, color]) => {
            const n = byStage[k] ?? 0;
            const max = Math.max(1, ...Object.values(byStage));
            return (
              <div key={k} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-[12px] text-paper-dim">{label}</span>
                <div className="h-4 flex-1 overflow-hidden rounded-sm bg-ink-700">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${(n / max) * 100}%`, background: color }}
                  />
                </div>
                <span className="num w-8 shrink-0 text-right text-[12px]">{n}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="相談から伴走まで"
        note="どこで落ちているかを見ます。目標を入れると達成度が出ます。"
      >
        <div className="space-y-2">
          {FUNNEL_STATUSES.map(([k, label, color]) => {
            const n = funnel[k] ?? 0;
            const max = Math.max(1, ...Object.values(funnel));
            return (
              <div key={k} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-[12px] text-paper-dim">{label}</span>
                <div className="h-4 flex-1 overflow-hidden rounded-sm bg-ink-700">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${(n / max) * 100}%`, background: color }}
                  />
                </div>
                <span className="num w-8 shrink-0 text-right text-[12px]">{n}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <Grid cols={3}>
            <NumField
              label="月の伴走件数の目標"
              value={goals.monthlyEngageTarget}
              onChange={(v) =>
                void mutate((s) => void (s.goals.monthlyEngageTarget = v), ["meta:app"])
              }
              suffix="件"
            />
            <NumField
              label="相談→診断の想定率"
              value={goals.consultToDiag}
              onChange={(v) => void mutate((s) => void (s.goals.consultToDiag = v), ["meta:app"])}
              suffix="%"
            />
            <NumField
              label="診断→伴走の想定率"
              value={goals.diagToEngage}
              onChange={(v) => void mutate((s) => void (s.goals.diagToEngage = v), ["meta:app"])}
              suffix="%"
            />
          </Grid>
          {goals.monthlyEngageTarget > 0 && (
            <div className="mt-3">
              <Note tone={engaged >= goals.monthlyEngageTarget ? "ok" : "info"}>
                目標 {goals.monthlyEngageTarget} 件に対し、いま伴走は {engaged} 件です。
                想定率で逆算すると、必要な相談件数は約{" "}
                {Math.ceil(
                  goals.monthlyEngageTarget /
                    Math.max(0.01, (goals.consultToDiag / 100) * (goals.diagToEngage / 100)),
                )}{" "}
                件になります。
              </Note>
            </div>
          )}
        </div>
      </Panel>

      <Grid cols={2}>
        <Panel
          title="どこから来ているか"
          note="接触＝送信の記録があるもの、返信＝返信の記録があるもの、受注＝案件化またはステージ「受注」。"
        >
          {Object.entries(bySource).filter(([, v]) => v.total > 0).length === 0 ? (
            <Empty>流入元が未設定です。リードに設定すると集計されます。</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>流入元</th>
                  <th className="w-14">件数</th>
                  <th className="w-14">接触</th>
                  <th className="w-14">返信</th>
                  <th className="w-14">受注</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(bySource)
                  .filter(([, v]) => v.total > 0)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="n">{v.total}</td>
                      <td className="n">{v.contacted}</td>
                      <td className="n">{v.replied}</td>
                      <td className="n">{v.won}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="失注の傾向">
          {Object.values(lostByTag).every((v) => v === 0) ? (
            <Empty>失注の理由がまだ記録されていません。②一覧の下で記録できます。</Empty>
          ) : (
            <div className="space-y-2">
              {Object.entries(lostByTag)
                .filter(([, n]) => n > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([tag, n]) => {
                  const max = Math.max(...Object.values(lostByTag));
                  return (
                    <div key={tag} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-[12px] text-paper-dim">{tag}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded-sm bg-ink-700">
                        <div
                          className="h-full"
                          style={{ width: `${(n / max) * 100}%`, background: "#B85C38" }}
                        />
                      </div>
                      <span className="num w-8 shrink-0 text-right text-[12px]">{n}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </Panel>
      </Grid>

      <Panel
        title="募集種別ごとの進行"
        note="④営業プロセスの「出典と窓口」で記録した募集種別の集計です。雇用求人は参考情報で、外注ニーズとは区別します。"
      >
        {Object.entries(byKind).filter(([, v]) => v.total > 0).length === 0 ? (
          <Empty>募集種別が未設定です。④営業プロセスの「出典と窓口」で設定すると集計されます。</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>募集種別</th>
                <th className="w-14">件数</th>
                <th className="w-14">接触</th>
                <th className="w-14">返信</th>
                <th className="w-14">受注</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byKind)
                .filter(([, v]) => v.total > 0)
                .sort(([, a], [, b]) => b.total - a.total)
                .map(([k, v]) => (
                  <tr key={k || "unset"}>
                    <td>{LEAD_KINDS.find(([kk]) => kk === k)?.[1] ?? "未設定"}</td>
                    <td className="n">{v.total}</td>
                    <td className="n">{v.contacted}</td>
                    <td className="n">{v.replied}</td>
                    <td className="n">{v.won}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Panel>

      {unknownSends.length > 0 && (
        <Panel
          title="結果不明の送信の照合"
          note="送信後に受付の有無を確認できていないものです。自動再送はしません。受付の有無を人が確認し、④営業プロセスの送信状態を更新します。"
        >
          <table className="tbl">
            <thead>
              <tr>
                <th>企業</th>
                <th className="w-28">送信日</th>
                <th className="w-36">窓口判定</th>
                <th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {unknownSends.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Mask>{l.company || "無題"}</Mask>
                  </td>
                  <td className="num text-[12px]">{l.sentAt ? l.sentAt.slice(0, 10) : "—"}</td>
                  <td className="text-[12px] text-paper-dim">
                    {l.contactFit === "accepted"
                      ? "受付明示あり"
                      : l.contactFit === "prohibited"
                        ? "禁止・用途不一致"
                        : l.contactFit === "unknown"
                          ? "不明"
                          : "未設定"}
                  </td>
                  <td>
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        void mutate(
                          (s) => {
                            s.currentLeadId = l.id;
                            s.currentLeadTab = "process";
                          },
                          ["meta:app"],
                        )
                      }
                    >
                      ④で照合する
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {monthly.length > 0 && (
        <Panel title="月ごとの推移" note="直近12ヶ月。棒がリードの登録数、点が受注数です。">
          <div className="overflow-x-auto">
            <table className="tbl min-w-[520px]">
              <thead>
                <tr>
                  <th className="w-24">月</th>
                  <th>登録</th>
                  <th className="w-16">件数</th>
                  <th className="w-16">受注</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map(([ym, v]) => {
                  const max = Math.max(...monthly.map(([, x]) => x.created));
                  return (
                    <tr key={ym}>
                      <td className="num">{ym}</td>
                      <td>
                        <div className="h-3.5 w-full overflow-hidden rounded-sm bg-ink-700">
                          <div
                            className="h-full"
                            style={{
                              width: `${(v.created / Math.max(1, max)) * 100}%`,
                              background: "#0e7490",
                            }}
                          />
                        </div>
                      </td>
                      <td className="n">{v.created}</td>
                      <td className="n">
                        {v.won > 0 ? <Badge color="#4A7C59">{v.won}</Badge> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
