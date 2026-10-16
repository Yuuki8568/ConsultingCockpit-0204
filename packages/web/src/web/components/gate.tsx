/**
 * 入口。Googleサインイン → 金庫の作成／解錠 まで。
 * この画面より先には、パスフレーズを入れないと進めない。
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useVault } from "../hooks/use-vault";
import { evaluatePassphraseStrength } from "../domain/logic/util";
import { authClient } from "../lib/auth";
import { SEC_CONFIG, failureCount } from "../lib/security";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-900 px-5 py-10">
      {/* 背景：うっすらとしたグリッドと一点の熱。装飾はここだけに留める */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.28]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #1c1c1c 1px, transparent 1px), linear-gradient(to bottom, #1c1c1c 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at 50% 40%, #000 20%, transparent 78%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-18%] left-1/2 h-[520px] w-[880px] -translate-x-1/2 rounded-full blur-[130px]"
        style={{ background: "radial-gradient(circle, rgba(14,116,144,0.16), transparent 68%)" }}
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 0.8, 0.3, 1] }}
        className="relative w-full max-w-[460px]"
      >
        {children}
      </motion.div>
    </div>
  );
}

function Brand({ sub }: { sub: string }) {
  return (
    <div className="mb-7">
      <div className="mb-3 flex items-center gap-2.5">
        <img src="/logo.png" alt="山代業務改善事務所" className="size-8 shrink-0" />
        <span className="font-mono text-[11px] tracking-[0.22em] text-paper-faint uppercase">
          Consulting Cockpit
        </span>
      </div>
      <h1 className="font-display text-[26px] leading-tight font-semibold text-paper">
        案件も、営業も、書類も
        <br />
        ここ一つで動かす
      </h1>
      <p className="mt-2.5 text-[13px] leading-relaxed text-paper-dim">{sub}</p>
    </div>
  );
}

export function Gate() {
  const { phase, error } = useVault();
  if (phase === "booting") {
    return (
      <Shell>
        <div className="panel">
          <div className="panel-body flex items-center gap-3 text-[13px] text-paper-dim">
            <span className="size-1.5 rounded-full bg-brand pulse-soft" />
            準備しています…
          </div>
        </div>
      </Shell>
    );
  }
  if (phase === "denied") return <Denied />;
  if (phase === "signed-out") return <SignIn />;
  if (phase === "no-vault") return <CreateVault />;
  return <Unlock initialError={error} />;
}

function Denied() {
  const { signOut } = useVault();
  return (
    <Shell>
      <Brand sub="この操作卓は本人専用です。許可されていないアカウントでは中に入れません。" />
      <div className="panel">
        <div className="panel-body">
          <p className="text-[12px] leading-relaxed text-paper-dim">
            サインインしたアカウントは、この操作卓に登録されていません。案件データは一切表示されず、
            書き込みもできません。ご自身のアカウントに切り替えてください。
          </p>
          <button className="btn btn-primary mt-4 w-full py-2.5" onClick={() => void signOut()}>
            サインアウトしてやり直す
          </button>
        </div>
      </div>
    </Shell>
  );
}

function SignIn() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setErr(null);
    const res = await authClient.managedAuth.signIn({ provider: "google" });
    if (res.error && res.error.code !== "POPUP_CLOSED") {
      setErr(res.error.message ?? "サインインできませんでした");
    }
    setBusy(false);
  }

  return (
    <Shell>
      <Brand sub="まずGoogleアカウントで本人確認をします。この段階ではまだ案件データは開きません。" />
      <div className="panel">
        <div className="panel-body">
          <button className="btn btn-primary w-full py-2.5" onClick={go} disabled={busy}>
            {busy ? "サインインの画面を開いています…" : "Googleでサインイン"}
          </button>
          {err && (
            <p className="mt-3 rounded-sm border border-alert/40 bg-alert/10 px-3 py-2 text-[12px] text-alert">
              {err}
            </p>
          )}
          <div className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-paper-faint">
            サインインの次に、この端末で金庫のパスフレーズを入力します。
            パスフレーズは通信もされず保存もされません。案件データはパスフレーズから作った鍵で
            端末の中だけで暗号化してから預けます。
          </div>
        </div>
      </div>
    </Shell>
  );
}

function StrengthBar({ pass }: { pass: string }) {
  if (!pass) return null;
  const { level, label } = evaluatePassphraseStrength(pass);
  const pct = level === "weak" ? 33 : level === "medium" ? 66 : 100;
  const color = level === "weak" ? "#B85C38" : level === "medium" ? "#C9A961" : "#4A7C59";
  return (
    <div className="mt-2">
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-ink-600">
        <div
          className="h-full transition-all duration-200"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <p className="mt-1.5 text-[11px]" style={{ color }}>
        {label}
      </p>
    </div>
  );
}

function CreateVault() {
  const { createVault, busy, error } = useVault();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [ack, setAck] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const mismatch = p2.length > 0 && p1 !== p2;
  const tooShort = p1.length > 0 && p1.length < 10;
  const ready = p1.length >= 10 && p1 === p2 && ack && !busy;

  async function go() {
    setLocalErr(null);
    if (!ready) return;
    try {
      await createVault(p1);
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Shell>
      <Brand sub="金庫のパスフレーズを決めます。これが案件データを開ける唯一の鍵です。" />
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">パスフレーズの設定</span>
          <span className="font-mono text-[11px] text-paper-faint">初回のみ</span>
        </div>
        <div className="panel-body">
          <div className="mb-3.5 rounded-sm border border-warn/35 bg-warn/8 px-3 py-2.5 text-[12px] leading-relaxed text-warn">
            控えを残してください。パスフレーズはどこにも保存されないため、
            忘れると既存の案件データは誰も開けなくなります（こちらでも復元できません）。
          </div>
          <label className="field-label" htmlFor="p1">
            パスフレーズ（10文字以上）
          </label>
          <input
            id="p1"
            type="password"
            className="field"
            value={p1}
            autoComplete="new-password"
            onChange={(e) => setP1(e.target.value)}
            placeholder="覚えやすく、他人に推測されない文にする"
          />
          <StrengthBar pass={p1} />
          {tooShort && <p className="mt-1 text-[11px] text-alert">10文字以上にしてください</p>}

          <label className="field-label mt-3.5" htmlFor="p2">
            確認のためもう一度
          </label>
          <input
            id="p2"
            type="password"
            className="field"
            value={p2}
            autoComplete="new-password"
            onChange={(e) => setP2(e.target.value)}
          />
          {mismatch && <p className="mt-1 text-[11px] text-alert">一致していません</p>}

          <label className="mt-4 flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-paper-dim">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#0e7490]"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            パスフレーズを紛失した場合、案件データを復元できないことを理解しました。
          </label>

          <button className="btn btn-primary mt-4 w-full py-2.5" onClick={go} disabled={!ready}>
            {busy ? "鍵を作っています…" : "金庫を作る"}
          </button>
          {(localErr || error) && (
            <p className="mt-3 rounded-sm border border-alert/40 bg-alert/10 px-3 py-2 text-[12px] text-alert">
              {localErr || error}
            </p>
          )}
          <p className="mt-4 border-t border-line pt-3.5 font-mono text-[11px] leading-relaxed text-paper-faint">
            鍵導出 PBKDF2-SHA256 / {SEC_CONFIG.KDF_ITERATIONS.toLocaleString()} 回 ・ 暗号化
            AES-GCM 256bit
          </p>
        </div>
      </div>
    </Shell>
  );
}

function Unlock({ initialError }: { initialError: string | null }) {
  const { unlock, busy, error, signOut, lockoutSeconds } = useVault();
  const [pass, setPass] = useState("");
  const [tries, setTries] = useState(failureCount());
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTries(failureCount());
  }, [error]);

  // 開いたらすぐ入力できる状態にする
  useEffect(() => {
    passRef.current?.focus();
  }, []);

  const blocked = lockoutSeconds > 0;

  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    if (!pass || busy || blocked) return;
    const ok = await unlock(pass);
    if (ok) setPass("");
    setTries(failureCount());
  }

  const remaining = SEC_CONFIG.MAX_FAILURES - tries;

  return (
    <Shell>
      <Brand sub="金庫のパスフレーズを入力すると案件データを開きます。" />
      <form className="panel" onSubmit={go}>
        <div className="panel-head">
          <span className="panel-title">金庫を開く</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            別のアカウントで入る
          </button>
        </div>
        <div className="panel-body">
          <label className="field-label" htmlFor="pass">
            パスフレーズ
          </label>
          <input
            ref={passRef}
            id="pass"
            type="password"
            className="field"
            value={pass}
            autoComplete="current-password"
            disabled={blocked}
            onChange={(e) => setPass(e.target.value)}
          />
          <button
            className="btn btn-primary mt-3.5 w-full py-2.5"
            type="submit"
            disabled={!pass || busy || blocked}
          >
            {busy ? "鍵を作り直しています…" : "開く"}
          </button>

          {blocked && (
            <p className="mt-3 rounded-sm border border-alert/40 bg-alert/10 px-3 py-2 text-[12px] text-alert">
              試行が続いたため一時的に停止しています。あと{" "}
              <span className="num">{lockoutSeconds}</span> 秒お待ちください。
            </p>
          )}
          {!blocked && (error || initialError) && (
            <p className="mt-3 rounded-sm border border-alert/40 bg-alert/10 px-3 py-2 text-[12px] text-alert">
              {error || initialError}
            </p>
          )}
          {!blocked && tries > 0 && !error && (
            <p className="mt-2 text-[11px] text-warn">
              残り試行回数 <span className="num">{remaining}</span> 回
            </p>
          )}
          <p className="mt-4 border-t border-line pt-3.5 text-[11px] leading-relaxed text-paper-faint">
            {SEC_CONFIG.MAX_FAILURES}回続けて間違えると
            {Math.round(SEC_CONFIG.LOCKOUT_MS / 60000)}分間停止します。
            解錠のたびに鍵を作り直すため、少し時間がかかります。
          </p>
        </div>
      </form>
    </Shell>
  );
}
