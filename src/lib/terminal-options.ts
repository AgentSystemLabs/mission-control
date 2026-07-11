import type { ITerminalOptions } from "@xterm/xterm";
import {
  getCurrentTerminalAppearanceOptions,
  terminalAppearanceKey,
} from "~/lib/terminal-appearance";

const DEFAULT_CURSOR_COLOR = "#ff5a1f";

export const TERMINAL_FONT_FAMILY =
  'Geist Mono, ui-monospace, "SF Mono", Menlo, monospace';

// Themes may bundle their own terminal face (ember → JetBrains Mono). The face
// lives in a CSS var on <html> so the pre-hydration + CSS layers own it; xterm
// reads the resolved string here since it can't take a var() directly.
export function getCurrentTerminalFont(fallback = TERMINAL_FONT_FAMILY): string {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return fallback;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--mc-terminal-font")
    .trim();
  return raw || fallback;
}

export const TERMINAL_FONT_SIZE = 12;

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

// Ember lifts the terminal ground to a warm mid-gray (#2b2a27) where the
// stock dark ramp collapses: brightBlack #22262c — the color CLIs use for
// dim/secondary text — is the same tone as that ground (≈1.1:1, invisible),
// and xterm's default mid-brightness ANSI colors drop below readable. This
// warm ramp keeps every color ≥4.5:1 on the ember ground; brightBlack stays
// deliberately dim at ≈4:1.
const EMBER_TERMINAL_THEME: TerminalTheme = {
  // Fallback only — the live ground still comes from --terminal-bg.
  background: "#2b2a27",
  foreground: "#e9e3d5",
  black: "#21201d",
  brightBlack: "#8f8577",
  red: "#ea6962",
  brightRed: "#f08a84",
  green: "#a9b665",
  brightGreen: "#b6c375",
  yellow: "#d8a657",
  brightYellow: "#e0b169",
  blue: "#7daea3",
  brightBlue: "#8bbcb1",
  magenta: "#d3869b",
  brightMagenta: "#dd95a9",
  cyan: "#89b482",
  brightCyan: "#98c391",
  white: "#e9e3d5",
  brightWhite: "#f7f2e7",
};

// The flat theme (data-minimal) carries the warm sepia terminal ramp + bundled
// JetBrains Mono face and fills the terminal to the pane edge. (In light mode
// the flat theme uses the standard light ramp — see createTerminalTheme.)
function isFlatActive(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-minimal") === "true"
  );
}

// Transparency is scoped to flat DARK — the glass theme, the only mode whose
// canvas clear color actually carries alpha. It must stay off everywhere else:
// with allowTransparency on, xterm's glyph atlas rasterizes characters over a
// TRANSPARENT backing instead of the opaque cell color, so the anti-aliased
// edges lose ink. Light text on a dark ground hides it; dark ink on light
// paper turns visibly thin and washed out — glass on light was tried and
// rejected for exactly that reason, so flat LIGHT keeps an opaque canvas
// (and its pane ground stays solid; see [data-terminal-body] in styles.css).
export function terminalNeedsTransparency(
  colorScheme: TerminalColorScheme = getTerminalColorScheme()
): boolean {
  return colorScheme === "dark" && isFlatActive();
}

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
  if (!resolved) return fallback;
  // Chromium serializes computed colors that involve oklch()/color-mix() as
  // "color(srgb r g b)" — a form withAlpha() can't edit (it knows only #hex
  // and rgb()/rgba()), so alpha edits silently no-op on such colors (the flat
  // theme's transparent terminal ground shipped opaque this way). Round-trip
  // through a 2D canvas fillStyle, which normalizes any CSS color to #rrggbb
  // (or rgba() when it carries alpha).
  const ctx = document.createElement("canvas").getContext?.("2d");
  if (ctx) {
    ctx.fillStyle = resolved;
    return ctx.fillStyle || resolved;
  }
  return resolved;
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
  // Chromium serializes computed colors that involve oklch()/color-mix() as
  // "color(srgb r g b)" with 0..1 channels. resolveCssColor normalizes these
  // away, but handle the form here too so an alpha edit can never silently
  // no-op into an opaque color again.
  const srgb = color.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i
  );
  if (srgb) {
    const to255 = (v: string) =>
      Math.max(0, Math.min(255, Math.round(parseFloat(v) * 255)));
    return `rgba(${to255(srgb[1]!)}, ${to255(srgb[2]!)}, ${to255(srgb[3]!)}, ${alpha})`;
  }
  return color;
}

export function createTerminalTheme({
  colorScheme = "dark",
  cursorColor = getCurrentAccentColor(),
}: {
  colorScheme?: TerminalColorScheme;
  cursorColor?: string;
} = {}): TerminalTheme {
  const flatDark = terminalNeedsTransparency(colorScheme);
  const base = flatDark
    ? { ...TERMINAL_THEMES.dark, ...EMBER_TERMINAL_THEME }
    : TERMINAL_THEMES[colorScheme];
  // Honor --terminal-bg from CSS — the flat theme mixes the accent into the
  // ground, so the terminal carries a hint of the active theme.
  const background = getCurrentTerminalBackground(base.background ?? "#050607");
  return {
    ...base,
    // Flat DARK is the glass theme: the canvas clear color goes fully
    // transparent so the pane's translucent ground (painted by the
    // [data-terminal-body] CSS override) and the pattern behind it show
    // through the terminal itself. Requires allowTransparency (set in
    // createTerminalOptions). DARK ONLY — see terminalNeedsTransparency for
    // why flat-light keeps an opaque canvas.
    background: flatDark ? withAlpha(background, 0) : background,
    cursor: cursorColor,
    // The accent selection wash needs more alpha on the flat theme's mid-gray
    // ground than on the near-black painted ground to stay visible.
    selectionBackground: withAlpha(
      getCurrentAccentColor(),
      colorScheme === "light" ? 0.26 : flatDark ? 0.3 : 0.22
    ),
  };
}

export function watchTerminalColorScheme(
  onChange: (colorScheme: TerminalColorScheme) => void
): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => undefined;
  }

  const styleFlags = () => {
    const root = document.documentElement;
    const minimal = root.getAttribute("data-minimal") === "true" ? "1" : "0";
    // Surface tint feeds --terminal-bg (the flat theme mixes accent into the
    // ground, and Intense re-binds it to the warm-charcoal ladder), so a tint
    // change must re-theme the running terminal to match the chrome.
    const tint = root.getAttribute("data-tint") ?? "off";
    return `${minimal}:${tint}`;
  };
  // Font is part of the key so switching to/from the flat theme (which ships a
  // bundled face) re-fires and the consumer can restyle + refit the terminal.
  // Appearance (weights/line height/letter spacing) rides along the same way —
  // the settings page writes inline vars on <html>, which this observer sees.
  const currentKey = () =>
    `${getTerminalColorScheme()}:${getCurrentAccentColor()}:${getCurrentTerminalFont()}:${styleFlags()}:${terminalAppearanceKey()}`;
  let previous = currentKey();
  const observer = new MutationObserver(() => {
    const next = currentKey();
    if (next === previous) return;
    previous = next;
    onChange(getTerminalColorScheme());
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-minimal", "data-tint", "style"],
  });
  return () => observer.disconnect();
}

export function createTerminalOptions({
  cursorColor = getCurrentAccentColor(),
  colorScheme = "dark",
  fontSize = TERMINAL_FONT_SIZE,
}: {
  cursorColor?: string;
  colorScheme?: TerminalColorScheme;
  fontSize?: number;
} = {}): ITerminalOptions {
  const appearance = getCurrentTerminalAppearanceOptions();
  return {
    fontFamily: getCurrentTerminalFont(),
    fontSize,
    fontWeight: appearance.fontWeight,
    fontWeightBold: appearance.fontWeightBold,
    // 1.0 (the default) keeps multi-row ANSI art (OpenCode's startup wordmark,
    // box drawing, background fills) flush; users can trade that for air.
    lineHeight: appearance.lineHeight,
    letterSpacing: appearance.letterSpacing,
    cursorBlink: true,
    theme: createTerminalTheme({ colorScheme, cursorColor }),
    // Flat dark clears the canvas to transparent (glass panes over the
    // pattern ground); alpha in theme.background is ignored without this.
    // NOT constant: transparency degrades glyph antialiasing (see
    // terminalNeedsTransparency), so every opaque-canvas mode keeps it off.
    // A live theme switch flips it via term.options — the WebGL renderer
    // rebuilds its char atlas on any option change, so it applies in place.
    allowTransparency: terminalNeedsTransparency(colorScheme),
    allowProposedApi: true,
    scrollback: 5000,
  };
}

/** Wait until the terminal monospace face is measured before the first PTY write. */
export async function waitForTerminalFont(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try {
    await Promise.all([
      document.fonts.load(`${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`),
      document.fonts.ready,
    ]);
  } catch {
    /* best effort — xterm falls back to system monospace */
  }
}

type TerminalViewportSnapshot = {
  viewportY: number;
  atBottom: boolean;
};

type ScrollPreservingTerminal = {
  buffer?: {
    active?: {
      viewportY: number;
      baseY: number;
    };
  };
  scrollToBottom?: () => void;
  scrollToLine?: (line: number) => void;
};

function captureTerminalViewport(term: ScrollPreservingTerminal): TerminalViewportSnapshot | null {
  const active = term.buffer?.active;
  if (!active) return null;
  return {
    viewportY: active.viewportY,
    atBottom: active.viewportY >= active.baseY,
  };
}

function restoreTerminalViewport(
  term: ScrollPreservingTerminal,
  snapshot: TerminalViewportSnapshot | null,
): void {
  if (!snapshot) return;
  if (snapshot.atBottom) {
    term.scrollToBottom?.();
    return;
  }
  term.scrollToLine?.(snapshot.viewportY);
}

// The flat theme lets the terminal fill to the pane edge. xterm's FitAddon
// always reserves the scrollbar width — `overviewRuler?.width || 14` = 14px —
// on the right when scrollback is on, even though xterm 6's scrollbar is an
// overlay that needs no gutter. That reserved 14px is the visible strip between
// the terminal text and the pane edge. In flat we recompute cols reserving 0 so
// the content reaches the edge (the overlay scrollbar floats over the last
// column when it appears, which is fine); every other theme keeps the addon's
// default. Mirrors FitAddon.proposeDimensions via the same internals, with a
// fallback to the addon if those internals shift (e.g. an xterm upgrade).
function fitFillingScrollbarGutter(
  term: { cols: number; rows: number } & ScrollPreservingTerminal,
  fit: { fit: () => void },
): void {
  if (!isFlatActive()) {
    fit.fit();
    return;
  }
  const t = term as unknown as {
    element?: HTMLElement;
    resize?: (cols: number, rows: number) => void;
    _core?: {
      _renderService?: {
        dimensions?: { css?: { cell?: { width?: number; height?: number } } };
        clear?: () => void;
      };
    };
  };
  const cell = t._core?._renderService?.dimensions?.css?.cell;
  const parent = t.element?.parentElement;
  if (!cell?.width || !cell?.height || !parent || !t.resize) {
    fit.fit();
    return;
  }
  const ps = getComputedStyle(parent);
  const es = getComputedStyle(t.element!);
  const availH =
    parseInt(ps.getPropertyValue("height")) -
    (parseInt(es.getPropertyValue("padding-top")) +
      parseInt(es.getPropertyValue("padding-bottom")));
  const availW =
    Math.max(0, parseInt(ps.getPropertyValue("width"))) -
    (parseInt(es.getPropertyValue("padding-right")) +
      parseInt(es.getPropertyValue("padding-left")));
  const cols = Math.max(2, Math.floor(availW / cell.width));
  const rows = Math.max(1, Math.floor(availH / cell.height));
  if (Number.isNaN(cols) || Number.isNaN(rows)) {
    fit.fit();
    return;
  }
  if (term.cols !== cols || term.rows !== rows) {
    t._core?._renderService?.clear?.();
    t.resize(cols, rows);
  }
}

export function fitTerminalSurface(
  term: {
    cols: number;
    rows: number;
    refresh: (start: number, end: number) => void;
  } & ScrollPreservingTerminal,
  fit: { fit: () => void },
): void {
  const viewport = captureTerminalViewport(term);
  try {
    fitFillingScrollbarGutter(term, fit);
  } catch {
    /* container not measured yet */
  }
  restoreTerminalViewport(term, viewport);
  if (term.rows > 0) {
    term.refresh(0, term.rows - 1);
  }
}

export function applyTerminalFontSize(
  term: {
    options: { fontSize?: number };
    cols: number;
    rows: number;
    refresh: (start: number, end: number) => void;
  } & ScrollPreservingTerminal,
  fit: { fit: () => void },
  fontSize: number,
): void {
  if (term.options.fontSize === fontSize) return;
  term.options.fontSize = fontSize;
  fitTerminalSurface(term, fit);
}
