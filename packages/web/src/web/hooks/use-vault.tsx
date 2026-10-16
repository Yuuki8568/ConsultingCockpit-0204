/**
 * 金庫のライフサイクルを React に載せる層。
 * - Googleログイン済みか
 * - 金庫が作られているか
 * - パスフレーズで解錠されているか
 * - 無操作ロック / マスクモード
 * この4つの状態をここ1か所で持つ。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { makeEmptyVaultState } from "../domain/logic/state";
import type { VaultState } from "../domain/types";
import { client } from "../lib/api";
import { authClient } from "../lib/auth";
import {
  buildVerifier,
  checkVerifier,
  deriveVaultKeys,
  newSalt,
  seal,
} from "../lib/crypto/vault-crypto";
import { docViewer } from "../lib/store/doc-viewer-store";
import {
  SEC_CONFIG,
  deviceLabel,
  isLockedOut,
  lockoutRemainingSec,
  platformGuess,
  recordFailure,
  resetFailures,
  shortUA,
} from "../lib/security";
import { deviceIdFor, vaultStore, type SyncStatus } from "../lib/store/vault-store";
import { ensurePersistentStorage } from "../lib/store/idb";

export type VaultPhase =
  | "booting"
  | "signed-out"
  | "no-vault"
  | "locked"
  | "unlocking"
  | "unlocked"
  /** 許可されていないアカウントでサインインした状態 */
  | "denied";

interface VaultContextValue {
  phase: VaultPhase;
  /** 変更回数。これが変わると中身が書き換わったことを意味する。 */
  revision: number;
  state: VaultState | null;
  sync: SyncStatus;
  masked: boolean;
  lockWarning: boolean;
  secondsToLock: number | null;
  error: string | null;
  busy: boolean;

  createVault: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<boolean>;
  lock: (reason?: "manual" | "auto") => void;
  setMasked: (v: boolean) => void;
  mutate: (fn: (s: VaultState) => void, touched?: string[]) => Promise<void>;
  replaceState: (s: VaultState) => Promise<void>;
  syncNow: () => Promise<void>;
  signOut: () => Promise<void>;
  lockoutSeconds: number;
  audit: (action: string, detail?: unknown) => void;
  /** 録画・録音の保存（暗号化してこの端末の IndexedDB に置く。サーバーには送らない） */
  saveMediaBlob: (
    mediaId: string,
    blob: Blob,
    onProgress?: (doneBytes: number, totalBytes: number) => void,
  ) => Promise<number>;
  readMediaBlob: (mediaId: string, mimeType: string) => Promise<Blob>;
  deleteMediaBlob: (mediaId: string) => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault は VaultProvider の内側で使ってください");
  return ctx;
}

/** 解錠済みを前提にした取り出し。未解錠なら投げる（画面側でガードしてから使う） */
export function useVaultState(): VaultState {
  const { state } = useVault();
  if (!state) throw new Error("金庫が未解錠です");
  return state;
}

/** APIが「本人専用」で断ったかどうか */
function isForbidden(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "FORBIDDEN") return true;
  const status = (e as { status?: unknown } | null)?.status;
  return status === 403;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [phase, setPhase] = useState<VaultPhase>("booting");
  const [state, setState] = useState<VaultState | null>(null);
  // 金庫の中身は現物を書き換える方式なので、参照は変わらない。
  // 変更回数を持たせて、確実に再描画させる。
  const [revision, setRevision] = useState(0);
  const [sync, setSync] = useState<SyncStatus>(vaultStore.getStatus());
  const [masked, setMaskedRaw] = useState(
    () => localStorage.getItem("cockpit.masked") === "1",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockWarning, setLockWarning] = useState(false);
  const [secondsToLock, setSecondsToLock] = useState<number | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(() => lockoutRemainingSec());
  const lastActivityRef = useRef(Date.now());
  const keyRef = useRef<CryptoKey | null>(null);

  // ---- ストアの購読 ----------------------------------------------
  useEffect(() => {
    const un1 = vaultStore.subscribe(() => {
      // 中身は現物を書き換える方式なので、包みだけ作り直して参照を必ず変える。
      // こうしておくと、下流は state だけを見ていれば取りこぼさない。
      const next = vaultStore.getState();
      setState(next ? { ...next } : null);
      setRevision(vaultStore.getRevision());
    });
    const un2 = vaultStore.subscribeStatus(() => setSync({ ...vaultStore.getStatus() }));
    return () => {
      un1();
      un2();
    };
  }, []);

  // ---- 監査ログ（失敗しても操作は止めない） ------------------------
  const audit = useCallback((action: string, detail?: unknown) => {
    void (async () => {
      try {
        let payload: { payloadCiphertext?: string; payloadIv?: string } = {};
        if (detail !== undefined && keyRef.current) {
          const s = await seal(keyRef.current, detail);
          payload = { payloadCiphertext: s.ciphertext, payloadIv: s.iv };
        }
        await client.audit.append({
          action,
          atMs: Date.now(),
          deviceId: deviceIdFor(),
          ...payload,
        });
      } catch {
        /* 監査ログの失敗で業務を止めない */
      }
    })();
  }, []);

  // ---- ログイン状態 → フェーズ判定 --------------------------------
  useEffect(() => {
    if (sessionPending) return;
    if (!session) {
      keyRef.current = null;
      vaultStore.lock();
      setPhase("signed-out");
      return;
    }
    // すでに解錠済みなら、ここで止まる。better-auth は focus / online のたびに
    // セッションを取り直し、そのたびに session 参照が新しくなってこの effect が
    // 再実行される。ここで setPhase("locked") まで進むと、書類を開いている
    // 最中でも予告なく金庫が閉じてしまう（再現: 解錠後に online イベントを
    // 投げるだけでロック画面に戻る）。鍵を持っている間はフェーズを巻き戻さない。
    if (keyRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensurePersistentStorage();
        await client.devices.register({
          id: deviceIdFor(),
          label: deviceLabel(),
          platform: platformGuess(),
          userAgent: shortUA(),
        });
        const st = await client.vault.status();
        if (cancelled) return;
        setPhase(st.exists ? "locked" : "no-vault");
      } catch (e) {
        if (cancelled) return;
        // 本人以外のアカウントは、ここから先へ進ませない
        if (isForbidden(e)) {
          keyRef.current = null;
          vaultStore.lock();
          setPhase("denied");
          setError("この操作卓は本人専用です。許可されたアカウントでサインインしてください。");
          return;
        }
        // サーバーに繋がらない場合でも、ローカルに控えがあれば解錠画面へ進める
        setPhase("locked");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, sessionPending]);

  // ---- 操作: ロック ------------------------------------------------
  const doLock = useCallback((reason: "manual" | "auto" = "manual") => {
    // 開いている書類の未保存分を先に金庫へ流し切ってから閉じる。
    // flush → mutate は同期的に state へ反映され、永続化はキューへ載る。
    // flushPending でキューが空になるのを待ってから鍵を捨てる。
    docViewer.close();
    setPhase("locked");
    setLockWarning(false);
    setSecondsToLock(null);
    void vaultStore
      .flushPending()
      .catch(() => undefined)
      .finally(() => {
        keyRef.current = null;
        vaultStore.lock();
      });
    void client.devices
      .logLogin({
        kind: reason === "manual" ? "manual_lock" : "auto_lock",
        platform: platformGuess(),
        userAgent: shortUA(),
        deviceId: deviceIdFor(),
      })
      .catch(() => undefined);
  }, []);

  // ---- 無操作ロック ------------------------------------------------
  useEffect(() => {
    if (phase !== "unlocked") {
      setLockWarning(false);
      setSecondsToLock(null);
      return;
    }
    const bump = () => {
      lastActivityRef.current = Date.now();
      setLockWarning(false);
    };
    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
      "focus",
    ];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    const timer = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= SEC_CONFIG.SESSION_TIMEOUT_MS) {
        doLock("auto");
      } else if (idle >= SEC_CONFIG.WARN_AT_MS) {
        setLockWarning(true);
        setSecondsToLock(Math.ceil((SEC_CONFIG.SESSION_TIMEOUT_MS - idle) / 1000));
      }
    }, 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(timer);
    };
  }, [phase, doLock]);

  // ---- ロックアウトの残り秒 ----------------------------------------
  useEffect(() => {
    const t = setInterval(() => setLockoutSeconds(lockoutRemainingSec()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---- 操作 -------------------------------------------------------
  const createVault = useCallback(
    async (passphrase: string) => {
      setBusy(true);
      setError(null);
      try {
        const salt = newSalt();
        const { vaultKey, macKey } = await deriveVaultKeys(
          passphrase,
          salt,
          SEC_CONFIG.KDF_ITERATIONS,
        );
        const verifier = await buildVerifier(vaultKey);
        await client.vault.create({
          kdfSalt: salt,
          kdfIterations: SEC_CONFIG.KDF_ITERATIONS,
          verifierCiphertext: verifier.ciphertext,
          verifierIv: verifier.iv,
        });
        keyRef.current = vaultKey;
        const initial = makeEmptyVaultState();
        await vaultStore.initializeEmpty(vaultKey, macKey, initial);
        resetFailures();
        setPhase("unlocked");
        lastActivityRef.current = Date.now();
        audit("vault_create");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [audit],
  );

  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
      if (isLockedOut()) {
        setError(
          `解錠の試行が続いたため一時的に停止しています。あと ${lockoutRemainingSec()} 秒お待ちください。`,
        );
        return false;
      }
      setBusy(true);
      setError(null);
      setPhase("unlocking");
      try {
        const st = await client.vault.status();
        if (!st.exists) {
          setPhase("no-vault");
          return false;
        }
        // 鍵の材料はここでだけ受け取る（受け取れる回数はサーバー側でも数えている）
        const p = await client.vault.unlockParams();
        const { vaultKey, macKey } = await deriveVaultKeys(
          passphrase,
          p.kdfSalt,
          p.kdfIterations,
        );
        const ok = await checkVerifier(vaultKey, {
          ciphertext: p.verifierCiphertext,
          iv: p.verifierIv,
        });
        if (!ok) {
          const r = recordFailure();
          setPhase("locked");
          setError(
            r.locked
              ? `パスフレーズが違います。試行回数の上限に達したため ${Math.round(SEC_CONFIG.LOCKOUT_MS / 60000)} 分お待ちください。`
              : `パスフレーズが違います。あと ${r.remaining} 回まで試せます。`,
          );
          void client.devices
            .logLogin({
              kind: "unlock_fail",
              platform: platformGuess(),
              userAgent: shortUA(),
              deviceId: deviceIdFor(),
            })
            .catch(() => undefined);
          return false;
        }
        keyRef.current = vaultKey;
        resetFailures();
        await vaultStore.unlock(vaultKey, macKey);
        setPhase("unlocked");
        lastActivityRef.current = Date.now();
        void client.devices
          .logLogin({
            kind: "unlock_ok",
            platform: platformGuess(),
            userAgent: shortUA(),
            deviceId: deviceIdFor(),
          })
          .catch(() => undefined);
        audit("vault_unlock");
        return true;
      } catch (e) {
        setPhase("locked");
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [audit],
  );

  const setMasked = useCallback((v: boolean) => {
    setMaskedRaw(v);
    localStorage.setItem("cockpit.masked", v ? "1" : "0");
  }, []);

  const mutate = useCallback(
    (fn: (s: VaultState) => void, touched?: string[]) => vaultStore.mutate(fn, touched),
    [],
  );

  const replaceState = useCallback((s: VaultState) => vaultStore.replaceState(s), []);
  const syncNow = useCallback(() => vaultStore.sync(), []);

  const saveMediaBlob = useCallback(
    (mediaId: string, blob: Blob, onProgress?: (d: number, t: number) => void) =>
      vaultStore.saveMediaBlob(mediaId, blob, onProgress),
    [],
  );
  const readMediaBlob = useCallback(
    (mediaId: string, mimeType: string) => vaultStore.readMediaBlob(mediaId, mimeType),
    [],
  );
  const deleteMediaBlob = useCallback((mediaId: string) => vaultStore.deleteMediaBlob(mediaId), []);

  const signOut = useCallback(async () => {
    audit("signout");
    keyRef.current = null;
    vaultStore.lock();
    await authClient.signOut();
    setPhase("signed-out");
  }, [audit]);

  const value = useMemo<VaultContextValue>(
    () => ({
      phase,
      revision,
      state,
      sync,
      masked,
      lockWarning,
      secondsToLock,
      error,
      busy,
      createVault,
      unlock,
      lock: doLock,
      setMasked,
      mutate,
      replaceState,
      syncNow,
      signOut,
      lockoutSeconds,
      audit,
      saveMediaBlob,
      readMediaBlob,
      deleteMediaBlob,
    }),
    [
      phase,
      revision,
      state,
      sync,
      masked,
      lockWarning,
      secondsToLock,
      error,
      busy,
      createVault,
      unlock,
      doLock,
      setMasked,
      mutate,
      replaceState,
      syncNow,
      signOut,
      lockoutSeconds,
      audit,
      saveMediaBlob,
      readMediaBlob,
      deleteMediaBlob,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
