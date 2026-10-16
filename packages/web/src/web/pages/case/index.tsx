/** 案件モードの容れ物。10タブを切り替える。 */
import { useMemo, useState } from "react";
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import { Badge, ConfirmButton, Empty, Modal, Note, Panel, Tabs } from "../../components/kit";
import { Mask } from "../../components/mask";
import { computeCaseProgress, sanpoHasConcern } from "../../domain/logic/case";
import { jpDate } from "../../domain/logic/util";
import { exportCaseWord, exportCaseXlsx, printCase } from "../../lib/export/case-export";
import type { CaseTab } from "../../domain/types";
import { CaseSetup } from "./setup";
import { CaseSheet } from "./sheet";
import { CaseFlow } from "./flow";
import { CasePricing } from "./pricing";
import { CaseMemo } from "./memo";
import { CaseExecution } from "./execution";
import { CaseReport } from "./report";
import { CaseSupport } from "./support";
import { CaseLegal } from "./legal";
import { CaseSanpo } from "./sanpo";

const LABELS: Record<CaseTab, string> = {
  setup: "① 案件設定",
  sheet: "② ヒアリング設計",
  flow: "③ 業務フロー分析",
  pricing: "④ 単価設計",
  memo: "⑤ 商談後メモ",
  execution: "⑥ 実行管理",
  report: "⑦ 月次報告",
  support: "⑧ 継続サポート",
  legal: "⑨ 契約・法務",
  sanpo: "⑩ 三方良し",
};

const STAGE_COLOR: Record<string, string> = {
  Defend: "#3B6E8F",
  Extend: "#C9A961",
  Transform: "#4A7C59",
};

export function CasePage({ onNewCase }: { onNewCase: () => void }) {
  const { state, mutate, audit } = useVault();
  const { c } = useCurrentCase();
  // 出力の三区分: 一括出力の前に宛先区分を選ばせる（全文一括出力を既定にしない）
  const [exportKind, setExportKind] = useState<null | "xlsx" | "word" | "print">(null);
  const [exportDest, setExportDest] = useState<"" | "handover" | "internal" | "public">("");

  // フックは早期 return より前に置く
  const progress = useMemo(() => (c ? computeCaseProgress(c) : []), [c]);

  if (!state) return null;

  if (!c) {
    return (
      <Panel title="案件">
        <Empty>
          {state.cases.length === 0 ? (
            <>
              まだ案件がありません。
              <br />
              <button className="btn btn-primary mt-3" onClick={onNewCase}>
                最初の案件を作る
              </button>
            </>
          ) : (
            "左の一覧から案件を選んでください。"
          )}
        </Empty>
      </Panel>
    );
  }

  const doneCount = progress.filter(([, , d]) => d).length;
  const stage = c.maturity.currentStage || c.gartner.stage;

  const tabs = progress.map(([id, , done]) => ({
    id: id as CaseTab,
    label: LABELS[id as CaseTab],
    done,
  }));

  const active = state.currentTab;
  // タブの切り替えは UI 状態だけ。meta:app に限定して、案件・雛形の再暗号化を起こさない
  const setTab = (t: CaseTab) =>
    void mutate(
      (s) => {
        s.currentTab = t;
      },
      ["meta:app"],
    );

  const runExport = () => {
    if (!exportKind || (exportDest !== "handover" && exportDest !== "internal")) return;
    audit("case-export", { kind: exportKind, dest: exportDest, caseId: c.id });
    if (exportKind === "xlsx") void exportCaseXlsx(c, state);
    else if (exportKind === "word") exportCaseWord(c, state);
    else printCase(c, state);
    setExportKind(null);
    setExportDest("");
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display truncate text-[22px] font-semibold text-paper">
            <Mask>{c.settings.companyName || "無題の案件"}</Mask>
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-paper-dim">
            <span className="num">
              進捗 {doneCount}/10
            </span>
            {sanpoHasConcern(c) && <Badge color="#C9A961">三方良し: 懸念あり</Badge>}
            {stage && <Badge color={STAGE_COLOR[stage]}>{stage}</Badge>}
            {c.settings.meetingDate && <span>面談 {c.settings.meetingDate}</span>}
            {c.plan && <Badge>{c.plan}</Badge>}
            <span className="text-paper-faint">作成 {jpDate(c.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn btn-sm" onClick={() => setExportKind("xlsx")}>
            Excel
          </button>
          <button className="btn btn-sm" onClick={() => setExportKind("word")}>
            Word
          </button>
          <button className="btn btn-sm" onClick={() => setExportKind("print")}>
            印刷
          </button>
          <ConfirmButton
          label="この案件を削除"
          confirmLabel="本当に削除（戻せません）"
          onConfirm={() =>
            void mutate((s) => {
              const i = s.cases.findIndex((z) => z.id === c.id);
              if (i >= 0) s.cases.splice(i, 1);
              s.currentCaseId = s.cases[0]?.id ?? null;
            })
          }
        />
        </div>
      </div>

      <Tabs tabs={tabs} active={active} onChange={setTab} />

      {active === "setup" && <CaseSetup />}
      {active === "sheet" && <CaseSheet />}
      {active === "flow" && <CaseFlow />}
      {active === "pricing" && <CasePricing />}
      {active === "memo" && <CaseMemo />}
      {active === "execution" && <CaseExecution />}
      {active === "report" && <CaseReport />}
      {active === "support" && <CaseSupport />}
      {active === "legal" && <CaseLegal />}
      {active === "sanpo" && <CaseSanpo />}

      <Modal
        open={exportKind !== null}
        onClose={() => {
          setExportKind(null);
          setExportDest("");
        }}
        title="出力の区分の確認"
        footer={
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setExportKind(null);
                setExportDest("");
              }}
            >
              やめる
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={exportDest !== "handover" && exportDest !== "internal"}
              onClick={runExport}
            >
              この区分で出力する
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-[12px] leading-relaxed text-paper-dim">
            出力は「顧客引継ぎ」「内部再利用」「公開用見本」の三区分に分け、宛先に応じて許可する内容を決めます。全文一括出力は既定ではありません。出力前に内容のプレビューを確認してください。
          </p>
          {(
            [
              [
                "handover",
                "顧客引継ぎ用",
                "この案件の内容のみを出力します。知見台帳の適用参照など内部限定の情報は含みません。",
              ],
              [
                "internal",
                "内部再利用用",
                "事務所内での再利用のための出力です。外部への持ち出し・公開はしません。",
              ],
              [
                "public",
                "公開用見本",
                "現行の一括出力は案件固有の情報を含むため、公開用見本には使えません。公開承認済みの知見のみ、⑥の知見台帳から個別に取り出してください。",
              ],
            ] as const
          ).map(([v, label, desc]) => (
            <button
              key={v}
              type="button"
              onClick={() => setExportDest(v)}
              className={`w-full rounded-sm border px-3 py-2.5 text-left transition-colors ${
                exportDest === v
                  ? "border-brand/60 bg-brand-soft"
                  : "border-line bg-ink-850 hover:border-line-strong"
              }`}
            >
              <div className="text-[13px] font-medium text-paper">{label}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-paper-faint">{desc}</div>
            </button>
          ))}
          {exportDest === "public" && (
            <Note tone="alert">
              公開用見本としての一括出力はできません。顧客名を消しただけでは安全な情報とみなしません。
            </Note>
          )}
        </div>
      </Modal>
    </div>
  );
}
