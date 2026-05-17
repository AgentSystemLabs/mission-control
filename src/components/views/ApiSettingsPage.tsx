import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CodeBlock, Field, SettingsSection, useCopy } from "~/components/views/SettingsParts";
import { getElectron } from "~/lib/electron";
import { setApiToken } from "~/lib/api";
import { queryKeys, useApiToken } from "~/queries";

export function ApiSettingsPage() {
  const queryClient = useQueryClient();
  const { data: token = null } = useApiToken();
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
    const electron = getElectron();
    if (!electron) return;
    const next = await electron.settings.regenerateToken();
    // Keep both the react-query cache and the module-level bearer cache
    // (src/lib/api.ts) in sync so subsequent fetches don't authenticate with
    // the now-stale token. The latter is the one src/lib/api.ts:req reads.
    setApiToken(next);
    queryClient.setQueryData(queryKeys.apiToken, next);
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
