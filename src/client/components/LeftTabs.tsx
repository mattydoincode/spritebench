"use client";

import { useServer } from "@/client/stores/server";
import { useUi, type LeftTab } from "@/client/stores/ui";
import { PanelTab } from "./ui";

/** The left slot's two panels, as tabs in whichever one is showing. */
export function LeftTabs() {
  const tab = useUi((state) => state.leftTab);
  const slots = useServer((state) => state.slots);
  const setTab = (next: LeftTab) => useUi.getState().setLeftTab(next);

  return (
    <>
      <PanelTab selected={tab === "prompt"} onClick={() => setTab("prompt")}>
        Prompt
      </PanelTab>
      <PanelTab
        selected={tab === "godot"}
        count={slots.length > 0 ? slots.length : undefined}
        onClick={() => setTab("godot")}
      >
        Godot
      </PanelTab>
    </>
  );
}
