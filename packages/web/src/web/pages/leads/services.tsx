/** リード⑤ サービス台帳 — 提供可能サービスの正本と、連絡停止リスト */
import { useVault } from "../../hooks/use-vault";
import {
  Area,
  Badge,
  ConfirmButton,
  Empty,
  Field,
  Note,
  Panel,
  Sec,
  Select,
} from "../../components/kit";
import { Mask } from "../../components/mask";

/** サービス台帳の自由記述欄のキー（いずれも文字列フィールド） */
type ServiceTextKey =
  | "targetWork"
  | "deliverables"
  | "technologies"
  | "unavailConditions"
  | "requiredMaterials"
  | "standardProcess"
  | "effortConditions"
  | "revisionScope"
  | "maintenanceScope"
  | "pricingInputs";

/** サービス台帳の自由記述欄（[キー, ラベル, 説明]） */
const TEXT_FIELDS: [ServiceTextKey, string, string][] = [
  ["targetWork", "対象業務", "どの業務を対象にするか"],
  ["deliverables", "成果物", "納めるもの（資料・設定・手順書など）"],
  ["technologies", "使用技術", "使う道具・方式。使わないものも書くと誤解が減ります"],
  ["unavailConditions", "対応不能条件", "この条件に合う仕事は受けない、という線引き"],
  ["requiredMaterials", "必要資料", "開始前に相手から受け取るもの"],
  ["standardProcess", "標準工程", "いつもの進め方の順番"],
  ["effortConditions", "工数条件", "かかる時間が変わる条件（件数・資料の状態など）"],
  ["revisionScope", "修正範囲", "修正を受ける回数・範囲の上限"],
  ["maintenanceScope", "保守範囲", "納品後に面倒を見る範囲と期間"],
  ["pricingInputs", "料金計算への入力項目", "案件④価格の料金式に渡す入力（例：対象件数・修正回数）"],
];

export function LeadServices() {
  const { state, mutate } = useVault();
  if (!state) return null;

  const services = state.services ?? [];
  const stopped = state.leads.filter((l) => l.contactStop?.stopped);
  // 連絡停止は企業単位。同じ企業名の重複は1行にまとめる
  const stoppedCompanies = [...new Set(stopped.map((l) => l.company).filter(Boolean))];
  const unconfirmed = services.filter((s) => s.capability !== "confirmed").length;

  function add() {
    void mutate(
      (s) => {
        if (!Array.isArray(s.services)) s.services = [];
        s.services.push({
          id: "SV" + Date.now().toString(36),
          createdAt: new Date().toISOString(),
          name: "",
          code: "",
          targetWork: "",
          deliverables: "",
          technologies: "",
          unavailConditions: "",
          requiredMaterials: "",
          standardProcess: "",
          effortConditions: "",
          revisionScope: "",
          maintenanceScope: "",
          sampleUrl: "",
          capability: "",
          pricingInputs: "",
        });
      },
      ["meta:app"],
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        title="サービス台帳"
        note="提供できるサービスの正本です。未登録または提供能力が未確認の作業を「対応可能」と約束しません。"
        right={
          <button className="btn btn-primary btn-sm" onClick={add}>
            + サービス
          </button>
        }
      >
        {services.length > 0 && unconfirmed > 0 && (
          <div className="mb-3">
            <Note tone="warn">
              提供能力が「確認済み」でないサービスが {unconfirmed}{" "}
              件あります。提案文面に書く前に、対応できることを本人が確認します。
            </Note>
          </div>
        )}
        {services.length === 0 ? (
          <Empty>
            まだサービスが登録されていません。提供できる仕事の範囲・成果物・条件をここに登録します。
          </Empty>
        ) : (
          <div className="space-y-3">
            {services.map((sv, i) => (
              <div key={sv.id} className="rounded-sm border border-line bg-ink-850 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[220px] flex-1">
                    <Field
                      label="サービス名"
                      value={sv.name}
                      onChange={(v) =>
                        void mutate((s) => void (s.services![i].name = v), ["meta:app"])
                      }
                    />
                  </div>
                  <div className="w-[160px]">
                    <Field
                      label="サービスID"
                      value={sv.code}
                      onChange={(v) =>
                        void mutate((s) => void (s.services![i].code = v), ["meta:app"])
                      }
                    />
                  </div>
                  <div className="w-[190px]">
                    <Select
                      label="提供能力の確認状況"
                      value={sv.capability}
                      onChange={(v) =>
                        void mutate(
                          (s) =>
                            void (s.services![i].capability = v as typeof sv.capability),
                          ["meta:app"],
                        )
                      }
                      options={[
                        ["", "未設定"],
                        ["confirmed", "確認済み"],
                        ["unconfirmed", "未確認"],
                      ]}
                    />
                  </div>
                  <ConfirmButton
                    label="削除"
                    onConfirm={() => void mutate((s) => void s.services!.splice(i, 1), ["meta:app"])}
                  />
                </div>
                <div className="mt-2">
                  <Field
                    label="見本URL"
                    value={sv.sampleUrl}
                    onChange={(v) =>
                      void mutate((s) => void (s.services![i].sampleUrl = v), ["meta:app"])
                    }
                  />
                  <p className="mt-1 text-[11px] leading-relaxed text-paper-faint">
                    実在と動作を確認したURLだけを入れます。勝手にURLを作りません。
                  </p>
                </div>
                <div className="mt-3 space-y-3">
                  {TEXT_FIELDS.map(([k, label, hint]) => (
                    <Area
                      key={k}
                      label={label}
                      value={sv[k]}
                      rows={2}
                      onChange={(v) =>
                        void mutate((s) => void (s.services![i][k] = v), ["meta:app"])
                      }
                      hint={hint}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 border-t border-line pt-3">
          <Note tone="info">
            料金の計算は案件④価格の既存の料金式を使います。営業側に別の料金式は作りません。条件が足りず計算できないときは金額を補完せず、「算出保留」として確認事項を示します。
          </Note>
        </div>
      </Panel>

      <Panel
        title="連絡停止リスト"
        note="拒否・停止要請を受けた企業です。企業単位で扱い、同じ企業名の全リードに継承されます。"
      >
        {stoppedCompanies.length === 0 ? (
          <Empty>連絡停止の記録はありません。</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>企業</th>
                <th>停止の理由</th>
                <th className="w-28">記録日</th>
                <th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {stoppedCompanies.map((company) => {
                const rec = stopped.find((l) => l.company === company);
                return (
                  <tr key={company}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Mask>{company}</Mask>
                        <Badge color="#B85C38">連絡停止</Badge>
                      </div>
                    </td>
                    <td className="text-[12px] text-paper-dim">
                      {rec?.contactStop?.reason || "—"}
                    </td>
                    <td className="num text-[12px]">{rec?.contactStop?.at || "—"}</td>
                    <td>
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          void mutate(
                            (s) => {
                              s.currentLeadId = rec?.id ?? null;
                              s.currentLeadTab = "process";
                            },
                            ["meta:app"],
                          )
                        }
                      >
                        ④で確認する
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-3">
          <Sec>運用の約束</Sec>
          <p className="text-[12px] leading-relaxed text-paper-dim">
            連絡停止中の企業には、別案件からも連絡しません。解除するときは④営業プロセスの「出典と窓口」で根拠を確認してから更新します。
          </p>
        </div>
      </Panel>
    </div>
  );
}
