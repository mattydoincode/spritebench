"use client";

import { useEffect, useState, type ReactNode } from "react";

let openModals = 0;

export function anyModalOpen(): boolean {
  return openModals > 0;
}

export function Modal({
  title,
  onClose,
  children,
  actions,
  footer,
  width = 760
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    openModals++;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      openModals--;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onPointerDown={onClose}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        style={{ maxWidth: width }}
        className="flex max-h-full min-h-0 w-full flex-col rounded border border-[var(--color-edge)] bg-[var(--color-ink-900)] shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-edge)] px-3 py-2">
          <h2 className="text-[11px] font-semibold tracking-wider text-slate-300 uppercase">
            {title}
          </h2>

          <div className="flex items-center gap-1">
            {actions}
            <Button variant="ghost" onClick={onClose}>
              close
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>

        {footer ? (
          <div className="shrink-0 border-t border-[var(--color-edge)] px-3 py-2">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export function Panel({
  title,
  children,
  actions,
  className = ""
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-edge)] bg-[var(--color-ink-800)] px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </h2>
        <div className="flex items-center gap-1">{actions}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
        {hint ? <span className="text-[10px] text-slate-500">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-2 ${className}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  title,
  className = ""
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const styles = {
    default:
      "bg-[var(--color-ink-600)] hover:bg-[var(--color-ink-500)] border-[var(--color-edge)]",
    primary:
      "bg-[var(--color-accent-dim)] hover:brightness-125 border-[var(--color-accent-dim)] text-white font-medium",
    ghost: "bg-transparent hover:bg-[var(--color-ink-700)] border-transparent",
    danger: "bg-[#5a2130] hover:bg-[#73293c] border-[#73293c]"
  }[variant];

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Toggle({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mb-2 flex cursor-pointer items-center gap-2 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
      />
      <span className="text-xs text-slate-300">{label}</span>
    </label>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  labels
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  labels?: Record<string, string>;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option} value={option}>
          {labels?.[option] ?? option}
        </option>
      ))}
    </select>
  );
}

function format(value: number, integer: boolean): string {
  if (!Number.isFinite(value)) return "0";
  if (integer) return String(Math.round(value));
  if (Number.isInteger(value)) return String(value);

  return String(Math.round(value * 1000) / 1000);
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  integer = false,
  disabled,
  title,
  width,
  onFocus,
  onBlur
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  disabled?: boolean;
  title?: string;
  width?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = (raw: number) => {
    let next = integer ? Math.round(raw) : raw;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  };

  const commit = (text: string) => {
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
  };

  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      spellCheck={false}
      disabled={disabled}
      title={title}
      value={draft ?? format(value, integer)}
      style={width !== undefined ? { width } : undefined}
      onChange={(event) => {
        setDraft(event.target.value);
        commit(event.target.value);
      }}
      onFocus={onFocus}
      onBlur={() => {
        setDraft(null);
        onBlur?.();
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

        event.preventDefault();
        const nudge = (event.key === "ArrowUp" ? step : -step) * (event.shiftKey ? 10 : 1);
        setDraft(null);
        onChange(clamp((Number.isFinite(value) ? value : 0) + nudge));
      }}
    />
  );
}

function normalizeHex(text: string): string | null {
  const body = text.trim().replace(/^#/, "");

  if (/^[0-9a-fA-F]{3}$/.test(body)) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`.toLowerCase();
  }

  return /^[0-9a-fA-F]{6}$/.test(body) ? `#${body.toLowerCase()}` : null;
}

export function ColorInput({
  value,
  onChange,
  fallback = "#1a1f26",
  allowEmpty = false,
  title
}: {
  value: string;
  onChange: (value: string) => void;
  fallback?: string;
  allowEmpty?: boolean;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Row>
      <input
        type="color"
        title={title}
        value={value || fallback}
        onChange={(event) => {
          setDraft(null);
          onChange(event.target.value);
        }}
        style={{ width: 44, padding: 0, flexShrink: 0 }}
      />

      <input
        type="text"
        spellCheck={false}
        placeholder={allowEmpty ? "none" : fallback}
        title="Paste a hex colour"
        value={draft ?? value}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);

          if (allowEmpty && text.trim().length === 0) {
            onChange("");
            return;
          }

          const hex = normalizeHex(text);
          if (hex) onChange(hex);
        }}
        onBlur={() => setDraft(null)}
      />
    </Row>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 0.01
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <Row>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
        {value.toFixed(2)}
      </span>
    </Row>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="my-3 flex items-center gap-2">
      <span className="h-px flex-1 bg-[var(--color-edge)]" />
      {label ? (
        <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
      ) : null}
      <span className="h-px flex-1 bg-[var(--color-edge)]" />
    </div>
  );
}
