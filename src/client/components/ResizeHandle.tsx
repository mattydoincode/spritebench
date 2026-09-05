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
      className={`shrink-0 bg-[var(--color-edge)] transition-colors hover:bg-[var(--color-accent-dim)] ${
        vertical ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"
      }`}
      style={{ touchAction: "none" }}
    />
  );
}
