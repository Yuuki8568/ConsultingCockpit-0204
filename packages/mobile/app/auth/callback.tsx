import { Redirect } from "expo-router";

// 認証の戻り先。ここが無いと Android で一瞬「該当なし」が出る。
export default function AuthCallback() {
  return <Redirect href="/" />;
}
