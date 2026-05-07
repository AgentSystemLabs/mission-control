import { useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon, type IconName } from "~/components/ui/Icon";
import { Kbd } from "~/components/ui/Kbd";
import { getElectron } from "~/lib/electron";
import { useHotkey } from "~/lib/use-hotkey";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import { ApiSettingsPage } from "./ApiSettingsPage";
import { KeybindingsPage } from "./KeybindingsPage";
import { StorageSettingsPage } from "./StorageSettingsPage";
import { LicenseSettingsPage } from "./LicenseSettingsPage";
import { SkillsSettingsPage } from "./SkillsSettingsPage";

export type SettingsPanelId =
  | "general"
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
        overflow: "hidden",
        background: "var(--surface-0)",
        boxShadow: "0 0 0 1px var(--border-strong)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}
      >
        <Btn
          variant="ghost"
          size="sm"
          icon="chevron-left"
          onClick={onBack}
          title="Back"
          aria-label="Back"
        >
          Back <Kbd variant="inline">Esc</Kbd>
        </Btn>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-dim)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            minWidth: 0,
          }}
        >
          <Icon name="settings" size={12} />
          <span>Settings</span>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }} className="dot-grid-bg">
        <aside
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          padding: "28px 12px",
          background: "var(--surface-0)",
          overflow: "auto",
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
      </aside>
        <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 80px" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {activePanel === "general" ? (
              <GeneralSettingsPage />
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
          </div>
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
        borderRadius: 7,
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: active ? "var(--text)" : "var(--text-dim)",
        border: `1px solid ${active ? "var(--border)" : "transparent"}`,
        background: active ? "var(--surface-1)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}
