import { useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon, type IconName } from "~/components/ui/Icon";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { getElectron } from "~/lib/electron";
import { useHotkey } from "~/lib/use-hotkey";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import { ApiSettingsPage } from "./ApiSettingsPage";
import { KeybindingsPage } from "./KeybindingsPage";
import { StorageSettingsPage } from "./StorageSettingsPage";
import { LicenseSettingsPage } from "./LicenseSettingsPage";
import { SkillsSettingsPage } from "./SkillsSettingsPage";
import { ThemeSettingsPage } from "./ThemeSettingsPage";

export type SettingsPanelId =
  | "general"
  | "theme"
  | "license"
  | "skills"
  | "api"
  | "keybindings"
  | "storage";
type NavItem = { id: SettingsPanelId; label: string; icon: IconName };

export function SettingsPanel({
  onBack,
  initialPanel = "general",
}: {
  onBack: () => void;
  initialPanel?: SettingsPanelId;
}) {
  const [isElectron, setIsElectron] = useState(false);
  const [activePanel, setActivePanel] = useState<SettingsPanelId>(initialPanel);

  useEffect(() => {
    setIsElectron(!!getElectron());
  }, []);

  useHotkey("escape", onBack, { preventDefault: false });

  const items: NavItem[] = [
    { id: "general", label: "General", icon: "settings" },
    { id: "theme", label: "Theme", icon: "sun" },
    { id: "license", label: "License", icon: "sparkles" },
    { id: "skills", label: "Skills", icon: "sparkles" },
    { id: "api", label: "External API", icon: "terminal" },
    { id: "keybindings", label: "Keybindings", icon: "settings" },
    ...(isElectron
      ? ([{ id: "storage", label: "Storage", icon: "folder" }] as NavItem[])
      : []),
  ];

  return (
    <div
      data-navigation-swipe-blocker
      style={{
        position: "fixed",
        top: "var(--mc-workspace-top, 0px)",
        left: "var(--mc-workspace-left, 0px)",
        right: 0,
        bottom: 0,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 12,
        overflow: "hidden",
        background: "var(--bg)",
        boxShadow: "0 0 0 1px var(--border-strong)",
      }}
      className="dot-grid-bg"
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          gap: 12,
          minHeight: 0,
        }}
      >
        <CardFrame
          as="aside"
          style={{
            width: 240,
            flexShrink: 0,
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
                onClick={onBack}
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
        </CardFrame>
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
          ) : activePanel === "theme" ? (
            <ThemeSettingsPage />
          ) : activePanel === "license" ? (
            <LicenseSettingsPage />
          ) : activePanel === "skills" ? (
            <SkillsSettingsPage />
          ) : activePanel === "api" ? (
            <ApiSettingsPage />
          ) : activePanel === "keybindings" ? (
            <KeybindingsPage />
          ) : (
            <StorageSettingsPage />
          )}
        </CardFrame>
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
