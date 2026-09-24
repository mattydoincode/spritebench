"use client";

import {
  ISO_LIGHTS,
  ISO_LIGHT_LABELS,
  type IsoLight
} from "@/core/isoTemplate";
import { Button, Field, Row } from "./ui";

export function IsoLightField({
  light,
  onChange,
  label = "Light"
}: {
  light: IsoLight;
  onChange: (light: IsoLight) => void;
  label?: string;
}) {
  return (
    <Field label={label} hint="sun">
      <Row>
        {ISO_LIGHTS.map((direction) => (
          <Button
            key={direction}
            variant={light === direction ? "primary" : "ghost"}
            onClick={() => onChange(direction)}
          >
            {ISO_LIGHT_LABELS[direction]}
          </Button>
        ))}
      </Row>
    </Field>
  );
}
