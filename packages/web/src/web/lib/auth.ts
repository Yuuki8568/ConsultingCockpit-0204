import { createAuthClient } from "better-auth/react";
// Same-origin HttpOnly session cookies. No Runable token in localStorage.
export const authClient = createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth" });
