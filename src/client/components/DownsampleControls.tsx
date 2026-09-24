"use client";

import { useEffect, useState } from "react";
import type { ProcessingSettings } from "@/core/settings";
import { PIXELATE_MODES } from "@/core/types";
import { Field, NumberInput, Row, Select, Toggle } from "./ui";

const SIZE_PRESETS = [16, 24, 32, 48, 64, 128, 256] as const;

const PIXELATE_LABELS: Record<string, string> = {
  dominantColor: "dominant colour (chunky pixel art)",
  boxAverage: "box average (soft pixel art)",
  nearest: "nearest (hard, aliased)",
  bilinear: "bilinear (smooth shrink)",
  bicubic: "bicubic (smooth shrink)",
  lanczos: "lanczos (sharpest smooth shrink)"
};

const PARKED_SIZE = { width: 32, height: 32 };

function SizeAxis({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const preset = SIZE_PRESETS.find((size) => size === value);
  const [custom, setCustom] = useState(!preset);

  useEffect(() => {
    if (!preset) setCustom(true);
  }, [preset]);

  const chip = (active: boolean) =>
    `rounded px-1 py-0.5 text-[10px] transition ${
      active
        ? "bg-[var(--color-accent-dim)] text-white"
        : "text-slate-500 hover:bg-[var(--color-ink-600)] hover:text-white"
    }`;

  return (
    <div className="mb-1.5">
      <Row>
        <span className="w-10 shrink-0 text-[11px] tracking-wide text-slate-400 uppercase">
          {label}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-px">
          {SIZE_PRESETS.map((size) => (
            <button
              type="button"
              key={size}
              title={`Set ${label.toLowerCase()} to ${size}px`}
              onClick={() => {
                setCustom(false);
                onChange(size);
              }}
              className={`${chip(value === size && !custom)} tabular-nums`}
            >
              {size}
            </button>
          ))}
          <button
            type="button"
            title="Enter a custom size"
            onClick={() => setCustom(true)}
            className={chip(custom)}
          >
            custom
          </button>
          {custom ? (
            <NumberInput integer min={0} width={52} value={value} onChange={onChange} />
          ) : null}
        </div>
      </Row>
    </div>
  );
}

export function DownsampleControls({
  processing,
  onChange,
  hint
}: {
  processing: Pick<ProcessingSettings, "downsample" | "targetSize" | "pixelate">;
  onChange: (patch: Partial<ProcessingSettings>) => void;
  hint?: string;
}) {
  return (
    <div className="mb-2">
      <Toggle
        label="Downsample into pixel art"
        checked={processing.downsample}
        onChange={(downsample) => {
          if (
            downsample &&
            processing.targetSize.width === 0 &&
            processing.targetSize.height === 0
          ) {
            onChange({ downsample: true, targetSize: PARKED_SIZE });
            return;
          }
          onChange({ downsample });
        }}
      />

      {processing.downsample ? (
        <>
          <SizeAxis
            label="W"
            value={processing.targetSize.width}
            onChange={(width) =>
              onChange({
                targetSize: { ...processing.targetSize, width: Math.max(0, Math.round(width)) }
              })
            }
          />
          <SizeAxis
            label="H"
            value={processing.targetSize.height}
            onChange={(height) =>
              onChange({
                targetSize: { ...processing.targetSize, height: Math.max(0, Math.round(height)) }
              })
            }
          />
          <Field label="Filter" hint="how to shrink">
            <Select
              value={processing.pixelate}
              options={PIXELATE_MODES}
              labels={PIXELATE_LABELS}
              onChange={(pixelate) => onChange({ pixelate })}
            />
          </Field>
          {hint ? <p className="mb-2 text-[10px] leading-snug text-slate-500">{hint}</p> : null}
        </>
      ) : null}
    </div>
  );
}
