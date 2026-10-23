/** ⑦月次報告 — 月次レポート・ROI推計・成果サマリ1枚の出力 */
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import {
  Area,
  ConfirmButton,
  CopyButton,
  Empty,
  Grid,
  Note,
  NumField,
  Panel,
  Stat,
} from "../../components/kit";
import { Mask } from "../../components/mask";
import { buildMonthlySummaryText, calculateROI } from "../../domain/logic/case";
import { generateDocNo } from "../../domain/logic/docs";
import { formatYen, legacyNetToGross } from "../../domain/logic/pricing";
import { safeFileName } from "../../domain/logic/util";
import { downloadWord } from "../../lib/export/word";

export function CaseReport() {
  const { c, patch } = useCurrentCase();
  const { state, audit } = useVault();
  if (!c || !state) return null;

  const reports = c.reports ?? [];
  const summary = buildMonthlySummaryText(c, state);
  const supportMonthlyFee = legacyNetToGross(c.support?.contract.monthlyFee || 0);

  function addReport() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const last = reports[reports.length - 1];
    // 支払の既定値: 前月分 → ⑧継続サポートの月額 → 0（未設定）。いずれも手で直せる
    const feeDefault = last?.consultFeeTaxBasis === "gross" ? last.consultFee : supportMonthlyFee;
    void patch((x) =>
      x.reports.push({
        id: "R" + Date.now().toString(36),
        month,
        highlights: "",
        // 前月の前提を引き継ぐ（毎回入れ直さずに済む）
        reductionMin: last?.reductionMin ?? 0,
        hourlyRate: last?.hourlyRate ?? 3000,
        casesPerMonth: last?.casesPerMonth ?? 0,
        consultFee: feeDefault,
        consultFeeTaxBasis: "gross",
        issues: "",
        next: "",
        m1: "",
        m2: "",
        m3: "",
        m4: "",
        unimplemented: "",
        timeFour: { selfMin: 0, aiMin: 0, waitMin: 0, clientMin: 0 },
        settlement: {
          providedAt: "",
          receivedAt: "",
          confirmDue: "",
          billedAt: "",
          dueDate: "",
          paidAt: "",
          objection: "",
          refundNote: "",
        },
        reflection: {
          hesitated: "",
          preDiscovery: "",
          nextChecks: "",
          unnecessaryRecords: "",
          burden: "",
          reuse: "",
        },
      }),
    );
  }

  function exportSummary() {
    if (!c || !state) return;
    const docNo = generateDocNo("summary1page", state);
    const company = c.settings.companyName || "無題";
    const now = new Date();
    const ym = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    downloadWord({
      title: `成果サマリ1枚（${ym}）`,
      docNo,
      body: summary,
      fileName: `${safeFileName(company)}_成果サマリ_${docNo}.doc`,
    });
    void patch((x) =>
      x.generatedDocs.push({
        id: "D" + Date.now().toString(36),
        docType: "summary1page",
        docNo,
        issuedAt: now.toISOString().slice(0, 10),
        content: summary,
        status: "draft",
      }),
    );
    audit("summary1page_generate", { docNo });
  }

  return (
    <div className="space-y-4">
      <Panel
        title="月次レポート"
        note="削減時間と時給から、月あたりいくら分に相当するかを出します。"
        right={
          <button className="btn btn-primary btn-sm" onClick={addReport}>
            + 今月分を追加
          </button>
        }
      >
        {reports.length === 0 ? (
          <Empty>まだありません。伴走が始まったら、月ごとに1件足していきます。</Empty>
        ) : (
          <div className="space-y-4">
            {reports
              .slice()
              .reverse()
              .map((r) => {
                const idx = reports.findIndex((z) => z.id === r.id);
                const roi = calculateROI(
                  r.reductionMin,
                  r.hourlyRate,
                  r.casesPerMonth,
                  r.consultFee,
                );
                return (
                  <div key={r.id} className="rounded-sm border border-line bg-ink-850 p-3.5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <input
                        type="month"
                        className="field num w-[150px] py-1"
                        value={r.month}
                        onChange={(e) =>
                          void patch((x) => void (x.reports[idx].month = e.target.value))
                        }
                      />
                      <ConfirmButton
                        label="この月を削除"
                        onConfirm={() => void patch((x) => x.reports.splice(idx, 1))}
                      />
                    </div>

                    <Grid cols={4}>
                      <NumField
                        label="1件あたり削減"
                        value={r.reductionMin}
                        onChange={(v) => void patch((x) => void (x.reports[idx].reductionMin = v))}
                        suffix="分"
                      />
                      <NumField
                        label="対象件数"
                        value={r.casesPerMonth}
                        onChange={(v) => void patch((x) => void (x.reports[idx].casesPerMonth = v))}
                        suffix="件/月"
                      />
                      <NumField
                        label="時間の価値"
                        value={r.hourlyRate}
                        onChange={(v) => void patch((x) => void (x.reports[idx].hourlyRate = v))}
                        suffix="円/時"
                        step={100}
                        hint="クライアント側の人件費で置きます。"
                      />
                      <NumField
                        label={r.consultFeeTaxBasis === "gross" ? "こちらへの支払（税込）" : "保存額（税区分未確認）"}
                        value={r.consultFee}
                        onChange={(v) => void patch((x) => { x.reports[idx].consultFee = v; x.reports[idx].consultFeeTaxBasis = "gross"; })}
                        suffix="円/月"
                        hint="入力し直すと税込額として保存します。旧保存額は自動換算しません。"
                        step={10000}
                      />
                    </Grid>

                    <div className="mt-3">
                      <Grid cols={4}>
                        <Stat
                          label="削減工数"
                          value={`${roi.hoursPerMonth} 時間`}
                          sub={`${roi.minPerMonth.toLocaleString("ja-JP")} 分/月`}
                        />
                        <Stat
                          label="金額換算（推計）"
                          value={<Mask>¥{formatYen(roi.monthlySaved)}</Mask>}
                          sub="月あたり"
                        />
                        <Stat
                          label="年換算（推計）"
                          value={<Mask>¥{formatYen(roi.annualSaved)}</Mask>}
                        />
                        <Stat
                          label="支払に対する比率"
                          value={r.consultFeeTaxBasis === "gross" && r.consultFee > 0 ? `${roi.roi}%` : "—"}
                          color={roi.roi >= 100 ? "#4A7C59" : roi.roi > 0 ? "#C9A961" : undefined}
                        />
                      </Grid>
                    </div>

                    <div className="mt-3 space-y-3">
                      <Area
                        label="今月の要点（3行で）"
                        value={r.highlights}
                        rows={3}
                        onChange={(v) => void patch((x) => void (x.reports[idx].highlights = v))}
                        hint="この欄が成果サマリ1枚の冒頭に入ります。"
                      />
                      <Grid cols={2}>
                        <Area
                          label="詰まっていること"
                          value={r.issues}
                          rows={3}
                          onChange={(v) => void patch((x) => void (x.reports[idx].issues = v))}
                        />
                        <Area
                          label="来月やること"
                          value={r.next}
                          rows={3}
                          onChange={(v) => void patch((x) => void (x.reports[idx].next = v))}
                        />
                      </Grid>

                      <div className="rounded-sm border border-line bg-ink-900 p-3">
                        <div className="mb-2 text-[12px] font-medium text-paper">
                          月次成果物 M1〜M4
                        </div>
                        <div className="space-y-2">
                          <Area
                            label="M1 照合記録（対象全体・例外）"
                            value={r.m1 ?? ""}
                            rows={2}
                            onChange={(v) => void patch((x) => void (x.reports[idx].m1 = v))}
                            hint="対象期間・版・件数、未一致・対象外・未確認。未処理を誰がいつ確認するか。"
                          />
                          <Area
                            label="M2 試験記録（変更後も正しく動くか）"
                            value={r.m2 ?? ""}
                            rows={2}
                            onChange={(v) => void patch((x) => void (x.reports[idx].m2 = v))}
                            hint="試験範囲、失敗例、実結果、利用判断の根拠。"
                          />
                          <Area
                            label="M3 権限・依存先・変更影響の記録"
                            value={r.m3 ?? ""}
                            rows={2}
                            onChange={(v) => void patch((x) => void (x.reports[idx].m3 = v))}
                            hint="権限、変更の該当性、期限、停止要否。"
                          />
                          <Area
                            label="M4 月次判断・引継ぎ更新"
                            value={r.m4 ?? ""}
                            rows={2}
                            onChange={(v) => void patch((x) => void (x.reports[idx].m4 = v))}
                            hint="判断内容、担当、期限、資料版、次月方針。"
                          />
                        </div>
                      </div>

                      <div className="rounded-sm border border-line bg-ink-900 p-3">
                        <div className="mb-2 text-[12px] font-medium text-paper">
                          時間の4区分（この月）
                        </div>
                        <Grid cols={4}>
                          <NumField
                            label="本人の実働"
                            value={r.timeFour?.selfMin ?? 0}
                            onChange={(v) =>
                              void patch((x) => void (x.reports[idx].timeFour.selfMin = v))
                            }
                            suffix="分"
                          />
                          <NumField
                            label="AIの稼働"
                            value={r.timeFour?.aiMin ?? 0}
                            onChange={(v) =>
                              void patch((x) => void (x.reports[idx].timeFour.aiMin = v))
                            }
                            suffix="分"
                          />
                          <NumField
                            label="待ち時間"
                            value={r.timeFour?.waitMin ?? 0}
                            onChange={(v) =>
                              void patch((x) => void (x.reports[idx].timeFour.waitMin = v))
                            }
                            suffix="分"
                          />
                          <NumField
                            label="顧客の実働"
                            value={r.timeFour?.clientMin ?? 0}
                            onChange={(v) =>
                              void patch((x) => void (x.reports[idx].timeFour.clientMin = v))
                            }
                            suffix="分"
                          />
                        </Grid>
                        <p className="mt-2 text-[11px] leading-relaxed text-paper-faint">
                          4区分は足し合わせず、別々に記録します。AIの稼働時間を本人の工数に含めません。
                        </p>
                      </div>

                      <div className="rounded-sm border border-line bg-ink-900 p-3">
                        <div className="mb-2 text-[12px] font-medium text-paper">
                          給付と精算の分離
                        </div>
                        <Grid cols={3}>
                          <div>
                            <label className="mb-1 block text-[11px] text-paper-faint">提供日</label>
                            <input
                              type="date"
                              className="field num py-1"
                              value={r.settlement?.providedAt ?? ""}
                              onChange={(e) =>
                                void patch((x) => void (x.reports[idx].settlement.providedAt = e.target.value))
                              }
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-paper-faint">受領日</label>
                            <input
                              type="date"
                              className="field num py-1"
                              value={r.settlement?.receivedAt ?? ""}
                              onChange={(e) =>
                                void patch((x) => void (x.reports[idx].settlement.receivedAt = e.target.value))
                              }
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-paper-faint">確認期限</label>
                            <input
                              type="date"
                              className="field num py-1"
                              value={r.settlement?.confirmDue ?? ""}
                              onChange={(e) =>
                                void patch((x) => void (x.reports[idx].settlement.confirmDue = e.target.value))
                              }
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-paper-faint">請求日</label>
                            <input
                              type="date"
                              className="field num py-1"
                              value={r.settlement?.billedAt ?? ""}
                              onChange={(e) =>
                                void patch((x) => void (x.reports[idx].settlement.billedAt = e.target.value))
                              }
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-paper-faint">支払期日</label>
                            <input
                              type="date"
                              className="field num py-1"
                              value={r.settlement?.dueDate ?? ""}
                              onChange={(e) =>
                                void patch((x) => void (x.reports[idx].settlement.dueDate = e.target.value))
                              }
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-paper-faint">入金日</label>
                            <input
                              type="date"
                              className="field num py-1"
                              value={r.settlement?.paidAt ?? ""}
                              onChange={(e) =>
                                void patch((x) => void (x.reports[idx].settlement.paidAt = e.target.value))
                              }
                            />
                          </div>
                        </Grid>
                        <div className="mt-2 space-y-2">
                          <Area
                            label="異議・確認中のこと"
                            value={r.settlement?.objection ?? ""}
                            rows={2}
                            onChange={(v) =>
                              void patch((x) => void (x.reports[idx].settlement.objection = v))
                            }
                          />
                          <Area
                            label="返金・減額の記録"
                            value={r.settlement?.refundNote ?? ""}
                            rows={2}
                            onChange={(v) =>
                              void patch((x) => void (x.reports[idx].settlement.refundNote = v))
                            }
                          />
                        </div>
                      </div>

                      <Area
                        label="未実施・限定実施・未確認の明示"
                        value={r.unimplemented ?? ""}
                        rows={2}
                        onChange={(v) => void patch((x) => void (x.reports[idx].unimplemented = v))}
                        hint="やらなかったこと・一部だけやったこと・確認できなかったことを隠さず書きます。空欄を「問題なし」と読み替えないための欄です。"
                      />

                      <div className="rounded-sm border border-line bg-ink-900 p-3">
                        <div className="mb-2 text-[12px] font-medium text-paper">
                          今月の振り返り
                        </div>
                        <div className="space-y-2">
                          <Area
                            label="確認に迷った箇所"
                            value={r.reflection?.hesitated ?? ""}
                            rows={2}
                            onChange={(v) =>
                              void patch((x) => {
                                const rf = x.reports[idx].reflection;
                                if (rf) rf.hesitated = v;
                              })
                            }
                          />
                          <Grid cols={2}>
                            <Area
                              label="事前に発見できたか"
                              value={r.reflection?.preDiscovery ?? ""}
                              rows={2}
                              onChange={(v) =>
                                void patch((x) => {
                                  const rf = x.reports[idx].reflection;
                                  if (rf) rf.preDiscovery = v;
                                })
                              }
                            />
                            <Area
                              label="次回追加する確認"
                              value={r.reflection?.nextChecks ?? ""}
                              rows={2}
                              onChange={(v) =>
                                void patch((x) => {
                                  const rf = x.reports[idx].reflection;
                                  if (rf) rf.nextChecks = v;
                                })
                              }
                            />
                          </Grid>
                          <Grid cols={3}>
                            <Area
                              label="不要だった記録"
                              value={r.reflection?.unnecessaryRecords ?? ""}
                              rows={2}
                              onChange={(v) =>
                                void patch((x) => {
                                  const rf = x.reports[idx].reflection;
                                  if (rf) rf.unnecessaryRecords = v;
                                })
                              }
                            />
                            <Area
                              label="記録の負担増"
                              value={r.reflection?.burden ?? ""}
                              rows={2}
                              onChange={(v) =>
                                void patch((x) => {
                                  const rf = x.reports[idx].reflection;
                                  if (rf) rf.burden = v;
                                })
                              }
                            />
                            <Area
                              label="再利用可否"
                              value={r.reflection?.reuse ?? ""}
                              rows={2}
                              onChange={(v) =>
                                void patch((x) => {
                                  const rf = x.reports[idx].reflection;
                                  if (rf) rf.reuse = v;
                                })
                              }
                              hint="⑥の知見台帳へ候補として登録するか"
                            />
                          </Grid>
                          <p className="text-[11px] leading-relaxed text-paper-faint">
                            すべての例外を知見化する必要はありません。件数のノルマは設けません。
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
        <div className="mt-3">
          <Note tone="warn">
            金額換算は推計です。「時間の価値」の置き方で大きく動くので、
            クライアントに出すときは前提の数字を必ず並記してください。成果は保証しません。
          </Note>
        </div>
      </Panel>

      <Panel
        title="成果サマリ1枚"
        note="⑥のタスク・成熟度・直近の月次レポートから、A4一枚の報告文を組み立てます。"
        right={
          <>
            <CopyButton text={summary} label="コピー" />
            <button className="btn btn-primary btn-sm" onClick={exportSummary}>
              Word で書き出す
            </button>
          </>
        }
      >
        <div className="doc max-h-[440px] overflow-auto text-[13px]">
          <Mask>{summary}</Mask>
        </div>
      </Panel>
    </div>
  );
}
