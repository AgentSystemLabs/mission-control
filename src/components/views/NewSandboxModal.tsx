import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Btn } from "~/components/ui/Btn";
import { Modal } from "~/components/ui/Modal";
import { TextField } from "~/components/ui/TextField";

const AWS_SIZE_OPTIONS = [
  { value: "t3.medium", label: "t3.medium", detail: "2 vCPU / 4 GiB" },
  { value: "t3.large", label: "t3.large", detail: "2 vCPU / 8 GiB" },
  { value: "t3.xlarge", label: "t3.xlarge", detail: "4 vCPU / 16 GiB" },
  { value: "t3.2xlarge", label: "t3.2xlarge", detail: "8 vCPU / 32 GiB" },
] as const;

const AWS_REGION_OPTIONS = [
  { value: "us-east-1", label: "US East", detail: "N. Virginia" },
  { value: "us-east-2", label: "US East", detail: "Ohio" },
  { value: "us-west-2", label: "US West", detail: "Oregon" },
  { value: "ca-central-1", label: "Canada", detail: "Central" },
  { value: "eu-west-1", label: "Europe", detail: "Ireland" },
  { value: "eu-west-2", label: "Europe", detail: "London" },
  { value: "eu-central-1", label: "Europe", detail: "Frankfurt" },
  { value: "ap-southeast-1", label: "Asia Pacific", detail: "Singapore" },
  { value: "ap-southeast-2", label: "Asia Pacific", detail: "Sydney" },
  { value: "ap-northeast-1", label: "Asia Pacific", detail: "Tokyo" },
] as const;

const PUBLIC_ACCESS_CIDR = "0.0.0.0/0";
const DEFAULT_IDLE_MINUTES = "30";

// The modal currently only provisions AWS EC2 sandboxes. The payload union still
// carries the other shapes so the create handler (and existing sandboxes) keep
// working; this modal just doesn't surface them.
export type NewSandboxPayload =
  | { name: string; kind: "local-docker" }
  | { name: string; kind: "remote-vm"; remoteAgentUrl: string; apiKey: string }
  | {
      name: string;
      kind: "remote-vm";
      deployProvider: "aws" | "digitalocean";
      region: string;
      size?: string;
      accessCidr?: string;
      /** Bootstrap script run on the VM after the agent is healthy (user_data.sh style). */
      setupScript?: string;
      /** "copy-host" pushes the user's ~/.ssh keys to the VM over the agent WS on connect. */
      gitAuthMode?: "none" | "copy-host";
      /** Pushes the host's Claude/Codex/Cursor/OpenCode logins to the VM on connect. */
      copyAgentCreds?: boolean;
      /** Stop the instance after this many idle minutes. 0 disables. */
      idleTimeoutMinutes?: number;
    }
  | { name: string; kind: "remote-vm"; deployProvider: "railway" };

const FIELD_LABEL_STYLE: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  fontWeight: 500,
  color: "var(--text-dim)",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string; detail: string }[];
}) {
  const id = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={id} style={FIELD_LABEL_STYLE}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          color: "var(--text)",
          padding: "9px 12px",
          fontFamily: "var(--mono)",
          fontSize: 13,
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} - {option.detail}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckboxRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: "var(--accent)" }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>{title}</div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            lineHeight: 1.4,
          }}
        >
          {description}
        </div>
      </div>
    </label>
  );
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
  const [awsRegion, setAwsRegion] = useState("us-east-1");
  const [awsSize, setAwsSize] = useState("t3.medium");
  const [onlyAllowMyIp, setOnlyAllowMyIp] = useState(true);
  const [accessCidr, setAccessCidr] = useState("");
  const [copySshKeys, setCopySshKeys] = useState(true);
  const [copyAgentCreds, setCopyAgentCreds] = useState(true);
  const [idleMinutes, setIdleMinutes] = useState(DEFAULT_IDLE_MINUTES);
  const [setupScript, setSetupScript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setupScriptId = useId();
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setAwsRegion("us-east-1");
    setAwsSize("t3.medium");
    setOnlyAllowMyIp(true);
    setAccessCidr("");
    setCopySshKeys(true);
    setCopyAgentCreds(true);
    setIdleMinutes(DEFAULT_IDLE_MINUTES);
    setSetupScript("");
    setError(null);
    setBusy(false);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [open]);

  const idleValid = idleMinutes.trim() === "" || /^\d+$/.test(idleMinutes.trim());

  const create = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || busy) return;
    if (!idleValid) {
      setError("Idle auto-stop must be a whole number of minutes (0 disables).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const idle = idleMinutes.trim() === "" ? 30 : Number.parseInt(idleMinutes.trim(), 10);
      await onCreate({
        name: trimmedName,
        kind: "remote-vm",
        deployProvider: "aws",
        region: awsRegion.trim(),
        size: awsSize.trim(),
        accessCidr: onlyAllowMyIp ? accessCidr.trim() || undefined : PUBLIC_ACCESS_CIDR,
        gitAuthMode: copySshKeys ? "copy-host" : "none",
        copyAgentCreds,
        idleTimeoutMinutes: Number.isFinite(idle) ? idle : 30,
        setupScript: setupScript.trim() ? setupScript : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canCreate = !!name.trim() && !!awsRegion.trim() && idleValid;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New AWS sandbox"
      width={560}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="primary" disabled={busy || !canCreate} onClick={() => void create()}>
            {busy ? "Deploying..." : "Deploy VM"}
          </Btn>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            const target = e.target as HTMLElement;
            if (
              target.closest("button, select, textarea") ||
              (target instanceof HTMLInputElement && target.type === "checkbox")
            ) {
              return;
            }
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

        <p style={{ color: "var(--text-dim)", fontSize: 11, margin: 0, lineHeight: 1.5 }}>
          Deploys an Ubuntu EC2 instance with the Mission Control agent installed on the host.
          Requires the AWS CLI installed and authenticated.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <SelectField label="Region" value={awsRegion} onChange={setAwsRegion} options={AWS_REGION_OPTIONS} />
          <SelectField label="Size" value={awsSize} onChange={setAwsSize} options={AWS_SIZE_OPTIONS} />
        </div>

        <CheckboxRow
          checked={copySshKeys}
          onChange={setCopySshKeys}
          title="Copy my SSH keys to the VM"
          description="Pushes readable ~/.ssh keys over the encrypted agent connection so the VM can clone your private repos."
        />

        <CheckboxRow
          checked={copyAgentCreds}
          onChange={setCopyAgentCreds}
          title="Copy my AI tool credentials"
          description="Pushes your Claude Code, Codex, Cursor & OpenCode logins to the VM so sessions work the moment it's ready. First use may prompt for Keychain access."
        />

        <CheckboxRow
          checked={onlyAllowMyIp}
          onChange={setOnlyAllowMyIp}
          title="Only allow my IP"
          description="Restricts the EC2 security group to your detected public IP."
        />
        {onlyAllowMyIp ? (
          <TextField
            label="Access CIDR"
            value={accessCidr}
            onChange={setAccessCidr}
            placeholder="Auto-detect"
            hint="Leave blank to detect your public IPv4 /32, or enter a specific CIDR."
            mono
          />
        ) : (
          <p style={{ color: "var(--text-dim)", fontSize: 11, margin: 0 }}>
            The agent port will be reachable from the public internet ({PUBLIC_ACCESS_CIDR}).
          </p>
        )}

        <TextField
          label="Auto-stop when idle (minutes)"
          value={idleMinutes}
          onChange={setIdleMinutes}
          placeholder={DEFAULT_IDLE_MINUTES}
          hint="Stops the EC2 instance after this many minutes with no agent activity. EBS storage is preserved. 0 disables."
          mono
          ariaInvalid={!idleValid}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label htmlFor={setupScriptId} style={FIELD_LABEL_STYLE}>
            Setup script (optional)
          </label>
          <textarea
            id={setupScriptId}
            value={setupScript}
            onChange={(e) => setSetupScript(e.target.value)}
            placeholder={"#!/usr/bin/env bash\napt-get install -y postgresql-client\n# runs as root after the agent is ready"}
            spellCheck={false}
            rows={5}
            style={{
              width: "100%",
              resize: "vertical",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: "var(--text)",
              padding: "9px 12px",
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
            Runs once on the VM (as root) after the agent is healthy. A non-zero exit is logged but won&apos;t
            fail provisioning.
          </span>
        </div>

        {error && (
          <p role="alert" style={{ color: "var(--status-failed)", fontSize: 12, margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
