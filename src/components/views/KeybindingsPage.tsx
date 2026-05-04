import { KeybindingsSettings } from "~/components/views/KeybindingsSettings";
import { SettingsSection } from "~/components/views/SettingsParts";

export function KeybindingsPage() {
  return (
    <>
      <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
        Keybindings
      </h1>
      <SettingsSection
        title="Keybindings"
        subtitle="Rebind any global app shortcut. Bindings are saved per-app and apply immediately."
      >
        <KeybindingsSettings />
      </SettingsSection>
    </>
  );
}
