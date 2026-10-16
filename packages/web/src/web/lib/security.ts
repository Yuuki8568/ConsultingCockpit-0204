/**
 * セキュリティの設定値と、ブラウザ側で完結する保護機構。
 * v3 の SEC_CONFIG を引き継ぎつつ、鍵導出だけ強化している。
 */

export const SEC_CONFIG = {
  /** PBKDF2 反復回数（v3: 100,000 → v4: 600,000） */
  KDF_ITERATIONS: 600_000,
  /** 無操作でロックするまで */
  SESSION_TIMEOUT_MS: 30 * 60 * 1000,
  /** ロック予告を出すまで */
  WARN_AT_MS: 25 * 60 * 1000,
  /** 解錠失敗の許容回数 */
  MAX_FAILURES: 5,
  /** 失敗上限に達したときの待機時間 */
  LOCKOUT_MS: 5 * 60 * 1000,
  /** 失敗回数がリセットされるまで */
  FAILURE_RESET_MS: 30 * 60 * 1000,
} as const;

const RL_KEY = "cockpit.rateLimit";

interface RateLimitState {
  failures: number;
  firstFailureAtMs: number;
  lockedUntilMs: number;
}

function readRl(): RateLimitState {
  try {
    const raw = localStorage.getItem(RL_KEY);
    if (!raw) return { failures: 0, firstFailureAtMs: 0, lockedUntilMs: 0 };
    return JSON.parse(raw) as RateLimitState;
  } catch {
    return { failures: 0, firstFailureAtMs: 0, lockedUntilMs: 0 };
  }
}

function writeRl(s: RateLimitState): void {
  try {
    localStorage.setItem(RL_KEY, JSON.stringify(s));
  } catch {
    /* プライベートモード等で書けないことがある。その場合は制限が効かないが動作は継続する */
  }
}

/** いま解錠を試せるか */
export function isLockedOut(): boolean {
  const s = readRl();
  return s.lockedUntilMs > Date.now();
}

/** 解錠できるようになるまでの残り秒 */
export function lockoutRemainingSec(): number {
  const s = readRl();
  return Math.max(0, Math.ceil((s.lockedUntilMs - Date.now()) / 1000));
}

export function failureCount(): number {
  const s = readRl();
  if (s.firstFailureAtMs && Date.now() - s.firstFailureAtMs > SEC_CONFIG.FAILURE_RESET_MS) {
    return 0;
  }
  return s.failures;
}

/** 解錠失敗を記録。上限に達したらロックアウトする。 */
export function recordFailure(): { locked: boolean; remaining: number } {
  const now = Date.now();
  const s = readRl();
  if (s.firstFailureAtMs && now - s.firstFailureAtMs > SEC_CONFIG.FAILURE_RESET_MS) {
    s.failures = 0;
    s.firstFailureAtMs = 0;
  }
  s.failures += 1;
  if (!s.firstFailureAtMs) s.firstFailureAtMs = now;
  if (s.failures >= SEC_CONFIG.MAX_FAILURES) {
    s.lockedUntilMs = now + SEC_CONFIG.LOCKOUT_MS;
    s.failures = 0;
    s.firstFailureAtMs = 0;
    writeRl(s);
    return { locked: true, remaining: 0 };
  }
  writeRl(s);
  return { locked: false, remaining: SEC_CONFIG.MAX_FAILURES - s.failures };
}

export function resetFailures(): void {
  writeRl({ failures: 0, firstFailureAtMs: 0, lockedUntilMs: 0 });
}

/** 端末の見分け用ラベル */
export function platformGuess(): string {
  const ua = navigator.userAgent;
  if (/Electron/i.test(ua)) return "デスクトップ";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "不明";
}

export function shortUA(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "その他";
  return `${browser} / ${platformGuess()}`;
}

export function deviceLabel(): string {
  return shortUA();
}
