export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value)
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  throw new Error("Unsupported signed value");
}
export async function operationHash(value: unknown) {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(([k]) => k !== "authorization" && k !== "proof"),
        )
      : value;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(payload)));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function signingMessage(input: {
  id: string;
  userId: string;
  sessionId: string;
  payloadHash: string;
  expiresAtMs: number;
}) {
  return canonical({ domain: "cockpit-write-v1", action: "sync:push", ...input });
}
