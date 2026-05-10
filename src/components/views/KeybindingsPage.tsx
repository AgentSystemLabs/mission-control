import { KeybindingsSettings } from "~/components/views/KeybindingsSettings";
import { SettingsSection } from "~/components/views/SettingsParts";

export function KeybindingsPage() {
  return (
    <>
      <SettingsSection
        title="Keybindings"
        subtitle="Rebind any global app shortcut. Bindings are saved per-app and apply immediately."
        headingLevel="h1"
      >
        <KeybindingsSettings />
      </SettingsSection>
    </>
  );
}
