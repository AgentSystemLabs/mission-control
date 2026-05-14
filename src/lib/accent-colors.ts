export type AccentColorId =
  | "deep-orange"
  | "blue"
  | "green"
  | "teal"
  | "cyan"
  | "purple"
  | "magenta"
  | "red"
  | "amber"
  | "lime"
  | "indigo"
  | "slate";

export type AccentColor = {
  id: AccentColorId;
  name: string;
  value: string;
  rgb: string;
  filter: string;
};

export const DEFAULT_ACCENT_COLOR: AccentColorId = "deep-orange";

export const ACCENT_COLORS: AccentColor[] = [
  {
    id: "deep-orange",
    name: "Deep orange",
    value: "#ff5a1f",
    rgb: "255, 90, 31",
    filter: "grayscale(1) sepia(1) saturate(5.6) hue-rotate(-20deg) brightness(1.08)",
  },
  {
    id: "blue",
    name: "Blue",
    value: "#3b82f6",
    rgb: "59, 130, 246",
    filter: "grayscale(1) sepia(1) saturate(5.2) hue-rotate(181deg) brightness(1.02)",
  },
  {
    id: "green",
    name: "Green",
    value: "#22c55e",
    rgb: "34, 197, 94",
    filter: "grayscale(1) sepia(1) saturate(4.8) hue-rotate(106deg) brightness(1)",
  },
  {
    id: "teal",
    name: "Teal",
    value: "#14b8a6",
    rgb: "20, 184, 166",
    filter: "grayscale(1) sepia(1) saturate(5) hue-rotate(139deg) brightness(0.98)",
  },
  {
    id: "cyan",
    name: "Cyan",
    value: "#06b6d4",
    rgb: "6, 182, 212",
    filter: "grayscale(1) sepia(1) saturate(5.6) hue-rotate(154deg) brightness(1)",
  },
  {
    id: "purple",
    name: "Purple",
    value: "#a855f7",
    rgb: "168, 85, 247",
    filter: "grayscale(1) sepia(1) saturate(5.3) hue-rotate(234deg) brightness(1.05)",
  },
  {
    id: "magenta",
    name: "Magenta",
    value: "#d946ef",
    rgb: "217, 70, 239",
    filter: "grayscale(1) sepia(1) saturate(5.7) hue-rotate(257deg) brightness(1.05)",
  },
  {
    id: "red",
    name: "Red",
    value: "#ef4444",
    rgb: "239, 68, 68",
    filter: "grayscale(1) sepia(1) saturate(5.5) hue-rotate(-36deg) brightness(1.04)",
  },
  {
    id: "amber",
    name: "Amber",
    value: "#f59e0b",
    rgb: "245, 158, 11",
    filter: "grayscale(1) sepia(1) saturate(5.2) hue-rotate(2deg) brightness(1.08)",
  },
  {
    id: "lime",
    name: "Lime",
    value: "#84cc16",
    rgb: "132, 204, 22",
    filter: "grayscale(1) sepia(1) saturate(4.7) hue-rotate(46deg) brightness(1.02)",
  },
  {
    id: "indigo",
    name: "Indigo",
    value: "#6366f1",
    rgb: "99, 102, 241",
    filter: "grayscale(1) sepia(1) saturate(5) hue-rotate(205deg) brightness(1.03)",
  },
  {
    id: "slate",
    name: "Slate",
    value: "#94a3b8",
    rgb: "148, 163, 184",
    filter: "grayscale(1) sepia(0.55) saturate(1.4) hue-rotate(178deg) brightness(1.02)",
  },
];

export function getAccentColor(id: string | null | undefined): AccentColor {
  return ACCENT_COLORS.find((color) => color.id === id) ?? ACCENT_COLORS[0]!;
}

export function isAccentColorId(value: unknown): value is AccentColorId {
  return typeof value === "string" && ACCENT_COLORS.some((color) => color.id === value);
}

export function applyAccentColor(id: string | null | undefined) {
  if (typeof document === "undefined") return;
  const color = getAccentColor(id);
  const root = document.documentElement;
  root.style.setProperty("--accent", color.value);
  root.style.setProperty("--accent-dim", `rgba(${color.rgb}, 0.18)`);
  root.style.setProperty("--accent-faint", `rgba(${color.rgb}, 0.1)`);
  root.style.setProperty("--accent-border", `rgba(${color.rgb}, 0.38)`);
  root.style.setProperty("--accent-glow", `rgba(${color.rgb}, 0.48)`);
  root.style.setProperty("--mc-theme-filter", color.filter);
}
