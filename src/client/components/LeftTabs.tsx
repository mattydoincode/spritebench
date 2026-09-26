"use client";

import { useServer } from "@/client/stores/server";
import { useUi, type LeftTab } from "@/client/stores/ui";
import { Tab, Tabs } from "./ui";

export function LeftTabs() {
  const tab = useUi((state) => state.leftTab);
  const slots = useServer((state) => state.slots);
  const setTab = (next: LeftTab) => useUi.getState().setLeftTab(next);

  return (
    <Tabs label="Prompt and Godot">
      <Tab selected={tab === "prompt"} onClick={() => setTab("prompt")}>
        Prompt
      </Tab>
      <Tab selected={tab === "godot"} onClick={() => setTab("godot")}>
        Godot{slots.length > 0 ? ` (${slots.length})` : ""}
      </Tab>
    </Tabs>
  );
}
