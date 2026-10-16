/**
 * モバイル版の金庫の状態管理。
 * サインイン → パスフレーズで鍵を作る（初回のみ）→ 生体認証で開く（2回目以降）
 * という流れをここで持つ。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { client } from "@/lib/api";
import { authClient } from "@/lib/auth";
import {
  checkVerifier,
  deriveVaultKey,
  forgetKey,
  hasRememberedKey,
  recallKey,
  rememberKey,
} from "@/lib/vault-crypto";
import {
  clearCache,
  collectActions,
  deviceId,
  loadOffline,
  saveOne,
  syncAndLoad,
  type HubAction,
  type MobileCase,
  type MobileLead,
  type MobileState,
} from "@/lib/vault-store";

/** 無操作でロックするまで（ブラウザ版と同じ30分） */
const LOCK_AFTER_MS = 30 * 60 * 1000;

export type Phase =
  | "booting"
  | "signed-out"
  | "no-vault"
  | "locked"
  | "deriving"
  | "unlocked"
  /** 許可されていないアカウントでサインインした状態 */
  | "denied";

interface Ctx {
  phase: Phase;
  state: MobileState | null;
  actions: HubAction[];
  offline: boolean;
  pending: number;
  error: string | null;
  hasSavedKey: boolean;
  progressNote: string | null;
  masked: boolean;
  toggleMask: () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  unlockWithPassphrase: (p: string, remember: boolean) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  lock: () => void;
  refresh: () => Promise<void>;
  patchCase: (id: string, fn: (c: MobileCase) => void) => Promise<void>;
  patchLead: (id: string, fn: (l: MobileLead) => void) => Promise<void>;
  forgetThisDevice: () => Promise<void>;
}

const VaultCtx = createContext<Ctx | null>(null);

export function useVault(): Ctx {
  const c = useContext(VaultCtx);
  if (!c) throw new Error("useVault は VaultProvider の内側で使ってください");
  return c;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const [phase, setPhase] = useState<Phase>("booting");
  const [state, setState] = useState<MobileState | null>(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [masked, setMasked] = useState(false);
  const [key, setKey] = useState<Uint8Array | null>(null);
  const [lastActive, setLastActive] = useState(Date.now());

  useEffect(() => {
    void hasRememberedKey().then(setHasSavedKey);
  }, []);

  // サインイン状態からフェーズを決める
  useEffect(() => {
    if (isPending) return;
    if (!session) {
      setKey(null);
      setState(null);
      setPhase("signed-out");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const st = await client.vault.status();
        if (cancelled) return;
        setPhase(st.exists ? "locked" : "no-vault");
      } catch (e) {
        if (cancelled) return;
        // 本人以外のアカウントは、ここから先へ進ませない
        const code = (e as { code?: unknown } | null)?.code;
        const status = (e as { status?: unknown } | null)?.status;
        if (code === "FORBIDDEN" || status === 403) {
          setKey(null);
          setState(null);
          setPhase("denied");
          setError("この操作卓は本人専用です。許可されたアカウントでサインインしてください。");
          return;
        }
        // 通信できなくても、端末に控えがあれば開ける
        setPhase("locked");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, isPending]);

  // 背面に回して30分たったら閉じる
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        if (key && Date.now() - lastActive > LOCK_AFTER_MS) {
          setKey(null);
          setState(null);
          setPhase("locked");
        }
        setLastActive(Date.now());
      } else {
        setLastActive(Date.now());
      }
    });
    return () => sub.remove();
  }, [key, lastActive]);

  const load = useCallback(async (k: Uint8Array) => {
    // まず端末の控えで開いてすぐ見せる
    setState(await loadOffline(k));
    setPhase("unlocked");
    // そのあとサーバーと合わせる
    const res = await syncAndLoad(k);
    setState(res.state);
    setOffline(res.offline);
    setError(res.offline ? (res.error ?? "通信できませんでした") : null);
  }, []);

  const unlockWithPassphrase = useCallback(
    async (passphrase: string, remember: boolean): Promise<boolean> => {
      setError(null);
      setPhase("deriving");
      setProgressNote("鍵を作っています。この端末では初回だけ時間がかかります…");
      try {
        const st = await client.vault.status();
        if (!st.exists) {
          setPhase("no-vault");
          return false;
        }
        // 鍵の材料はここでだけ受け取る（受け取れる回数はサーバー側でも数えている）
        const p = await client.vault.unlockParams();
        const k = await deriveVaultKey(passphrase, p.kdfSalt, p.kdfIterations);
        if (!checkVerifier(k, { ciphertext: p.verifierCiphertext, iv: p.verifierIv })) {
          setPhase("locked");
          setError("パスフレーズが違います。");
          void client.devices
            .logLogin({ kind: "unlock_fail", platform: "mobile", deviceId: await deviceId() })
            .catch(() => undefined);
          return false;
        }
        if (remember) {
          await rememberKey(k, p.kdfSalt);
          setHasSavedKey(true);
        }
        setKey(k);
        await load(k);
        void client.devices
          .logLogin({ kind: "unlock_ok", platform: "mobile", deviceId: await deviceId() })
          .catch(() => undefined);
        return true;
      } catch (e) {
        setPhase("locked");
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setProgressNote(null);
      }
    },
    [load],
  );

  const unlockWithBiometrics = useCallback(async (): Promise<boolean> => {
    setError(null);
    setProgressNote("端末の認証を待っています…");
    try {
      const r = await recallKey();
      if (!r) {
        setError("端末に預けた鍵を取り出せませんでした。パスフレーズを入力してください。");
        return false;
      }
      setKey(r.key);
      await load(r.key);
      void client.devices
        .logLogin({ kind: "unlock_ok", platform: "mobile", deviceId: await deviceId() })
        .catch(() => undefined);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setProgressNote(null);
    }
  }, [load]);

  const lock = useCallback(() => {
    setKey(null);
    setState(null);
    setPhase("locked");
  }, []);

  const refresh = useCallback(async () => {
    if (!key) return;
    const res = await syncAndLoad(key);
    setState(res.state);
    setOffline(res.offline);
    setError(res.offline ? (res.error ?? "通信できませんでした") : null);
  }, [key]);

  const patchCase = useCallback(
    async (id: string, fn: (c: MobileCase) => void) => {
      if (!key || !state) return;
      const c = state.cases.find((x) => x.id === id);
      if (!c) return;
      fn(c);
      setState((s2) => (s2 ? { ...s2 } : s2));
      await saveOne(key, "case", id, c);
      const res = await syncAndLoad(key);
      setOffline(res.offline);
      setPending(res.offline ? 1 : 0);
    },
    [key, state],
  );

  const patchLead = useCallback(
    async (id: string, fn: (l: MobileLead) => void) => {
      if (!key || !state) return;
      const l = state.leads.find((x) => x.id === id);
      if (!l) return;
      fn(l);
      setState((s2) => (s2 ? { ...s2 } : s2));
      await saveOne(key, "lead", id, l);
      const res = await syncAndLoad(key);
      setOffline(res.offline);
      setPending(res.offline ? 1 : 0);
    },
    [key, state],
  );

  const signIn = useCallback(async () => {
    setError(null);
    // Expo Go では認証の戻り先（exp://...）を認証基盤が受け付けないため、
    // サインインは開発ビルドまたはインストール版でのみ動く。
    // その場合は、分かりにくいサーバーのエラー画面に行く前に、ここで理由を伝える。
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      setError(
        "Expo Go ではGoogleサインインを使えません。認証の戻り先がExpo Go専用の形式になるため、認証基盤が受け付けないためです。開発ビルド（eas build）またはインストール版でお試しください。",
      );
      return;
    }
    const res = await authClient.managedAuth.signIn({ provider: "google" });
    if (res.error && res.error.code !== "AUTH_SESSION_DISMISSED") {
      setError(res.error.message ?? "サインインできませんでした");
    }
  }, []);

  const signOut = useCallback(async () => {
    setKey(null);
    setState(null);
    await authClient.signOut();
    setPhase("signed-out");
  }, []);

  const forgetThisDevice = useCallback(async () => {
    await forgetKey();
    await clearCache();
    setHasSavedKey(false);
    setKey(null);
    setState(null);
    setPhase("locked");
  }, []);

  const toggleMask = useCallback(() => setMasked((m) => !m), []);

  const actions = useMemo(
    () => (state ? collectActions(state) : []),
    [state],
  );

  const value = useMemo<Ctx>(
    () => ({
      phase,
      state,
      actions,
      offline,
      pending,
      error,
      hasSavedKey,
      progressNote,
      masked,
      toggleMask,
      signIn,
      signOut,
      unlockWithPassphrase,
      unlockWithBiometrics,
      lock,
      refresh,
      patchCase,
      patchLead,
      forgetThisDevice,
    }),
    [
      phase,
      state,
      actions,
      offline,
      pending,
      error,
      hasSavedKey,
      progressNote,
      masked,
      toggleMask,
      signIn,
      signOut,
      unlockWithPassphrase,
      unlockWithBiometrics,
      lock,
      refresh,
      patchCase,
      patchLead,
      forgetThisDevice,
    ],
  );

  return <VaultCtx.Provider value={value}>{children}</VaultCtx.Provider>;
}
