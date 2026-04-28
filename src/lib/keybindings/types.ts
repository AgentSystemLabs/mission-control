export const HOTKEY_ACTIONS = [
  "agent.new",
  "project.edit",
  "project.picker",
  "nav.toggle",
  "search.focus",
  "terminal.toggle",
  "terminal.close",
  "dialog.submit",
  "file.finder",
  "file.save",
  "git.diff",
] as const;

export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number];

export type Binding = {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
};

export type BindingMap = Record<HotkeyAction, Binding>;

export const ACTION_META: Record<HotkeyAction, { label: string; description: string }> = {
  "agent.new": { label: "New agent / project", description: "Create a new agent on a project page, or a new project on the home page." },
  "project.edit": { label: "Edit project", description: "Open the edit dialog for the current project." },
  "project.picker": { label: "Open project picker", description: "Open the cross-project quick switcher." },
  "nav.toggle": { label: "Toggle nav menu", description: "Show or hide the navigation menu." },
  "search.focus": { label: "Focus search", description: "Focus the project search field on the home page." },
  "terminal.toggle": { label: "Toggle terminal panel", description: "Show or hide the bottom terminal panel." },
  "terminal.close": { label: "Close terminal", description: "Deselect / close the active terminal session." },
  "dialog.submit": { label: "Submit dialog", description: "Submit a dialog form (New agent, edit project, etc.)." },
  "file.finder": { label: "Open file finder", description: "Open the fuzzy file finder for the current project." },
  "file.save": { label: "Save file", description: "Save the file currently open in the editor." },
  "git.diff": { label: "Open git diff", description: "Open the git diff review view for the current project." },
};
