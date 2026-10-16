// 元アプリ v3 から移植：特定電子メール法 対応の署名ブロック
// 受託者プロフィールを引数で受け取る形に変更（グローバル state 依存を排除）
import type { Profile } from "../types";

export function buildComplianceFooter(p: Partial<Profile> | null | undefined): string {
  const prof = p || {};
  const name = prof.name || "山代 悠生";
  const yago = prof.yago || "山代業務改善事務所";
  const url = prof.url || "https://yamashirogyomukaizen.com";
  const addr = prof.address || "（住所未設定：受託者プロフィールで設定してください）";
  const email = prof.email || "（メール未設定：受託者プロフィールで設定してください）";
  return `\n\n―――――――――――――――\n${yago}／${name}\n${addr}\nお問い合わせ：${email}\nポートフォリオ：${url}\n\n※本メールは、過去のお問い合わせ・お名刺交換・公開情報等に基づき個別にお送りしています。\n※今後のご連絡が不要な場合は、お手数ですが本メールへ「配信停止」とご返信ください。以後お送りいたしません。\n―――――――――――――――`;
}
