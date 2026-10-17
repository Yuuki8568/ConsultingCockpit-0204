import { Route, Switch } from "wouter";
import Index from "./pages/index";
import { Provider } from "./components/provider";
import { DocViewerModal } from "./components/doc-viewer-modal";


function App() {
  return (
    <Provider>
      <Switch>
        <Route path="/" component={Index} />
      </Switch>
      {/* 書類ビューアはルートに1つ。タブの再マウントで消えないようにする */}
      <DocViewerModal />
    </Provider>
  );
}

export default App;
