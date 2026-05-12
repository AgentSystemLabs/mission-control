import { useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CodeBlock, Field, SettingsSection, useCopy } from "~/components/views/SettingsParts";
import { api, setApiToken } from "~/lib/api";
import { getElectron } from "~/lib/electron";

export function ApiSettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [port, setPort] = useState<number | null>(null);
  const { copied, copy } = useCopy();

  useEffect(() => {
    const electron = getElectron();
    if (electron) {
      void electron.getRuntimePort().then(setPort).catch(() => {});
      void electron.getApiToken().then((t) => setToken(t ?? null)).catch(() => {});
    } else {
      setPort(Number(window.location.port) || null);
    }
  }, []);

  const regenerate = async () => {
    const r = await api.regenerateToken();
    if (r.apiToken) {
      setApiToken(r.apiToken);
      setToken(r.apiToken);
    }
  };

  const baseUrl = `http://127.0.0.1:${port ?? "PORT"}`;

  return (
    <>
      <SettingsSection
        title="External API"
        subtitle="External CLIs (Claude Code / Codex / Cursor CLI) post status updates here."
        headingLevel="h1"
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
