import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { KeybindingsSettings } from "~/components/views/KeybindingsSettings";
import { api } from "~/lib/api";
import { getElectron } from "~/lib/electron";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [port, setPort] = useState<number | null>(null);
  const [userData, setUserData] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await api.getSettings();
    setToken(s.apiToken);
    const electron = getElectron();
    if (electron) {
      setPort(await electron.getRuntimePort());
      setUserData(await electron.getUserDataDir());
    } else {
      setPort(Number(window.location.port) || null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const regenerate = async () => {
    const r = await api.regenerateToken();
    setToken(r.apiToken);
  };

  const baseUrl = `http://127.0.0.1:${port ?? "PORT"}`;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 80px" }} className="dot-grid-bg">
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
          Settings
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
              <Btn
                variant="ghost"
                icon="refresh"
                onClick={regenerate}
                size="sm"
              >
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

        <SettingsSection
          title="Keybindings"
          subtitle="Rebind any global app shortcut. Bindings are saved per-app and apply immediately."
        >
          <KeybindingsSettings />
        </SettingsSection>

        {userData && (
          <SettingsSection title="Storage">
            <Field label="Data directory">
              <CodeBlock value={userData} onCopy={() => copy(userData, "data")} copied={copied === "data"} />
            </Field>
          </SettingsSection>
        )}
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 24,
        padding: 20,
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 12,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text)",
            marginBottom: 4,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--text-dim)",
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          fontWeight: 500,
          color: "var(--text-dim)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function CodeBlock({
  value,
  onCopy,
  copied,
  monoSize = 12,
}: {
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  monoSize?: number;
}) {
  return (
    <div
      style={{
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: "10px 12px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <pre
        style={{
          margin: 0,
          fontFamily: "var(--mono)",
          fontSize: monoSize,
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          flex: 1,
        }}
      >
        {value}
      </pre>
      {onCopy && (
        <button
          onClick={onCopy}
          style={{
            background: copied ? "var(--accent-dim)" : "transparent",
            border: "1px solid var(--border)",
            color: copied ? "var(--accent)" : "var(--text-dim)",
            padding: "4px 8px",
            borderRadius: 5,
            cursor: "pointer",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={11} />
          {copied ? "copied" : "copy"}
        </button>
      )}
    </div>
  );
}
