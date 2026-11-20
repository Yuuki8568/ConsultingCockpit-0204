/** Resume triggers never unlock the vault or bypass the existing signed sync path. */
export function installResumeSync(options: {
  window: EventTarget; document: EventTarget; visible: () => boolean;
  ready: () => boolean; sync: () => Promise<void>; now?: () => number;
}) {
  let last = -Infinity;
  const resume = () => {
    const now = (options.now ?? Date.now)();
    if (!options.visible() || !options.ready() || now - last < 2000) return;
    last = now;
    void options.sync().catch(() => { /* sync() owns user-visible error status */ });
  };
  options.window.addEventListener("focus", resume);
  options.window.addEventListener("pageshow", resume);
  options.document.addEventListener("visibilitychange", resume);
  return () => {
    options.window.removeEventListener("focus", resume);
    options.window.removeEventListener("pageshow", resume);
    options.document.removeEventListener("visibilitychange", resume);
  };
}
