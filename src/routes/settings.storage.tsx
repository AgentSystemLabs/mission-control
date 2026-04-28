import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CodeBlock, Field, SettingsSection, useCopy } from "~/components/views/SettingsParts";
import { getElectron } from "~/lib/electron";

export const Route = createFileRoute("/settings/storage")({
  component: StorageSettingsPage,
});

function StorageSettingsPage() {
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
      <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
        Storage
      </h1>
      {!ready ? (
        <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
          loading…
        </div>
      ) : userData ? (
        <SettingsSection title="Storage">
          <Field label="Data directory">
            <CodeBlock
              value={userData}
              onCopy={() => copy(userData, "data")}
              copied={copied === "data"}
            />
          </Field>
        </SettingsSection>
      ) : (
        <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
          Storage details are only available in the desktop app.
        </div>
      )}
    </>
  );
}
