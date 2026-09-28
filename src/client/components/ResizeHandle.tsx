"use client";

import { useRef } from "react";

export function ResizeHandle({
  orientation,
  onDrag,
  onReset
}: {
  orientation: "vertical" | "horizontal";
  onDrag: (delta: number) => void;
  onReset?: () => void;
}) {
  const last = useRef<number | null>(null);

  const vertical = orientation === "vertical";

  return (
    <div
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        event.preventDefault();
        last.current = vertical ? event.clientX : event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (last.current === null) return;

        const position = vertical ? event.clientX : event.clientY;
        onDrag(position - last.current);
        last.current = position;
      }}
      onPointerUp={() => {
        last.current = null;
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
      title="Drag to resize, double click to reset"
      className={`group relative flex shrink-0 items-center justify-center bg-[var(--color-edge)] transition-colors hover:bg-[var(--color-accent-dim)] ${
        vertical ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"
      }`}
      style={{ touchAction: "none" }}
    >
      {/* A grip in the middle, so the divider reads as something to drag. */}
      <span
        aria-hidden
        className={`pointer-events-none rounded-full bg-slate-500 transition-colors group-hover:bg-[var(--color-accent)] ${
          vertical ? "h-8 w-0.5" : "h-0.5 w-8"
        }`}
      />
    </div>
  );
}
