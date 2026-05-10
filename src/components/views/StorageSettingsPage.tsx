import { useEffect, useState } from "react";
import { CodeBlock, Field, SettingsSection, useCopy } from "~/components/views/SettingsParts";
import { getElectron } from "~/lib/electron";

export function StorageSettingsPage() {
  const [userData, setUserData] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => {
    const electron = getElectron();
    if (!electron) {
      setReady(true);
      return;
    }
    void electron.getUserDataDir().then((dir) => {
      setUserData(dir);
      setReady(true);
    });
  }, []);

  return (
    <>
      {!ready ? (
        <SettingsSection title="Storage" headingLevel="h1">
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
            loading…
          </div>
        </SettingsSection>
      ) : userData ? (
        <SettingsSection title="Storage" headingLevel="h1">
          <Field label="Data directory">
            <CodeBlock
              value={userData}
              onCopy={() => copy(userData, "data")}
              copied={copied === "data"}
            />
          </Field>
        </SettingsSection>
      ) : (
        <SettingsSection title="Storage" headingLevel="h1">
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
            Storage details are only available in the desktop app.
          </div>
        </SettingsSection>
      )}
    </>
  );
}
