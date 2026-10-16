/**
 * 通信の受け付け元（オリジン）の許可名簿。
 *
 * これまでは「相手が名乗ってきたオリジンをそのまま許す」形だったため、
 * 見知らぬサイトからでも、こちらの利用者の資格情報を伴った通信が通ってしまった。
 * ここで許す先を先に決めておき、名簿にないオリジンからの保護手続きは断る。
 *
 * 追加したい先がある場合は、直下の .env に ALLOWED_ORIGINS を並べる（カンマ区切り）。
 */

/** 開発中に使う手元の窓口 */
const LOCAL = [
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "http://localhost:4300",
  "http://127.0.0.1:4300",
  "http://localhost:4400",
  "http://127.0.0.1:4400",
  "http://localhost:8081",
];

function normalize(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

/** 許可するオリジンの一覧 */
export function allowedOrigins(): string[] {
  const list = new Set<string>();
  if (process.env.NODE_ENV !== "production") for (const l of LOCAL) list.add(l);

  const site = normalize(process.env.WEBSITE_URL ?? "");
  if (site) list.add(site);

  for (const raw of (process.env.ALLOWED_ORIGINS ?? "").split(",")) {
    const o = normalize(raw);
    if (o) list.add(o);
  }
  return [...list];
}

/**
 * このオリジンからの通信を受け付けてよいか。
 *
 * ・Origin が付いていない場合は許す（同じサイト内の移動や、
 *   ブラウザ以外からの呼び出しでは付かないため）。
 * ・アプリ内（スマートフォン・卓上）からの呼び出しも許す。
 */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;
  if (origin === "null") return false;
  if (origin === "runable-consult-rjau47t://") return true; // exact native client origin
  return allowedOrigins().includes(origin);
}
