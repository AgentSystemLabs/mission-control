import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { KbdCombo } from "~/components/ui/Kbd";
import { AccentColorGrid } from "~/components/views/AccentColorPicker";
import { ThemeStylePreview } from "~/components/views/ThemeStylePreview";
import {
  ACCENT_CACHE_KEY,
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
  isAccentColorId,
  type AccentColorId,
} from "~/lib/accent-colors";
import { readCachedSurfaceTint } from "~/lib/surface-tint";
import {
  applyThemeStyle,
  readCachedThemeStyle,
  type ThemeStyle,
} from "~/lib/theme-style";
import {
  hasCompletedThemeOnboarding,
  markThemeOnboardingComplete,
} from "~/lib/theme-onboarding";
import { api } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";

const OVERLAY_Z_INDEX = 2147483646;

function readCachedAccent(): AccentColorId {
  if (typeof window === "undefined") return DEFAULT_ACCENT_COLOR;
  try {
    const value = window.localStorage.getItem(ACCENT_CACHE_KEY);
    return isAccentColorId(value) ? value : DEFAULT_ACCENT_COLOR;
  } catch {
    return DEFAULT_ACCENT_COLOR;
  }
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/**
 * First-launch gate: shows the theme picker over the app until the user
 * confirms a choice, then reveals the dashboard. Renders nothing on subsequent
 * launches. Mounted inside the (client-only) Shell, so `window` is available.
 *
 * Source of truth is the server-side `themeChosen` settings flag: the packaged
 * app serves the renderer from a localhost port that can shift between
 * launches, and each shift is a new origin with empty localStorage — so the
 * local flag alone kept resurrecting the picker. localStorage remains only as
 * a warm-start hint to skip the settings round-trip on the common path.
 */
export function ThemeOnboardingGate() {
  const { data: settings } = useSettings();
  const [dismissed, setDismissed] = useState(false);
  const [cachedDone] = useState<boolean>(() => hasCompletedThemeOnboarding());
  const themeChosen = settings?.themeChosen === true;

  // Re-seed the localStorage hint on this origin when the server already
  // knows a theme was chosen (e.g. a port change wiped the old origin's flag).
  useEffect(() => {
    if (themeChosen && !cachedDone) markThemeOnboardingComplete();
  }, [themeChosen, cachedDone]);

  if (dismissed || cachedDone || themeChosen) return null;
  // Settings not loaded yet: hold off rather than flash the picker at every
  // launch before the (authoritative) answer arrives.
  if (!settings) return null;
  return <ThemeOnboardingOverlay onDone={() => setDismissed(true)} />;
}

function ThemeOnboardingOverlay({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const subtitleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [color, setColor] = useState<AccentColorId>(() => readCachedAccent());
  const [style, setStyle] = useState<ThemeStyle>(() => readCachedThemeStyle());
  const [saving, setSaving] = useState(false);

  // Clicking a swatch live-applies the accent (CSS vars + cache) instantly.
  const selectColor = useCallback((next: AccentColorId) => {
    setColor(next);
    applyAccentColor(next);
  }, []);

  // Picking a style live-applies it instantly. Ember is built around its warm
  // terracotta accent, so selecting it defaults the swatch there (the user can
  // still pick another color afterward).
  const selectStyle = useCallback((next: ThemeStyle) => {
    setStyle(next);
    applyThemeStyle(next);
    if (next === "ember") {
      setColor("terracotta");
      applyAccentColor("terracotta");
    }
  }, []);

  const confirm = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    // The choice is already applied live + cached in localStorage; persist to
    // app settings so it survives a cache clear, then reveal the dashboard.
    try {
      const next = await api.updateSettings({
        accentColor: color,
        themeStyle: style,
      });
      queryClient.setQueryData(queryKeys.settings, next);
    } catch {
      // Best-effort: the live preview + localStorage caches already hold it.
    }
    markThemeOnboardingComplete();
    onDone();
  }, [color, style, onDone, queryClient, saving]);

  // Cmd/Ctrl+Enter confirms — the app-wide convention for modal confirms.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void confirm();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [confirm]);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const metaKeyLabel = isMacPlatform() ? "⌘" : "Ctrl";

  return (
    <div
      className="mc-theme-onboarding"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: OVERLAY_Z_INDEX,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        overflow: "auto",
        background:
          "radial-gradient(circle at 50% -10%, var(--accent-faint), transparent 55%), var(--bg)",
        // Keep the Electron window draggable while the picker covers the chrome;
        // the card opts back out so its controls stay clickable.
        ["WebkitAppRegion" as any]: "drag",
      }}
    >
      <CardFrame
        as="section"
        solid
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        tabIndex={-1}
        style={{
          width: "min(1040px, 100%)",
          maxHeight: "calc(100vh - 48px)",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          padding: 28,
          outline: "none",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.6)",
          ["WebkitAppRegion" as any]: "no-drag",
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1
            id={titleId}
            style={{
              margin: 0,
              fontSize: 21,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--text)",
            }}
          >
            Choose your theme
          </h1>
          <p
            id={subtitleId}
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--text-dim)",
            }}
          >
            Pick a style and an accent color to make Mission Control yours. You
            can change these anytime in Settings.
          </p>
        </header>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>Theme style</SectionLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            <StyleChoiceCard
              title="Painted"
              description="Pixel-art borders and shell imagery. The full Mission Control look."
              accentId={color}
              stylePreview="painted"
              selected={style === "painted"}
              onSelect={() => selectStyle("painted")}
            />
            <StyleChoiceCard
              title="Minimal"
              description="Clean CSS borders. Lighter on the eyes and faster to render."
              accentId={color}
              stylePreview="minimal"
              selected={style === "minimal"}
              onSelect={() => selectStyle("minimal")}
            />
            <StyleChoiceCard
              title="Noir"
              description="Flat near-black with hairline dividers. Borders only where they mean something."
              accentId={color}
              stylePreview="noir"
              selected={style === "noir"}
              onSelect={() => selectStyle("noir")}
            />
            <StyleChoiceCard
              title="Ember"
              description="Warm sepia, edge-to-edge square panes, and a clearer bundled mono. The focused session glows."
              accentId={color}
              stylePreview="ember"
              selected={style === "ember"}
              onSelect={() => selectStyle("ember")}
            />
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>Accent color</SectionLabel>
          <AccentColorGrid
            minimal={style !== "painted"}
            selected={color}
            onSelect={selectColor}
          />
        </section>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
          }}
        >
          <Btn
            ref={confirmRef}
            variant="primary"
            size="lg"
            onClick={() => void confirm()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Confirm"}
            <KbdCombo
              parts={[metaKeyLabel, "↵"]}
              variant="onPrimary"
              style={{ marginLeft: 8 }}
            />
          </Btn>
        </footer>
      </CardFrame>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--text-faint)",
      }}
    >
      {children}
    </div>
  );
}

function StyleChoiceCard({
  title,
  description,
  accentId,
  stylePreview,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  accentId: AccentColorId;
  stylePreview: ThemeStyle;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        position: "relative",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        cursor: "pointer",
        textAlign: "left",
        background: "var(--surface-1)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--mm-radius-lg, 10px)",
        boxShadow: selected ? "0 0 0 1px var(--accent) inset" : "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {selected && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 20,
            height: 20,
            borderRadius: 999,
            background: "var(--accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={12} />
        </span>
      )}
      <ThemeStylePreview
        style={stylePreview}
        accentId={accentId}
        tint={readCachedSurfaceTint()}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: selected ? "var(--text)" : "var(--text-dim)",
          }}
        >
          {title}
        </span>
        <span
          style={{ fontSize: 12, lineHeight: 1.45, color: "var(--text-faint)" }}
        >
          {description}
        </span>
      </div>
    </button>
  );
}
