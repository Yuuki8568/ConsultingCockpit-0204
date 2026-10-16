/**
 * 画面部品。13タブすべてがこれを使う。
 * 「入力したら即保存」を前提に、保存ボタンは置かない。
 */
import { useEffect, useId, useRef, useState } from "react";

export function Panel({
  title,
  note,
  right,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  note?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <div className="panel-head">
          <div className="min-w-0">
            {title && <h2 className="panel-title truncate">{title}</h2>}
            {note && <p className="mt-0.5 text-[11px] text-paper-faint">{note}</p>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Sec({ children }: { children: React.ReactNode }) {
  return <h3 className="sec">{children}</h3>;
}

export function Grid({
  cols = 2,
  children,
  className = "",
}: {
  cols?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const c =
    cols === 1
      ? "grid-cols-1"
      : cols === 2
        ? "sm:grid-cols-2"
        : cols === 3
          ? "sm:grid-cols-2 lg:grid-cols-3"
          : "sm:grid-cols-2 lg:grid-cols-4";
  return <div className={`grid grid-cols-1 gap-x-4 gap-y-3 ${c} ${className}`}>{children}</div>;
}

/** 文字入力。値を変えた瞬間に onChange が飛ぶ（保存は呼び出し側で debounce する） */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  mono,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className={`field ${mono ? "num" : ""}`}
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-paper-faint">{hint}</p>}
    </div>
  );
}

export function NumField({
  label,
  value,
  onChange,
  suffix,
  hint,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          className="field num"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="shrink-0 text-[12px] text-paper-dim">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-paper-faint">{hint}</p>}
    </div>
  );
}

export function Area({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <textarea
        id={id}
        className="field resize-y"
        rows={rows}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-paper-faint">{hint}</p>}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-paper-faint">{hint}</p>}
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-0.5 text-[13px] leading-relaxed text-paper">
      <input
        type="checkbox"
        className="mt-1 shrink-0 accent-[#0e7490]"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="mt-0.5 block text-[11px] text-paper-faint">{hint}</span>}
      </span>
    </label>
  );
}

/** 複数選択（改善方向性・手段・成果物など） */
export function Chips({
  label,
  values,
  selected,
  onToggle,
  hint,
}: {
  label?: string;
  values: [string, string][];
  selected: string[];
  onToggle: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      {label && <span className="field-label">{label}</span>}
      <div className="flex flex-wrap gap-1.5">
        {values.map(([v, l]) => {
          const on = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              className={`rounded-sm border px-2 py-1 text-[12px] transition-colors ${
                on
                  ? "border-brand/60 bg-brand-soft text-paper"
                  : "border-line bg-ink-850 text-paper-dim hover:border-line-strong hover:text-paper"
              }`}
            >
              {l}
            </button>
          );
        })}
      </div>
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-paper-faint">{hint}</p>}
    </div>
  );
}

export function Badge({
  children,
  color = "#6B665F",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="badge"
      style={{ color, borderColor: `${color}66`, background: `${color}1a` }}
    >
      {children}
    </span>
  );
}

/** 数値の見出し（KPI表示）。金額は Mask で包んで使う */
export function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="rounded-sm border border-line bg-ink-850 px-3 py-2.5">
      <div className="text-[11px] text-paper-dim">{label}</div>
      <div className="num mt-1 text-[19px] leading-tight font-medium" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-paper-faint">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-sm border border-dashed border-line px-4 py-6 text-center text-[12px] leading-relaxed text-paper-faint">
      {children}
    </p>
  );
}

/** 注意書き。免責・法務の注記はこれで統一する */
export function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "alert" | "ok";
  children: React.ReactNode;
}) {
  const c =
    tone === "warn"
      ? "#C9A961"
      : tone === "alert"
        ? "#B85C38"
        : tone === "ok"
          ? "#4A7C59"
          : "#3B6E8F";
  return (
    <div
      className="rounded-sm border px-3 py-2 text-[12px] leading-relaxed"
      style={{ color: c, borderColor: `${c}59`, background: `${c}14` }}
    >
      {children}
    </div>
  );
}

/** モーダル。書類生成・雛形編集・設定などで使う */
export function Modal({
  open,
  onClose,
  title,
  wide,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 p-3 sm:p-6">
      <div
        className={`panel my-auto w-full ${wide ? "max-w-[1000px]" : "max-w-[620px]"}`}
        style={{ background: "var(--color-ink-700)" }}
      >
        <div className="panel-head sticky top-0 z-10" style={{ background: "var(--color-ink-700)" }}>
          <h2 className="panel-title">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="panel-body">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** コピーボタン。生成物のほとんどはコピーして使うので専用にする */
export function CopyButton({
  text,
  label = "コピー",
  className = "btn btn-sm",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (t.current ? clearTimeout(t.current) : undefined), []);
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // クリップボードが使えない環境向けの退避手段
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        setDone(true);
        if (t.current) clearTimeout(t.current);
        t.current = setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? "コピーしました" : label}
    </button>
  );
}

/** タブ列。案件10タブ・リードタブで共用 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; done?: boolean }[];
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="no-scrollbar -mx-3 mb-4 overflow-x-auto border-b border-line px-3 lg:-mx-5 lg:px-5">
      <div className="flex min-w-max gap-0.5">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-[13px] whitespace-nowrap transition-colors ${
                on ? "text-paper" : "text-paper-dim hover:text-paper"
              }`}
            >
              {t.done && (
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: "#4A7C59" }}
                />
              )}
              {t.label}
              {on && (
                <span
                  className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full"
                  style={{ background: "#0e7490" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 行の削除など、戻せない操作の前に一度だけ確認する */
export function ConfirmButton({
  onConfirm,
  label,
  confirmLabel = "本当に削除",
  className = "btn btn-sm btn-danger",
}: {
  onConfirm: () => void;
  label: string;
  confirmLabel?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={className}
      onClick={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
