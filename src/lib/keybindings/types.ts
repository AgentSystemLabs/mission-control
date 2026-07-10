export const HOTKEY_ACTIONS = [
  "agent.new",
  "project.add",
  "project.edit",
  "project.picker",
  "project.pinnedSlot",
  "nav.toggle",
  "search.focus",
  "terminal.toggle",
  "terminal.close",
  "terminal.expandToggle",
  "terminal.newTab",
  "terminal.cycleNext",
  "terminal.cyclePrev",
  "session.closeWindow",
  "session.clone",
  "session.newRow",
  "session.cycleNext",
  "session.cyclePrev",
  "session.gridNavigate",
  "session.gridLayout",
  "session.gridView",
  "session.focusMode",
  "dialog.submit",
  "file.finder",
  "file.save",
  "git.diff",
  "project.runToggle",
  "voice.pushToTalk",
  "prompt.search",
  "screenshot.capture",
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
  "project.add": { label: "Add project", description: "Open the Add Project dialog from anywhere in the app." },
  "project.edit": { label: "Edit project", description: "Open the edit dialog for the current project." },
  "project.picker": { label: "Open project picker", description: "Open the cross-project quick switcher." },
  "project.pinnedSlot": {
    label: "Switch pinned project",
    description: "Jump to pinned project slots 1–4 from the project bar (uses the same modifiers with keys 1–4).",
  },
  "nav.toggle": { label: "Toggle nav menu", description: "Show or hide the navigation menu." },
  "search.focus": { label: "Focus search", description: "Focus the project search field on the home page." },
  "terminal.toggle": { label: "Toggle terminal panel", description: "Show or hide the bottom terminal panel." },
  "terminal.close": { label: "Toggle session panel", description: "Hide the active session panel, or show the last hidden session for the current project." },
  "terminal.expandToggle": { label: "Expand / shrink session panel", description: "Toggle the session panel between its resizable width and full workspace width for the current project." },
  "terminal.newTab": { label: "New terminal", description: "Open a new shell tab in the terminal panel." },
  "terminal.cycleNext": { label: "Next terminal tab", description: "Switch to the next terminal tab." },
  "terminal.cyclePrev": { label: "Previous terminal tab", description: "Switch to the previous terminal tab." },
  "session.closeWindow": {
    label: "Archive session",
    description:
      "Archive the open session (no confirmation). If it is already archived, permanently delete it instead.",
  },
  "session.clone": { label: "Clone session", description: "Duplicate the active agent session with the same settings." },
  "session.newRow": {
    label: "New session in new row",
    description:
      "In grid view, start a new session in a fresh row at the bottom of the grid instead of beside the active session.",
  },
  "session.cycleNext": { label: "Next session", description: "Cycle to the next open session in the panel." },
  "session.cyclePrev": { label: "Previous session", description: "Cycle to the previous open session in the panel." },
  "session.gridNavigate": {
    label: "Navigate session grid",
    description:
      "In the full-width grid view, start keyboard navigation — arrow keys move the selection between open sessions and Enter opens the highlighted one (Esc cancels).",
  },
  "session.gridLayout": {
    label: "Grid layout quick picker",
    description:
      "In grid view, open a quick popup to set how many sessions each row holds (←/→ step the width live, 1–6 or A jump directly) and sort the grid by agent (↑/↓ + Enter).",
  },
  "session.gridView": {
    label: "Toggle grid view",
    description:
      "Show or hide the full-width grid of every open session across all projects.",
  },
  "session.focusMode": {
    label: "Focus session (floating)",
    description:
      "Pop the active session out into a small always-on-top floating window; press again to restore the full app.",
  },
  "dialog.submit": { label: "Submit dialog", description: "Submit a dialog form (New agent, edit project, etc.)." },
  "file.finder": { label: "Open file finder", description: "Open the fuzzy file finder for the current project." },
  "file.save": { label: "Save file", description: "Save the file currently open in the editor." },
  "git.diff": { label: "Toggle Review Changes", description: "Open or close the change review view for the current project." },
  "project.runToggle": { label: "Run / Stop project", description: "Run the project's launch commands, or stop them if already running." },
  "voice.pushToTalk": {
    label: "Push to talk",
    description:
      "Hold to speak a voice command — switch project, run the project, or start an agent. Release to run it.",
  },
  "prompt.search": {
    label: "Search prompt history",
    description:
      "Open a searchable popup of every prompt you've sent to a session; pick one to jump to that session.",
  },
  "screenshot.capture": {
    label: "Capture screenshot",
    description:
      "Start a native region capture (macOS only) — drag a region, then drop the thumbnail on a session to attach it.",
  },
};
