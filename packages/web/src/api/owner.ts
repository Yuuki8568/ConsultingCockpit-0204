/**
 * 本人専用の入場制限。
 *
 * 使い方: 直下の .env に OWNER_EMAILS を並べる（カンマ区切り）。
 *   OWNER_EMAILS=info@yuuki-yamashiro-portfolio.com,info@yamashirogyomukaizen.com
 *
 * ここに書いていないメールアドレスは
 *   ・新しく利用者として登録されない（サインインの時点で断る）
 *   ・仮に登録済みでも、API のすべての手続きを断られる
 * ので、他人が金庫を作ることも、中身に触ることもできない。
 */

const FALLBACK = ["info@yuuki-yamashiro-portfolio.com", "info@yamashirogyomukaizen.com"];

/** 許可するメールアドレスの一覧（小文字に揃える） */
export function ownerEmails(): string[] {
  const raw = process.env.OWNER_EMAILS ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : FALLBACK;
}

/** このメールアドレスは本人か */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ownerEmails().includes(email.trim().toLowerCase());
}
