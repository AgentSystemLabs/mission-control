import type { ITerminalOptions } from "@xterm/xterm";

const DEFAULT_CURSOR_COLOR = "#ff5a1f";

export type TerminalColorScheme = "dark" | "light";

type TerminalTheme = NonNullable<ITerminalOptions["theme"]>;

const TERMINAL_THEMES: Record<TerminalColorScheme, TerminalTheme> = {
  dark: {
    background: "#050607",
    foreground: "#e8e6df",
    black: "#0a0b0d",
    brightBlack: "#22262c",
    white: "#e8e6df",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#ffffff",
    foreground: "#1a1a1a",
    black: "#1a1a1a",
    brightBlack: "#6b6f76",
    red: "#b42318",
    brightRed: "#d92d20",
    green: "#087443",
    brightGreen: "#099250",
    yellow: "#a15c07",
    brightYellow: "#c07213",
    blue: "#175cd3",
    brightBlue: "#2e90fa",
    magenta: "#9e165f",
    brightMagenta: "#c11574",
    cyan: "#0e7090",
    brightCyan: "#06aed4",
    white: "#f1f0eb",
    brightWhite: "#ffffff",
  },
};

export function getTerminalColorScheme(): TerminalColorScheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function getCurrentAccentColor(fallback = DEFAULT_CURSOR_COLOR): string {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return fallback;
  }
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || fallback;
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1]!;
    const opacity = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${value}${opacity}`;
  }
  const rgb = color.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  return color;
}

export function createTerminalTheme({
  colorScheme = "dark",
  cursorColor = getCurrentAccentColor(),
}: {
  colorScheme?: TerminalColorScheme;
  cursorColor?: string;
} = {}): TerminalTheme {
  return {
    ...TERMINAL_THEMES[colorScheme],
    cursor: cursorColor,
    selectionBackground: withAlpha(
      getCurrentAccentColor(),
      colorScheme === "light" ? 0.26 : 0.22
    ),
  };
}

export function watchTerminalColorScheme(
  onChange: (colorScheme: TerminalColorScheme) => void
): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => undefined;
  }

  const currentKey = () => `${getTerminalColorScheme()}:${getCurrentAccentColor()}`;
  let previous = currentKey();
  const observer = new MutationObserver(() => {
    const next = currentKey();
    if (next === previous) return;
    previous = next;
    onChange(getTerminalColorScheme());
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style"],
  });
  return () => observer.disconnect();
}

export function createTerminalOptions({
  cursorColor = getCurrentAccentColor(),
  colorScheme = "dark",
}: {
  cursorColor?: string;
  colorScheme?: TerminalColorScheme;
} = {}): ITerminalOptions {
  return {
    fontFamily: 'Geist Mono, ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 12,
    lineHeight: 1.4,
    cursorBlink: true,
    theme: createTerminalTheme({ colorScheme, cursorColor }),
    allowProposedApi: true,
    scrollback: 5000,
  };
}
