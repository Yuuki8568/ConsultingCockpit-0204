import { useState } from "react";
import { useVault } from "../hooks/use-vault";
import { Gate } from "../components/gate";
import { Shell } from "../components/shell";
import { SettingsModal } from "../components/settings";
import { ActionsHub } from "../components/actions-hub";
import { CasePage } from "./case";
import { LeadsPage } from "./leads";
import { OfficePage } from "./office";
import { makeEmptyCase } from "../domain/logic/state";

function Index() {
  const { phase, state, mutate } = useVault();
  const [settings, setSettings] = useState(false);
  const [actions, setActions] = useState(false);

  if (phase !== "unlocked" || !state) return <Gate />;

  const newCase = () =>
    void mutate((s) => {
      const c = makeEmptyCase("");
      s.cases.unshift(c);
      s.currentCaseId = c.id;
      s.currentMode = "cases";
      s.currentTab = "setup";
    });

  const newLead = () =>
    void mutate((s) => {
      s.currentMode = "leads";
      s.currentLeadTab = "generate";
    });

  return (
    <>
      <Shell
        onOpenSettings={() => setSettings(true)}
        onOpenActions={() => setActions(true)}
        onNewCase={newCase}
        onNewLead={newLead}
      >
        {state.currentMode === "cases" ? (
          <CasePage onNewCase={newCase} />
        ) : state.currentMode === "leads" ? (
          <LeadsPage />
        ) : (
          <OfficePage />
        )}
      </Shell>
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
      <ActionsHub open={actions} onClose={() => setActions(false)} />
    </>
  );
}

export default Index;
