/**
 * 画面操作の軽い足跡（トラブル時の原因調査用）。
 *
 * localStorage に直近100件だけ残す。記録するのはイベント名・時刻・
 * ランダムなIDだけで、書類の本文・案件名・会社名などの中身は
 * 一切含めない（金庫の中身と同じく、平文を永続化しないため）。
 * 読み出しはコンソールで localStorage.getItem("cockpit.trace")。
 */

const TRACE_KEY = "cockpit.trace";
const TRACE_MAX = 100;

export function trace(event: string, extra?: Record<string, unknown>): void {
  try {
    const raw = localStorage.getItem(TRACE_KEY);
    const arr: unknown[] = raw ? (JSON.parse(raw) as unknown[]) : [];
    arr.push({ t: Date.now(), e: event, ...extra });
    while (arr.length > TRACE_MAX) arr.shift();
    localStorage.setItem(TRACE_KEY, JSON.stringify(arr));
  } catch {
    /* 記録できなくても本体の動作は止めない */
  }
}
