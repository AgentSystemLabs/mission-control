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
    selectionBackground: "#ffd8c7",
  },
};

export function getTerminalColorScheme(): TerminalColorScheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function createTerminalTheme({
  colorScheme = "dark",
  cursorColor = DEFAULT_CURSOR_COLOR,
}: {
  colorScheme?: TerminalColorScheme;
  cursorColor?: string;
} = {}): TerminalTheme {
  return {
    ...TERMINAL_THEMES[colorScheme],
    cursor: cursorColor,
  };
}

export function watchTerminalColorScheme(
  onChange: (colorScheme: TerminalColorScheme) => void
): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => undefined;
  }

  let previous = getTerminalColorScheme();
  const observer = new MutationObserver(() => {
    const next = getTerminalColorScheme();
    if (next === previous) return;
    previous = next;
    onChange(next);
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

export function createTerminalOptions({
  cursorColor = DEFAULT_CURSOR_COLOR,
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
