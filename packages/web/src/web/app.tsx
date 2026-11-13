import { Route, Switch } from "wouter";
import Index from "./pages/index";
import { Provider } from "./components/provider";
import { DocViewerModal } from "./components/doc-viewer-modal";


import { AutomaticBackupRunner } from "./components/automatic-backup";

function App() {
  return (
    <Provider>
      <AutomaticBackupRunner />
      <Switch>
        <Route path="/" component={Index} />
      </Switch>
      {/* 書類ビューアはルートに1つ。タブの再マウントで消えないようにする */}
      <DocViewerModal />
    </Provider>
  );
}

export default App;
