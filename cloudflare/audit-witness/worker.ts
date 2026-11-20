/// <reference types="@cloudflare/workers-types" />
/// <reference path="./env.d.ts" />
type Head = { seq: number; hash: string };
export default {
  async fetch(request: Request, env: WitnessEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/head") {
      const uid = url.searchParams.get("user");
      if (!uid || uid.length > 255) return new Response(null, { status: 400 });
      const head = await env.DB.prepare(
        "SELECT seq,hash FROM checkpoint WHERE user_id=? ORDER BY seq DESC LIMIT 1",
      )
        .bind(uid)
        .first<Head>();
      return Response.json(head ?? { seq: 0, hash: "GENESIS" });
    }
    if (request.method !== "POST" || url.pathname !== "/checkpoint")
      return new Response(null, { status: 405 });
    if (!request.body) return new Response(null, { status: 400 });
    const reader = request.body.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return new Response(null, { status: 400 });
    }
    const { userId, seq, hash, previousSeq, previousHash } = body ?? {};
    if (
      typeof userId !== "string" ||
      !userId ||
      userId.length > 255 ||
      !Number.isSafeInteger(seq) ||
      !Number.isSafeInteger(previousSeq) ||
      previousSeq < 0 ||
      seq <= previousSeq ||
      !/^[0-9a-f]{64}$/.test(hash) ||
      !(previousHash === "GENESIS" || /^[0-9a-f]{64}$/.test(previousHash))
    )
      return new Response(null, { status: 400 });
    await env.DB.prepare(
      `INSERT INTO checkpoint(user_id,seq,hash,received_at) SELECT ?,?,?,? WHERE COALESCE((SELECT seq FROM checkpoint WHERE user_id=? ORDER BY seq DESC LIMIT 1),0)=? AND COALESCE((SELECT hash FROM checkpoint WHERE user_id=? ORDER BY seq DESC LIMIT 1),'GENESIS')=? ON CONFLICT(user_id,seq) DO NOTHING`,
    )
      .bind(userId, seq, hash, Date.now(), userId, previousSeq, userId, previousHash)
      .run();
    const head = await env.DB.prepare(
      "SELECT seq,hash FROM checkpoint WHERE user_id=? ORDER BY seq DESC LIMIT 1",
    )
      .bind(userId)
      .first<Head>();
    return new Response(null, { status: head?.seq === seq && head?.hash === hash ? 200 : 409 });
  },
};
