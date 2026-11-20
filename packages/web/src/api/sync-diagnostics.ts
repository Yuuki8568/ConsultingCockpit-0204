/** Never emit exception messages, SQL parameters, stack traces or request data. */
export function classifySyncError(error: unknown) {
  const categories = new Set<string>();
  const codes = new Set<string>();
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const item = current as { message?: unknown; code?: unknown; cause?: unknown };
    const message = typeof item.message === "string" ? item.message : "";
    if (/no such table/i.test(message)) categories.add("missing-table");
    if (/no such column|has no column/i.test(message)) categories.add("missing-column");
    if (/too many sql variables/i.test(message)) categories.add("sql-variable-limit");
    if (/too many subrequests/i.test(message)) categories.add("subrequest-limit");
    if (/transaction.*(closed|expired|timeout)|transaction is not active/i.test(message)) categories.add("transaction-expired");
    if (/not supported|unsupported/i.test(message)) categories.add("unsupported-operation");
    if (/constraint failed/i.test(message)) categories.add("constraint-failed");
    if (/fetch failed|network|connection/i.test(message)) categories.add("connection-error");
    if (/timeout|timed out/i.test(message)) categories.add("timeout");
    const allowed = /^(SQLITE_(ERROR|BUSY|LOCKED|CONSTRAINT|READONLY|FULL|TOOBIG|MISUSE|AUTH)(_[A-Z]+)?|TRANSACTION_CLOSED|TRANSACTION_TIMEOUT|URL_INVALID|HRANA_WEBSOCKET_ERROR|SERVER_ERROR|UNKNOWN|INTERNAL_SERVER_ERROR)$/;
    if (typeof item.code === "string" && allowed.test(item.code)) codes.add(item.code);
    current = item.cause;
  }
  return { categories: [...categories], codes: [...codes] };
}
