import { HOTKEY_ACTIONS, type HotkeyAction } from "./types";

export type KeybindingGroup = {
  id: string;
  label: string;
  description: string;
  actions: HotkeyAction[];
};

export const KEYBINDING_GROUPS: KeybindingGroup[] = [
  {
    id: "session",
    label: "Session management",
    description: "Create, hide, expand, and duplicate agent sessions on a project.",
    actions: [
      "agent.new",
      "terminal.close",
      "terminal.expandToggle",
      "session.closeWindow",
      "session.clone",
      "session.cycleNext",
      "session.cyclePrev",
    ],
  },
  {
    id: "terminal",
    label: "Terminal management",
    description: "Show the terminal panel and manage shell tabs.",
    actions: ["terminal.toggle", "terminal.newTab", "terminal.cycleNext", "terminal.cyclePrev"],
  },
  {
    id: "project",
    label: "Project management",
    description: "Run projects, switch between them, and work with files.",
    actions: [
      "project.runToggle",
      "project.picker",
      "project.add",
      "project.edit",
      "project.pinnedSlot",
      "file.finder",
      "file.save",
      "git.diff",
    ],
  },
  {
    id: "home",
    label: "Home",
    description: "Navigation and search on the projects home screen.",
    actions: ["nav.toggle", "search.focus"],
  },
  {
    id: "general",
    label: "General",
    description: "Shared shortcuts that apply across dialogs and forms.",
    actions: ["dialog.submit"],
  },
];

const groupedActions = new Set(KEYBINDING_GROUPS.flatMap((g) => g.actions));
if (
  groupedActions.size !== HOTKEY_ACTIONS.length ||
  !HOTKEY_ACTIONS.every((action) => groupedActions.has(action))
) {
  throw new Error("KEYBINDING_GROUPS must include each HOTKEY_ACTION exactly once");
}
