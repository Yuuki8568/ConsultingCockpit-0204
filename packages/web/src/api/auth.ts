import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, databaseContext } from "./database";
import { isOwnerEmail } from "./owner";
import { allowedOrigins } from "./origins";

export function createAuth() { return betterAuth({
  basePath: "/api/auth",
  baseURL: process.env.WEBSITE_URL,
  database: drizzleAdapter(db, { provider: "sqlite" }),
  // Independent Google OAuth only; verified owners may create their new account.
  emailAndPassword: { enabled: false },
  socialProviders: { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } },
  account: { accountLinking: { enabled: false } },
  secret: process.env.BETTER_AUTH_SECRET,
  session: { expiresIn: 24 * 60 * 60, updateAge: 60 * 60, cookieCache: { enabled: false } },
  // 受け付ける相手先は名簿で決める（名乗ってきた先をそのまま許す形をやめた）。
  trustedOrigins: allowedOrigins(),
  // 同じ相手からの連続した呼び出しに上限を設ける。
  // とくにサインインは、合言葉の当てずっぽうを繰り返せないよう厳しくする。
  rateLimit: {
    storage: "database",
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/social": { window: 300, max: 8 },
      "/sign-up/email": { window: 300, max: 5 },
      "/forget-password": { window: 600, max: 3 },
      "/reset-password": { window: 600, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: true,
    ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
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
          if (!user.emailVerified || !isOwnerEmail(user.email)) {
            throw new APIError("FORBIDDEN", {
              message: "この操作卓は本人専用です。",
            });
          }
          return { data: user };
        },
      },
    },
  },
}); }

// In Workers the instance is scoped to the request, including its DB adapter.
let localAuth: ReturnType<typeof createAuth> | undefined;
export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_target, property) {
    const context = databaseContext.getStore();
    const instance = context
      ? (context.auth ??= createAuth()) as ReturnType<typeof createAuth>
      : (localAuth ??= createAuth());
    const value = Reflect.get(instance, property);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
