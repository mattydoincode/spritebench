"use client";

import { useServer } from "@/client/stores/server";
import { useUi, type RightTab } from "@/client/stores/ui";
import { Tab, Tabs } from "./ui";

export function RightTabs() {
  const tab = useUi((state) => state.rightTab);
  const slots = useServer((state) => state.slots);
  const setTab = (next: RightTab) => useUi.getState().setRightTab(next);

  return (
    <Tabs label="Inspector and Godot">
      <Tab selected={tab === "inspector"} onClick={() => setTab("inspector")}>
        Inspector
      </Tab>
      <Tab selected={tab === "godot"} onClick={() => setTab("godot")}>
        Godot{slots.length > 0 ? ` (${slots.length})` : ""}
      </Tab>
    </Tabs>
  );
}
