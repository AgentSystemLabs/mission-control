import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { FormErrorBox } from "~/components/ui/FormErrorBox";
import { Modal } from "~/components/ui/Modal";
import { TextField } from "~/components/ui/TextField";
import { EscTooltip, HotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { normalizeRemoteAgentUrl } from "~/shared/sandbox";

const AGENT_INSTALL_COMMAND =
  "sudo npm install -g @agentsystemlabs/mission-control-agent@latest";

export type ConnectSandboxInput = {
  name: string;
  agentUrl: string;
  apiKey: string;
  agentCa: string | null;
};

/** Hex API key the user can paste straight into the agent's start command. */
function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const sectionLabelStyle = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  fontWeight: 500,
  color: "var(--text-dim)",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
} as const;

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 10px",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
      }}
    >
      <code
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          lineHeight: 1.5,
        }}
      >
        {command}
      </code>
      <Btn
        variant="ghost"
        size="sm"
        icon="copy"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(command);
          toast.success(`${label} copied`);
        }}
      />
    </div>
  );
}

export function ConnectSandboxDialog({
  open,
  busy,
  error,
  onClose,
  onConnect,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConnect: (input: ConnectSandboxInput) => Promise<void> | void;
}) {
  const [name, setName] = useState("Remote sandbox");
  const [agentUrl, setAgentUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [agentCa, setAgentCa] = useState("");
  const caId = useId();

  useEffect(() => {
    if (!open) return;
    setName("Remote sandbox");
    setAgentUrl("");
    setApiKey(generateApiKey());
    setAgentCa("");
  }, [open]);

  const urlInvalid = !!agentUrl.trim() && normalizeRemoteAgentUrl(agentUrl) === null;
  const canConnect =
    !!name.trim() && !!agentUrl.trim() && !urlInvalid && !!apiKey.trim() && !busy;

  const submit = async () => {
    if (!canConnect) return;
    await onConnect({
      name: name.trim(),
      agentUrl: agentUrl.trim(),
      apiKey: apiKey.trim(),
      agentCa: agentCa.trim() || null,
    });
  };

  useHotkey("dialog.submit", () => void submit(), { enabled: open });

  // Single-quoted so a pasted key with shell metacharacters can't change the
  // command's meaning when the user runs it on the sandbox.
  const shellKey = `'${(apiKey.trim() || "<api-key>").replace(/'/g, `'\\''`)}'`;
  const startCommand = `MC_AGENT_API_KEY=${shellKey} MC_WORKSPACE_ROOT=/workspace mission-control-agent`;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Connect a remote sandbox"
      width={600}
      footer={
        <>
          <EscTooltip label="Cancel">
            <Btn variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Btn>
          </EscTooltip>
          <HotkeyTooltip action="dialog.submit">
            <Btn
              variant="primary"
              icon="terminal"
              onClick={() => void submit()}
              disabled={!canConnect}
            >
              {busy ? "Connecting..." : "Connect sandbox"}
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Run the Mission Control agent on any machine you already have — a cloud VM, a home
          server, a spare laptop — then connect to it here and switch between Local and remote
          from the scope switcher.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={sectionLabelStyle}>1 · Install the agent on the sandbox</span>
          <CommandBlock label="Install command" command={AGENT_INSTALL_COMMAND} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={sectionLabelStyle}>2 · Start it with your API key</span>
          <CommandBlock label="Start command" command={startCommand} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)" }}>
            The agent listens on port 9333. Connections to machines other than localhost must use
            wss:// — put the agent behind TLS (reverse proxy or tunnel).
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabelStyle}>3 · Connect Mission Control</span>
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
            <TextField
              label="Sandbox name"
              value={name}
              onChange={setName}
              placeholder="Remote sandbox"
              autoFocus
              disabled={busy}
            />
            <TextField
              mono
              label="Agent URL"
              value={agentUrl}
              onChange={setAgentUrl}
              placeholder="wss://your-host:443/"
              ariaInvalid={urlInvalid}
              disabled={busy}
              hint={
                urlInvalid
                  ? "Use wss://host:port — plain ws:// only works for localhost."
                  : undefined
              }
            />
          </div>
          <TextField
            mono
            label="API key"
            value={apiKey}
            onChange={setApiKey}
            disabled={busy}
            hint="Pre-generated for the start command above — or paste the key your agent already uses."
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label htmlFor={caId} style={sectionLabelStyle}>
              CA certificate (optional)
            </label>
            <textarea
              id={caId}
              value={agentCa}
              onChange={(event) => setAgentCa(event.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----"
              rows={3}
              spellCheck={false}
              disabled={busy}
              aria-describedby={`${caId}-hint`}
              style={{
                width: "100%",
                resize: "vertical",
                background: "var(--surface-0)",
                border: "1px solid var(--border)",
                borderRadius: 7,
                color: "var(--text)",
                padding: "9px 12px",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                lineHeight: 1.5,
              }}
            />
            <span
              id={`${caId}-hint`}
              style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)" }}
            >
              Paste the agent's certificate (PEM) when it serves wss:// with a self-signed cert.
            </span>
          </div>
        </div>

        <FormErrorBox error={error} />
      </div>
    </Modal>
  );
}
