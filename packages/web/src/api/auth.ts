import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";
import { runableManagedAuth } from "@runablehq/managed-auth/server";
import { db } from "./database";
import { isOwnerEmail } from "./owner";
import { allowedOrigins } from "./origins";

export const auth = betterAuth({
  basePath: "/api/auth",
  baseURL: process.env.WEBSITE_URL,
  database: drizzleAdapter(db, { provider: "sqlite" }),
  // メールとパスワードでの新規登録は塞ぐ（この操作卓は本人専用）。
  // 許可メールでも新規作成させない。既存アカウントのサインインだけ通す。
  emailAndPassword: { enabled: true, disableSignUp: true },
  secret: process.env.BETTER_AUTH_SECRET,
  // 受け付ける相手先は名簿で決める（名乗ってきた先をそのまま許す形をやめた）。
  trustedOrigins: [...allowedOrigins(), "runable-consult-rjau47t://"],
  // 同じ相手からの連続した呼び出しに上限を設ける。
  // とくにサインインは、合言葉の当てずっぽうを繰り返せないよう厳しくする。
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 300, max: 8 },
      "/sign-up/email": { window: 300, max: 5 },
      "/forget-password": { window: 600, max: 3 },
      "/reset-password": { window: 600, max: 5 },
    },
  },
  advanced: {
    // 別のサイトから開かれた時に、こちらの資格情報を勝手に添えられないようにする。
    // サインインの戻り先（別サイトからの遷移）でも合言葉の受け渡しが要るため、
    // 完全に断つ Strict ではなく Lax を保つ。
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    },
  },
  databaseHooks: {
    user: {
      create: {
        // 本人のメールアドレス以外は、利用者として登録させない。
        // ここで断るので、他人のGoogleアカウントでは金庫が作られない。
        before: async (user) => {
          if (!isOwnerEmail(user.email)) {
            throw new APIError("FORBIDDEN", {
              message: "この操作卓は本人専用です。",
            });
          }
          return { data: user };
        },
      },
    },
  },
  plugins: [
    ...runableManagedAuth({
      applicationId: process.env.APPLICATION_ID!,
      issuer: process.env.VITE_RUNABLE_AUTH_ISSUER!,
    }),
    expo(),
  ],
});
