import type { TaskAgent, TaskStatus } from "~/db/schema";

export const AGENT_META: Record<TaskAgent, { label: string; color: string; glyph: string; cmd: string }> = {
  "claude-code": { label: "Claude Code", color: "#d6a56b", glyph: "◆", cmd: "claude" },
  codex: { label: "Codex", color: "#8ab4ff", glyph: "◇", cmd: "codex" },
  "cursor-cli": { label: "Cursor CLI", color: "#c792ea", glyph: "▲", cmd: "cursor-agent" },
  shell: { label: "Shell", color: "#ff5a1f", glyph: "❯", cmd: "$SHELL" },
};

export const STATUS_META: Record<
  TaskStatus,
  { label: string; color: string; dot: boolean; shimmer: boolean }
> = {
  ready: { label: "Ready", color: "var(--status-ready)", dot: true, shimmer: false },
  running: { label: "Running", color: "var(--status-running)", dot: true, shimmer: true },
  "needs-input": { label: "Needs input", color: "var(--status-needs)", dot: true, shimmer: false },
  finished: { label: "Finished", color: "var(--status-done)", dot: true, shimmer: false },
  terminated: { label: "Terminated", color: "var(--status-idle)", dot: false, shimmer: false },
  disconnected: { label: "Disconnected", color: "var(--status-idle)", dot: true, shimmer: false },
};

export const ICON_COLORS = ["#ff5a1f", "#8ab4ff", "#c792ea", "#ff9466", "#f472b6", "#34d399", "#fb923c"];
export const GROUP_COLORS = ["#ff5a1f", "#8ab4ff", "#c792ea", "#ff9466", "#f472b6", "#34d399", "#fb923c"];
