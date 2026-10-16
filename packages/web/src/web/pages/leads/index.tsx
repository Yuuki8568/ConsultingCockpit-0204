/** リードモードの容れ物。4タブを切り替える。 */
import { useVault } from "../../hooks/use-vault";
import { Tabs } from "../../components/kit";
import type { LeadTab } from "../../domain/types";
import { LeadGenerate } from "./generate";
import { LeadList } from "./list";
import { LeadDashboard } from "./dashboard";
import { LeadProcess } from "./process";
import { LeadServices } from "./services";

const TABS: { id: LeadTab; label: string }[] = [
  { id: "generate", label: "① 追加・文面" },
  { id: "list", label: "② 一覧" },
  { id: "dashboard", label: "③ ダッシュボード" },
  { id: "process", label: "④ 営業プロセス" },
  { id: "services", label: "⑤ サービス台帳" },
];

export function LeadsPage() {
  const { state, mutate } = useVault();
  if (!state) return null;
  const active = state.currentLeadTab;

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-display text-[22px] font-semibold text-paper">リード管理</h1>
        <p className="mt-1 text-[12px] text-paper-dim">
          <span className="num">{state.leads.length}</span> 件登録 /{" "}
          <span className="num">{state.leads.filter((l) => l.convertedCaseId).length}</span>{" "}
          件が案件化
        </p>
      </div>

      <Tabs
        tabs={TABS}
        active={active}
        onChange={(t) =>
          void mutate(
            (s) => {
              s.currentLeadTab = t;
            },
            ["meta:app"],
          )
        }
      />

      {active === "generate" && <LeadGenerate />}
      {active === "list" && <LeadList />}
      {active === "dashboard" && <LeadDashboard />}
      {active === "process" && <LeadProcess />}
      {active === "services" && <LeadServices />}
    </div>
  );
}
