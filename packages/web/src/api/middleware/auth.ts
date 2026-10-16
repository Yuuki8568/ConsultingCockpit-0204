import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import { auth } from "../auth";
import { isOwnerEmail } from "../owner";
import { isAllowedOrigin } from "../origins";

/** 任意ログイン。context.user はログイン中ユーザーか null。 */
export const withUser = base.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });
  return next({
    context: { user: session?.user ?? null, session: session?.session ?? null },
  });
});

/**
 * 保護手続き。未ログインは拒否し、context.user は非null。
 * さらに、本人のメールアドレス（.env の OWNER_EMAILS）以外は一律で断る。
 * この操作卓は本人専用のため、他人が入っても何も読めず、何も書けない。
 */
export const authed = base.use(async ({ context, next }) => {
  // 名簿にないサイトから、こちらの利用者の資格情報を伴って呼ばれた場合は断る。
  // 別のサイトに埋め込まれた仕掛けから操作される筋道（いわゆる横断偽装）をふさぐ。
  const origin = context.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    throw new ORPCError("FORBIDDEN", {
      message: "許可されていない接続元です。",
    });
  }
  const session = await auth.api.getSession({ headers: context.headers });
  if (!session) throw new ORPCError("UNAUTHORIZED");
  if (!isOwnerEmail(session.user.email)) {
    throw new ORPCError("FORBIDDEN", {
      message: "この操作卓は本人専用です。許可されたアカウントでサインインしてください。",
    });
  }
  return next({ context: { user: session.user, session: session.session } });
});
