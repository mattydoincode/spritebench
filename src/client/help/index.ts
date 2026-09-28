import advanced from "./advanced";
import animation from "./animation";
import automations from "./automations";
import godot from "./godot";
import overview from "./overview";

/**
 * The Help dialog's tabs, in order. Copy lives in the file each one imports;
 * edit the words there. Add a tab by adding a file and a line here.
 */
export const HELP_TABS = [
  { id: "overview", label: "Overview", content: overview },
  { id: "automations", label: "Automations", content: automations },
  { id: "animation", label: "Animation", content: animation },
  { id: "godot", label: "Godot (beta)", content: godot },
  { id: "advanced", label: "Advanced", content: advanced }
] as const;

export type HelpTab = (typeof HELP_TABS)[number]["id"];
