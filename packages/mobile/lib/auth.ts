import { createAuthClient } from "better-auth/react";
import { managedAuthExpoClient } from "@runablehq/managed-auth/native";
import Constants from "expo-constants";

// プラットフォームが管理する値。expo.extra と expo.scheme は触らない。
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

export const authClient = createAuthClient({
  baseURL: extra.apiUrl ?? process.env.EXPO_PUBLIC_API_URL,
  basePath: "/api/auth",
  plugins: [
    managedAuthExpoClient({
      applicationId: extra.applicationId,
      issuer: extra.runableAuthIssuer,
    }),
  ],
});
