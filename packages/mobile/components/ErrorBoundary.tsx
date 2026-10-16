// テンプレート管理の __ErrorBoundary をそのまま公開するだけの入口。
// 規約チェックが "../components/ErrorBoundary" からの読み込みを求めるため、
// __ 付きファイルは触らずにここで受け渡す。
export { ErrorBoundary } from "./__ErrorBoundary";
