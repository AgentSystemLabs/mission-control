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

// Resolve a CSS value (incl. color-mix, var()) to an rgb()/rgba() string the
// xterm.js canvas renderer can use. xterm doesn't accept var() or color-mix()
// directly — its theme.background sets the canvas clear color, which must be
// a concrete color value.
function resolveCssColor(cssValue: string, fallback: string): string {
  if (typeof document === "undefined" || !cssValue) return fallback;
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  probe.style.pointerEvents = "none";
  probe.style.color = cssValue;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  return resolved || fallback;
}

function getCurrentTerminalBackground(fallback: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return fallback;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--terminal-bg")
    .trim();
  if (!raw) return fallback;
  return resolveCssColor(raw, fallback);
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
  const base = TERMINAL_THEMES[colorScheme];
  // Honor --terminal-bg from CSS — minimal mode mixes the accent into the
  // ground at 10%, so the terminal carries a hint of the active theme.
  const background = getCurrentTerminalBackground(base.background ?? "#050607");
  return {
    ...base,
    background,
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

  const minimalFlag = () =>
    document.documentElement.getAttribute("data-minimal") === "true" ? "1" : "0";
  const currentKey = () =>
    `${getTerminalColorScheme()}:${getCurrentAccentColor()}:${minimalFlag()}`;
  let previous = currentKey();
  const observer = new MutationObserver(() => {
    const next = currentKey();
    if (next === previous) return;
    previous = next;
    onChange(getTerminalColorScheme());
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-minimal", "style"],
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
