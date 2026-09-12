"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { type Pane, useUi } from "@/client/stores/ui";

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
  width = 760,
  variant = "dense"
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  width?: number;
  /**
   * `dense` matches the studio's tool chrome: tiny uppercase label, tight
   * padding. `plain` is for the pages outside it, where a dialog is something
   * you read rather than a panel you work in.
   */
  variant?: "dense" | "plain";
}) {
  const plain = variant === "plain";

  /**
   * Portalled to the body rather than rendered where it was declared.
   *
   * A dialog opened from the scene overlay would otherwise inherit that
   * overlay's `pointer-events: none` -- it drew correctly and ignored every
   * click, Cancel included. Where a dialog is written should not decide
   * whether it works, so it always mounts at the top of the tree.
   */
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

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

  if (!host) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onPointerDown={onClose}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        style={{ maxWidth: width }}
        className={`flex max-h-full min-h-0 w-full flex-col border border-[var(--color-edge)] bg-[var(--color-ink-900)] shadow-2xl ${
          plain ? "page-shell rounded-lg" : "rounded"
        }`}
      >
        <header
          className={`flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-edge)] ${
            plain ? "px-5 py-3.5" : "px-3 py-2"
          }`}
        >
          <h2
            className={
              plain
                ? "text-lg font-semibold text-white"
                : "text-[11px] font-semibold tracking-wider text-slate-300 uppercase"
            }
          >
            {title}
          </h2>

          <div className="flex items-center gap-1">
            {actions}
            <Button variant="ghost" onClick={onClose}>
              close
            </Button>
          </div>
        </header>

        <div className={`min-h-0 flex-1 overflow-y-auto ${plain ? "px-5 py-4" : "p-3"}`}>
          {children}
        </div>

        {footer ? (
          <div
            className={`shrink-0 border-t border-[var(--color-edge)] ${
              plain ? "px-5 py-3.5" : "px-3 py-2"
            }`}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    host
  );
}

export function PreviewLightbox({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

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

  if (!host) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4"
      onPointerDown={onClose}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3 text-[11px] text-slate-400">
        <span className="truncate uppercase tracking-wide">{title}</span>
        <span className="shrink-0">esc or click to close</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">{children}</div>
    </div>,
    host
  );
}

export function ExpandablePreview({
  title,
  className = "",
  style,
  children,
  expanded
}: {
  title: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  expanded: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        title={`Expand ${title}`}
        className={`appearance-none cursor-pointer ${className}`}
        style={style}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? (
        <PreviewLightbox title={title} onClose={() => setOpen(false)}>
          {expanded}
        </PreviewLightbox>
      ) : null}
    </>
  );
}

/**
 * A floating panel over the scene.
 *
 * Scene controls sit on the canvas rather than in a toolbar above it so
 * that what they act on is unambiguous. A docked toolbar outlives the view it
 * describes -- "cell 16" in a bar at the top of the screen reads like an app
 * setting, whereas the same field floating over the grid it divides reads as
 * a property of this scene, which is what it is.
 *
 * Does not position itself. Bubbles live in a flex overlay so that opening one
 * pushes its neighbour along instead of covering it, and so a tall one is
 * capped by the row it sits in and scrolls, rather than running off the canvas.
 */
export function Bubble({
  title,
  className = "",
  collapsed = false,
  onToggle,
  actions,
  children,
  width
}: {
  title: string;
  className?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Shown in the title bar even when collapsed, so keep it to a summary. */
  actions?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div
      style={width && !collapsed ? { width } : undefined}
      className={`pointer-events-auto flex max-h-full min-h-0 flex-col rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)]/95 shadow-xl backdrop-blur-sm ${className}`}
    >
      {/*
        The whole title bar is the toggle, not just the chevron: it is the one
        part of a bubble that never does anything else, and a 12px glyph is a
        mean target for something you hit as often as getting the canvas back.
      */}
      <header
        onClick={onToggle}
        role={onToggle ? "button" : undefined}
        tabIndex={onToggle ? 0 : undefined}
        aria-expanded={onToggle ? !collapsed : undefined}
        title={onToggle ? (collapsed ? `Show ${title.toLowerCase()}` : `Hide ${title.toLowerCase()}`) : undefined}
        onKeyDown={(event) => {
          if (!onToggle || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          onToggle();
        }}
        className={`flex shrink-0 items-center gap-1.5 px-2 py-1.5 ${
          onToggle
            ? `cursor-pointer rounded-t-lg select-none hover:bg-[var(--color-ink-700)] ${collapsed ? "rounded-b-lg" : ""}`
            : ""
        }`}
      >
        <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
          {title}
        </span>

        <span className="flex-1" />
        {actions}

        {onToggle ? (
          <span className="px-1 leading-none text-slate-500" aria-hidden>
            {collapsed ? "\u25b8" : "\u25be"}
          </span>
        ) : null}
      </header>

      {collapsed ? null : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{children}</div>
      )}
    </div>
  );
}

/**
 * Which way a docked panel folds away, so its chevron points at the exit.
 *
 * Deliberately double angle quotes rather than the solid triangles the
 * scene bubbles use. The two collapse in different directions -- a panel
 * slides out of the layout, a bubble rolls up in place -- and telling them
 * apart at a glance is worth two glyph families.
 */
const COLLAPSE_ARROW: Record<Pane, string> = {
  left: "\u00ab",
  right: "\u00bb",
  library: "\u02c5"
};

function CollapseChevron({ pane }: { pane: Pane }) {
  return (
    <button
      type="button"
      title="Collapse this panel"
      aria-label="Collapse this panel"
      onClick={() => useUi.getState().togglePane(pane)}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--color-edge)] bg-[var(--color-ink-700)] text-[13px] leading-none text-slate-400 transition hover:border-slate-500 hover:bg-[var(--color-ink-500)] hover:text-white"
    >
      {COLLAPSE_ARROW[pane]}
    </button>
  );
}

export function Panel({
  title,
  lead,
  children,
  actions,
  pane,
  className = ""
}: {
  title?: string;
  /** Replaces the title, for a control that belongs in the header. */
  lead?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** Set to give this panel a collapse chevron in its header. */
  pane?: Pane;
  className?: string;
}) {
  return (
    <section className={`flex h-full min-h-0 flex-col ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-edge)] bg-[var(--color-ink-800)] px-3 py-2">
        {/*
          The chevron sits on whichever side the panel folds towards, which is
          the side the scene is on. For the inspector that is the inner
          edge, so it leads the title rather than trailing the actions.
        */}
        <div className="flex min-w-0 items-center gap-1.5">
          {pane === "right" ? <CollapseChevron pane={pane} /> : null}

          {lead ?? (
            <h2 className="truncate text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              {title}
            </h2>
          )}
        </div>

        <div className="flex items-center gap-1">
          {actions}
          {pane && pane !== "right" ? <CollapseChevron pane={pane} /> : null}
        </div>
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

/**
 * A title-row action: 10px, no chrome at rest, a real hover so it reads as
 * clickable. `danger` is for remove / delete.
 */
export function TextButton({
  children,
  onClick,
  title,
  danger = false,
  disabled,
  className = ""
}: {
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-1 py-0.5 text-[10px] leading-none transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "text-slate-400 hover:bg-[#5a2130] hover:text-rose-200"
          : "text-slate-400 hover:bg-[var(--color-ink-600)] hover:text-white"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`mb-2 flex items-center gap-2 select-none ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
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
  labels,
  disabled
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  labels?: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      className={disabled ? "opacity-50" : undefined}
      onChange={(event) => onChange(event.target.value as T)}
    >
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
