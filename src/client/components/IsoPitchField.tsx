"use client";

import {
  DIMETRIC_PITCH,
  MAX_ISO_PITCH,
  MAX_ISO_TEMPLATE_PITCH,
  MIN_ISO_PITCH,
  MIN_ISO_TEMPLATE_PITCH,
  TRUE_ISO_PITCH,
  isoDiamondRatioForPitch,
  isoPitchesEqual
} from "@/core/iso";
import { Button, Field, NumberInput, Row, Slider } from "./ui";

function pitchHint(pitch: number): string {
  if (isoPitchesEqual(pitch, 0)) return `${pitch.toFixed(1)}° · side`;
  if (isoPitchesEqual(pitch, 90)) return `${pitch.toFixed(1)}° · top`;
  return `${pitch.toFixed(1)}° · ${isoDiamondRatioForPitch(pitch).toFixed(2)}:1`;
}

export function IsoPitchField({
  pitch,
  onChange,
  label = "Camera",
  min = MIN_ISO_PITCH,
  max = MAX_ISO_PITCH
}: {
  pitch: number;
  onChange: (pitch: number) => void;
  label?: string;
  min?: number;
  max?: number;
}) {
  const showEnds = min <= MIN_ISO_TEMPLATE_PITCH && max >= MAX_ISO_TEMPLATE_PITCH;

  return (
    <Field label={label} hint={pitchHint(pitch)}>
      <Row>
        <div className="min-w-0 flex-1">
          <Slider min={min} max={max} step={0.5} value={pitch} showValue={false} onChange={onChange} />
        </div>
        <NumberInput
          min={min}
          max={max}
          step={0.5}
          width={56}
          title="Camera elevation in degrees"
          value={pitch}
          onChange={onChange}
        />
      </Row>
      <Row className="mt-1">
        {showEnds ? (
          <Button variant={isoPitchesEqual(pitch, 0) ? "primary" : "ghost"} onClick={() => onChange(0)}>
            0°
          </Button>
        ) : null}
        <Button
          variant={isoPitchesEqual(pitch, DIMETRIC_PITCH) ? "primary" : "ghost"}
          onClick={() => onChange(DIMETRIC_PITCH)}
        >
          30° 2:1
        </Button>
        <Button
          variant={isoPitchesEqual(pitch, TRUE_ISO_PITCH) ? "primary" : "ghost"}
          onClick={() => onChange(TRUE_ISO_PITCH)}
        >
          true iso
        </Button>
        {showEnds ? (
          <Button variant={isoPitchesEqual(pitch, 90) ? "primary" : "ghost"} onClick={() => onChange(90)}>
            90°
          </Button>
        ) : null}
      </Row>
    </Field>
  );
}
