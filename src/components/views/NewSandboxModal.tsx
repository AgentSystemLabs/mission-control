import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Btn } from "~/components/ui/Btn";
import { Modal } from "~/components/ui/Modal";
import { TextField } from "~/components/ui/TextField";
import type { SandboxKind } from "~/shared/sandbox";

export type NewSandboxPayload = {
  name: string;
  kind: SandboxKind;
  remoteAgentUrl?: string;
  apiKey?: string;
};

function optionStyle(selected: boolean): CSSProperties {
  return {
    flex: 1,
    padding: "9px 12px",
    borderRadius: 7,
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text)",
    background: selected ? "var(--accent-dim)" : "var(--surface-0)",
    border: `1px solid ${selected ? "var(--accent-border)" : "var(--border)"}`,
    fontSize: 13,
  };
}

export function NewSandboxModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: NewSandboxPayload) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SandboxKind>("local-docker");
  const [remoteAgentUrl, setRemoteAgentUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeLabelId = useId();
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setKind("local-docker");
    setRemoteAgentUrl("");
    setApiKey("");
    setError(null);
    setBusy(false);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [open]);

  const create = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = remoteAgentUrl.trim();
    const trimmedKey = apiKey.trim();
    if (!trimmedName || busy) return;
    if (kind === "remote-vm" && !trimmedUrl) {
      setError("Remote agent URL is required.");
      return;
    }
    if (kind === "remote-vm" && trimmedKey.length < 16) {
      setError("Remote API key must be at least 16 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: trimmedName,
        kind,
        remoteAgentUrl: kind === "remote-vm" ? trimmedUrl : undefined,
        apiKey: kind === "remote-vm" ? trimmedKey : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canCreate =
    !!name.trim() &&
    (kind === "local-docker" || (!!remoteAgentUrl.trim() && apiKey.trim().length >= 16));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New sandbox"
      width={560}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="primary" disabled={busy || !canCreate} onClick={() => void create()}>
            {busy ? "Creating..." : "Create"}
          </Btn>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            if ((e.target as HTMLElement).closest("button")) return;
            e.preventDefault();
            void create();
          }
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="Flexion, Client X, ..."
          autoFocus
          inputRef={nameInputRef}
        />
        <div role="group" aria-labelledby={typeLabelId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            id={typeLabelId}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Type
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              aria-pressed={kind === "local-docker"}
              onClick={() => setKind("local-docker")}
              style={optionStyle(kind === "local-docker")}
            >
              <strong>Local Docker</strong>
              <span style={{ display: "block", color: "var(--text-dim)", fontSize: 11, marginTop: 3 }}>
                Mission Control starts and manages a local container.
              </span>
            </button>
            <button
              type="button"
              aria-pressed={kind === "remote-vm"}
              onClick={() => setKind("remote-vm")}
              style={optionStyle(kind === "remote-vm")}
            >
              <strong>Remote VM</strong>
              <span style={{ display: "block", color: "var(--text-dim)", fontSize: 11, marginTop: 3 }}>
                Connect to an mc-agent you deploy on Railway or any VM.
              </span>
            </button>
          </div>
        </div>

        {kind === "remote-vm" && (
          <>
            <TextField
              label="Agent URL"
              value={remoteAgentUrl}
              onChange={setRemoteAgentUrl}
              placeholder="https://your-agent.up.railway.app"
              hint="HTTP(S) URLs are converted to WS(S). Prefer wss:// for public deployments."
              mono
              required
              ariaInvalid={!!error && !remoteAgentUrl.trim()}
            />
            <TextField
              label="API key"
              value={apiKey}
              onChange={setApiKey}
              placeholder="Paste the MC_AGENT_API_KEY value"
              type="password"
              hint="Use a long random secret. It is stored locally and never shown after save."
              mono
              autoComplete="off"
              spellCheck={false}
              required
              ariaInvalid={!!error && apiKey.trim().length < 16}
            />
            <p style={{ color: "var(--status-warning, var(--accent))", fontSize: 12, margin: 0 }}>
              A public agent URL exposes a shell, file, and git control plane to anyone who has this key.
              Use a tunnel, VPN, or private network when possible.
            </p>
          </>
        )}

        {error && <p role="alert" style={{ color: "var(--status-failed)", fontSize: 12, margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}
