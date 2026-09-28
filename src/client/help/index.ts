import animation from "./animation";
import automations from "./automations";
import godot from "./godot";
import misc from "./misc";
import overview from "./overview";
import templates from "./templates";

/**
 * The Help dialog's tabs, in order. Copy lives in the file each one imports;
 * edit the words there. Add a tab by adding a file and a line here.
 */
export const HELP_TABS = [
  { id: "overview", label: "Overview", content: overview },
  { id: "automations", label: "Automations", content: automations },
  { id: "animation", label: "Animation", content: animation },
  { id: "templates", label: "Templates", content: templates },
  { id: "godot", label: "Godot (beta)", content: godot },
  { id: "misc", label: "Miscellaneous", content: misc }
] as const;

export type HelpTab = (typeof HELP_TABS)[number]["id"];
