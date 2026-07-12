import { useCallback, useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon, type IconName } from "~/components/ui/Icon";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { CLOSE_SETTINGS_EVENT } from "~/lib/design-meta";
import { useHotkey } from "~/lib/use-hotkey";
import { Z_INDEX } from "~/lib/z-index";
import { BetaSettingsPage } from "./BetaSettingsPage";
import { DefaultsSettingsPage } from "./DefaultsSettingsPage";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import { KeybindingsPage } from "./KeybindingsPage";
import { PetSettingsPage } from "./PetSettingsPage";
import { ProvidersSettingsPage } from "./ProvidersSettingsPage";
import { RecallSettingsPage } from "./RecallSettings";
import { SessionButtonsSettingsPage } from "./SessionButtonsSettingsPage";
import { TerminalSettingsPage } from "./TerminalSettingsPage";
import { ThemeSettingsPage } from "./ThemeSettingsPage";
import { TermsSettingsPage } from "./TermsSettingsPage";
import { UsageSettingsPage } from "./UsageSettingsPage";
import { VoiceCommandsPage } from "./VoiceCommandsPage";

// Single source of truth for settings panel ids lives in ./settings-panel-ids
// (a dependency-free module) so eager importers don't pin this whole panel into
// the entry chunk. Re-exported here for existing call sites.
export { SETTINGS_PANEL_IDS } from "./settings-panel-ids";
export type { SettingsPanelId } from "./settings-panel-ids";
import { SETTINGS_PANEL_IDS, type SettingsPanelId } from "./settings-panel-ids";
type NavItem = { id: SettingsPanelId; label: string; icon: IconName };

function normalizeStoredPanel(stored: string | null, fallback: SettingsPanelId): SettingsPanelId {
  if (stored === "sandbox") return "beta";
  // Recall's old "memory" panel id now maps to its restored "recall" page.
  if (stored === "memory") return "recall";
  if (stored && SETTINGS_PANEL_IDS.includes(stored as SettingsPanelId)) {
    return stored as SettingsPanelId;
  }
  return fallback;
}

// Settings panel slides in slightly slower than it slides out so the entrance
// feels weightier than the dismissal. Same timings used for the left nav and
// the right content pane.
const SLIDE_OUT_MS = 380;
const SLIDE_IN_MS = 480;
const SLIDE_OUT_EASE = "cubic-bezier(0.64, 0, 0.78, 0)";
const SLIDE_IN_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const SLIDE_OUT_LEFT = `mc-settings-slide-out-left ${SLIDE_OUT_MS}ms ${SLIDE_OUT_EASE} both`;
const SLIDE_IN_LEFT = `mc-settings-slide-in-left ${SLIDE_IN_MS}ms ${SLIDE_IN_EASE} both`;
const SLIDE_OUT_RIGHT = `mc-settings-slide-out-right ${SLIDE_OUT_MS}ms ${SLIDE_OUT_EASE} both`;
const SLIDE_IN_RIGHT = `mc-settings-slide-in-right ${SLIDE_IN_MS}ms ${SLIDE_IN_EASE} both`;
// The frosted scrim fades in/out in lockstep with the panels so the app behind
// dims as they arrive and brightens back as they leave.
const BACKDROP_IN = `mc-settings-backdrop-in ${SLIDE_IN_MS}ms ${SLIDE_IN_EASE} both`;
const BACKDROP_OUT = `mc-settings-backdrop-out ${SLIDE_OUT_MS}ms ${SLIDE_OUT_EASE} both`;

export function SettingsPanel({
  onBack,
  initialPanel = "general",
}: {
  onBack: () => void;
  initialPanel?: SettingsPanelId;
}) {
  const [activePanel, setActivePanel] = useState<SettingsPanelId>(() => {
    if (typeof window === "undefined") return initialPanel;
    const stored = window.localStorage.getItem("mc-settings-active-panel");
    return normalizeStoredPanel(stored, initialPanel);
  });
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("mc-settings-active-panel", activePanel);
  }, [activePanel]);

  const handleBack = useCallback(() => {
    setIsExiting((current) => (current ? current : true));
  }, []);

  useEffect(() => {
    const onCloseRequest = () => handleBack();
    window.addEventListener(CLOSE_SETTINGS_EVENT, onCloseRequest);
    return () => window.removeEventListener(CLOSE_SETTINGS_EVENT, onCloseRequest);
  }, [handleBack]);

  useHotkey("escape", handleBack, {
    preventDefault: false,
    allowWhenSettingsOpen: true,
  });

  const items: NavItem[] = [
    { id: "general", label: "General", icon: "settings" },
    { id: "defaults", label: "Defaults", icon: "terminal" },
    { id: "providers", label: "Providers", icon: "grid" },
    { id: "usage", label: "Usage", icon: "chart" },
    { id: "terminal", label: "Terminal", icon: "terminal" },
    { id: "session", label: "Session buttons", icon: "eye" },
    { id: "theme", label: "Theme", icon: "sun" },
    { id: "pet", label: "Pet", icon: "sparkles" },
    { id: "voice", label: "Voice", icon: "play" },
    { id: "keybindings", label: "Keybindings", icon: "settings" },
  ];

  return (
    <div
      data-navigation-swipe-blocker
      data-settings-overlay
      style={{
        position: "fixed",
        top: "var(--mc-workspace-top, 0px)",
        left: "var(--mc-workspace-left, 0px)",
        right: "var(--mc-workspace-right, 0px)",
        bottom: "var(--mc-workspace-bottom, 0px)",
        zIndex: Z_INDEX.settings,
        overflow: "hidden",
        background: "transparent",
      }}
    >
      <style>{`
        @keyframes mc-settings-slide-in-left {
          from { transform: translateX(-110%); }
          to { transform: translateX(0); }
        }
        @keyframes mc-settings-slide-in-right {
          from { transform: translateX(110%); }
          to { transform: translateX(0); }
        }
        @keyframes mc-settings-slide-out-left {
          from { transform: translateX(0); }
          to { transform: translateX(-110%); }
        }
        @keyframes mc-settings-slide-out-right {
          from { transform: translateX(0); }
          to { transform: translateX(110%); }
        }
        @keyframes mc-settings-backdrop-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes mc-settings-backdrop-out {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `}</style>
      {/*
       * Frosted scrim between the live app and the sliding panels. The app stays
       * mounted underneath (settings is a Shell-level overlay, not a route swap),
       * so this dims + blurs it so the panels read as floating on top instead of
       * revealing a black void. It's only fully visible mid-slide — once both
       * panels meet they cover the workspace, leaving just the 12px inset frame.
       */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          background: "rgba(0, 0, 0, 0.45)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          animation: isExiting ? BACKDROP_OUT : BACKDROP_IN,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          display: "flex",
          padding: 12,
          gap: 0,
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* Opaque backing so the translucent CardFrame reads as a solid panel
            rather than letting the app behind bleed through its surface; only
            the gap the panels open during the slide reveals the scrim. */}
        <div
          style={{
            width: 240,
            flexShrink: 0,
            display: "flex",
            minHeight: 0,
            background: "var(--bg)",
            animation: isExiting ? SLIDE_OUT_LEFT : SLIDE_IN_LEFT,
          }}
          onAnimationEnd={(e) => {
            if (isExiting && e.animationName === "mc-settings-slide-out-left") {
              onBack();
            }
          }}
        >
        <CardFrame
          as="aside"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "16px 6px",
            overflow: "auto",
          }}
        >
          <div style={{ padding: "0 10px 14px" }}>
            <StaticHotkeyTooltip hotkey="Esc" label="Back">
              <Btn
                variant="ghost"
                size="sm"
                icon="chevron-left"
                onClick={handleBack}
                aria-label="Back"
                style={{
                  width: "100%",
                  justifyContent: "flex-start",
                }}
              >
                Back
              </Btn>
            </StaticHotkeyTooltip>
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
              padding: "0 10px 12px",
            }}
          >
            Settings
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {items.map((item) => (
              <SettingsNavButton
                key={item.id}
                {...item}
                active={activePanel === item.id}
                onClick={() => setActivePanel(item.id)}
              />
            ))}
          </nav>
          <div
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-dim)",
                padding: "0 10px 8px",
              }}
            >
              Beta
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <SettingsNavButton
                id="beta"
                label="Experimental"
                icon="sparkles"
                active={activePanel === "beta"}
                onClick={() => setActivePanel("beta")}
              />
              <SettingsNavButton
                id="recall"
                label="Recall"
                icon="sparkles"
                active={activePanel === "recall"}
                onClick={() => setActivePanel("recall")}
              />
            </div>
          </div>
          <div
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-dim)",
                padding: "0 10px 8px",
              }}
            >
              Legal
            </div>
            <SettingsNavButton
              id="terms"
              label="Terms of Service"
              icon="shield"
              active={activePanel === "terms"}
              onClick={() => setActivePanel("terms")}
            />
          </div>
        </CardFrame>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            minHeight: 0,
            background: "var(--bg)",
            animation: isExiting ? SLIDE_OUT_RIGHT : SLIDE_IN_RIGHT,
          }}
        >
        <CardFrame
          as="section"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "24px 32px 80px",
            overflow: "auto",
          }}
        >
          {activePanel === "general" ? (
            <GeneralSettingsPage />
          ) : activePanel === "defaults" ? (
            <DefaultsSettingsPage />
          ) : activePanel === "providers" ? (
            <ProvidersSettingsPage />
          ) : activePanel === "usage" ? (
            <UsageSettingsPage />
          ) : activePanel === "terminal" ? (
            <TerminalSettingsPage />
          ) : activePanel === "session" ? (
            <SessionButtonsSettingsPage />
          ) : activePanel === "theme" ? (
            <ThemeSettingsPage />
          ) : activePanel === "pet" ? (
            <PetSettingsPage />
          ) : activePanel === "voice" ? (
            <VoiceCommandsPage />
          ) : activePanel === "recall" ? (
            <RecallSettingsPage />
          ) : activePanel === "beta" ? (
            <BetaSettingsPage />
          ) : activePanel === "keybindings" ? (
            <KeybindingsPage />
          ) : (
            <TermsSettingsPage />
          )}
        </CardFrame>
        </div>
      </div>
    </div>
  );
}

function SettingsNavButton({
  label,
  icon,
  active,
  onClick,
}: NavItem & { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 6,
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: active ? "var(--text)" : "var(--text-dim)",
        border: `1px solid ${active ? "var(--accent-border)" : "transparent"}`,
        background: active ? "var(--accent-dim)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.15s, border-color 0.15s, color 0.15s",
      }}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}
