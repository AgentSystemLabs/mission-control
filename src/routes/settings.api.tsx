import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CodeBlock, Field, SettingsSection, useCopy } from "~/components/views/SettingsParts";
import { api } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { queryKeys, settingsQueryOptions, useSettings } from "~/queries";

export const Route = createFileRoute("/settings/api")({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQueryOptions()),
  component: ApiSettingsPage,
});

function ApiSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const token = settings?.apiToken ?? null;
  const [port, setPort] = useState<number | null>(null);
  const { copied, copy } = useCopy();

  useEffect(() => {
    const electron = getElectron();
    if (electron) {
      void electron.getRuntimePort().then(setPort);
    } else {
      setPort(Number(window.location.port) || null);
    }
  }, []);

  const regenerate = async () => {
    const r = await api.regenerateToken();
    queryClient.setQueryData(queryKeys.settings, r);
  };

  const baseUrl = `http://127.0.0.1:${port ?? "PORT"}`;

  return (
    <>
      <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
        External API
      </h1>
      <SettingsSection
        title="External API"
        subtitle="External CLIs (Claude Code / Codex / Cursor CLI) post status updates here."
      >
        <Field label="Endpoint">
          <CodeBlock
            value={baseUrl}
            onCopy={() => copy(baseUrl, "endpoint")}
            copied={copied === "endpoint"}
          />
        </Field>
        <Field label="API Token">
          <CodeBlock
            value={token ?? "loading…"}
            onCopy={() => token && copy(token, "token")}
            copied={copied === "token"}
            monoSize={11}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <Btn variant="ghost" icon="refresh" onClick={regenerate} size="sm">
              Regenerate token
            </Btn>
          </div>
        </Field>
        <Field label="Example: mark a task finished">
          <CodeBlock
            value={`curl -H "Authorization: Bearer $TOKEN" \\\n  -X POST ${baseUrl}/api/tasks/$TASK_ID/status \\\n  -d '{"status":"finished","preview":"All tests passing"}'`}
            onCopy={() =>
              token &&
              copy(
                `curl -H "Authorization: Bearer ${token}" -X POST ${baseUrl}/api/tasks/$TASK_ID/status -d '{"status":"finished","preview":"All tests passing"}'`,
                "curl"
              )
            }
            copied={copied === "curl"}
            monoSize={11}
          />
        </Field>
      </SettingsSection>
    </>
  );
}
