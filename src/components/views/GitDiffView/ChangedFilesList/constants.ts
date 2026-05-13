import type { CSSProperties } from "react";
import type { GitFileStatus } from "~/server/services/git";

const ADD = "#6cd07e";
const MOD = "#e8b94a";
const DEL = "#e06b6b";

export const MIN_PANEL_WIDTH = 240;

export const STATUS_META: Record<
  GitFileStatus,
  { letter: string; color: string }
> = {
  added: { letter: "A", color: ADD },
  modified: { letter: "M", color: MOD },
  deleted: { letter: "D", color: DEL },
  renamed: { letter: "R", color: MOD },
  copied: { letter: "C", color: MOD },
  untracked: { letter: "U", color: ADD },
  unmerged: { letter: "!", color: DEL },
  "type-changed": { letter: "T", color: MOD },
};

export function displayPath(p: string): { basename: string; dir: string } {
  const idx = p.lastIndexOf("/");
  if (idx < 0) return { basename: p, dir: "" };
  return { basename: p.slice(idx + 1), dir: p.slice(0, idx) };
}

export const textBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-dim)",
  cursor: "pointer",
  padding: "2px 6px",
  fontFamily: "var(--mono)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  flexShrink: 0,
};

export const iconBtnStyle: CSSProperties = {
  background: "transparent",
  border: 0,
  color: "var(--text-dim)",
  cursor: "pointer",
  padding: 3,
  borderRadius: 4,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

export const SECTION_TONES = {
  staged: {
    panel: "rgba(108, 208, 126, 0.08)",
    header: "rgba(108, 208, 126, 0.16)",
    border: "rgba(108, 208, 126, 0.22)",
    text: "#baf3c3",
    count: "rgba(186, 243, 195, 0.72)",
  },
  unstaged: {
    panel: "rgba(232, 185, 74, 0.08)",
    header: "rgba(232, 185, 74, 0.16)",
    border: "rgba(232, 185, 74, 0.22)",
    text: "#f3d58a",
    count: "rgba(243, 213, 138, 0.72)",
  },
} satisfies Record<
  "staged" | "unstaged",
  { panel: string; header: string; border: string; text: string; count: string }
>;
