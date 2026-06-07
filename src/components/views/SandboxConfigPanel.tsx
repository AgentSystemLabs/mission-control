import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { Icon } from "~/components/ui/Icon";
import { TextField } from "~/components/ui/TextField";
import { SandboxApiKeyField } from "~/components/views/SandboxApiKeyField";
import { api } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { MAX_TCP_PORT } from "~/shared/tcp-port";
import {
  markSandboxStoppedInCache,
  markSandboxStoppingInCache,
  updateSandboxRemoteStatusInCache,
} from "~/lib/optimistic-sandbox";
import {
  isMissingRemoteInstanceError,
  mergeRemoteVmDeployLogs,
  remoteVmDeployJobForSandbox,
  remoteVmDeployStatusCopy,
} from "~/lib/remote-vm-deploy";
import { pruneStoredSessionFinishNotifications } from "~/lib/session-notification-store";
import { useTerminals } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { queryKeys, useProjects, useSandboxes } from "~/queries";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import type { RemoteVmLifecycleStatus, SandboxGitAuthMode } from "~/shared/sandbox";
import type {
  RemoteVmDeployJobSnapshot,
  RemoteVmDeployLogEntry,
  SandboxState,
} from "~/shared/electron-contract";

const SANDBOX_DELETE_CONFIRM_TEXT = "DELETE";

function formatConnectElapsed(since: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function statusBadge(
  state: SandboxState,
  kind: "remote-vm" | undefined,
  now = Date.now(),
): { label: string; color: string; connecting?: boolean } {
  const isRemote = kind === "remote-vm";
  const connectingColor = "var(--status-running)";
  switch (state.status) {
    case "disabled":
      return { label: "Not configured", color: "var(--text-dim)" };
    case "stopped":
      return {
        label: isRemote ? "Offline" : state.dockerAvailable ? "Stopped" : "Docker unavailable",
        color: "var(--text-dim)",
      };
    case "starting": {
      const elapsed = state.since ? formatConnectElapsed(state.since, now) : null;
      const base = isRemote ? `Connecting… ${state.step}` : `Starting… ${state.step}`;
      return {
        label: elapsed ? `${base} (${elapsed})` : base,
        color: connectingColor,
        connecting: true,
      };
    }
    case "running": {
      const elapsed = state.since ? formatConnectElapsed(state.since, now) : null;
      const base = isRemote ? "Connecting to agent…" : "Starting agent…";
      return {
        label: elapsed ? `${base} (${elapsed})` : base,
        color: connectingColor,
        connecting: true,
      };
    }
    case "connected":
      return { label: `Connected · agent ${state.version}`, color: "var(--accent)" };
    case "update-required":
      return {
        label: `Update available · ${state.version} → ${state.expectedVersion}`,
        color: "var(--status-warning, var(--accent))",
      };
    case "error":
      return { label: state.message, color: "var(--status-failed)" };
  }
}

function remoteVmStatusCopy(status: RemoteVmLifecycleStatus | string | null | undefined): {
  label: string;
  color: string;
} {
  switch (status) {
    case "provisioning":
      return { label: "Provisioning", color: "var(--status-running)" };
    case "ready":
      return { label: "Ready", color: "var(--accent)" };
    case "provisioning_failed":
      return { label: "Provisioning failed", color: "var(--status-failed)" };
    case "pausing":
      return { label: "Pausing", color: "var(--status-running)" };
    case "paused":
      return { label: "Paused", color: "var(--text-dim)" };
    case "pause_failed":
      return { label: "Pause failed", color: "var(--status-failed)" };
    case "resuming":
      return { label: "Resuming", color: "var(--status-running)" };
    case "resume_failed":
      return { label: "Resume failed", color: "var(--status-failed)" };
    case "destroy_failed":
      return { label: "Destroy failed", color: "var(--status-failed)" };
    case "missing":
      return { label: "Deleted on provider", color: "var(--status-failed)" };
    default:
      return { label: status ? String(status) : "Unknown", color: "var(--text-dim)" };
  }
}

function providerPauseHint(provider: string | null | undefined): string {
  if (provider === "aws") {
    return "EC2 compute billing stops after the instance reaches stopped, but EBS storage charges continue. AWS may assign a new public IP on resume.";
  }
  if (provider === "digitalocean") {
    return "DigitalOcean can still bill powered-off Droplet resources. Pause keeps the Droplet disk and IP reserved.";
  }
  if (provider === "railway") {
    return "Railway compute stops while the service, domain, and attached volume stay configured.";
  }
  return "Compute will stop while the remote workspace data remains configured.";
}

const sectionStyle: CSSProperties = {
  background: "var(--surface-0)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "14px 16px",
};

function ConfigSection({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section style={sectionStyle}>
      <div style={{ marginBottom: children || footer ? 12 : 0 }}>
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text)",
          }}
        >
          {title}
        </h3>
        {description && (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
            {description}
          </p>
        )}
      </div>
      {children && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>}
      {footer && <div style={{ marginTop: children ? 12 : 0, display: "flex", flexWrap: "wrap", gap: 8 }}>{footer}</div>}
    </section>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        gap: 4,
        padding: 3,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-1)",
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: 12,
              color: selected ? "var(--text)" : "var(--text-dim)",
              background: selected ? "var(--accent-dim)" : "transparent",
              boxShadow: selected ? "inset 0 0 0 1px var(--accent-border)" : "none",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function parsePortsInput(raw: string): number[] {
  const ports = new Set<number>();
  for (const token of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (Number.isInteger(start) && Number.isInteger(end) && start <= end) {
        for (let port = start; port <= end; port += 1) {
          if (port >= 1 && port <= MAX_TCP_PORT) ports.add(port);
        }
      }
      continue;
    }
    const port = Number(token);
    if (Number.isInteger(port) && port >= 1 && port <= MAX_TCP_PORT) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

function parseBuildArgsInput(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/[\n,]/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

function gitAuthHint(
  mode: SandboxGitAuthMode,
  connected: boolean,
  isRemote: boolean,
): string | null {
  if (mode === "none") return null;
  if (!connected) return isRemote ? "Connect first to configure git access." : "Start the sandbox first to configure git access.";
  if (mode === "generate") return "Add the generated public key to GitHub before cloning private repositories.";
  if (isRemote) {
    return "Uploads your local SSH keys from ~/.ssh into the remote sandbox. On shared VMs, prefer Generate instead.";
  }
  return "Uploads your local SSH keys from ~/.ssh into this sandbox.";
}

type SandboxConfigTab = "overview" | "agent" | "setup" | "git" | "danger" | "logs";

function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: SandboxConfigTab; label: string; badge?: number }[];
  active: SandboxConfigTab;
  onChange: (tab: SandboxConfigTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Sandbox settings sections"
      style={{
        display: "flex",
        gap: 2,
        padding: 3,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-0)",
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`sandbox-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`sandbox-panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "7px 10px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: 11,
              fontWeight: selected ? 600 : 500,
              letterSpacing: "0.02em",
              color: selected ? "var(--text)" : "var(--text-dim)",
              background: selected ? "var(--accent-dim)" : "transparent",
              boxShadow: selected ? "inset 0 0 0 1px var(--accent-border)" : "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.label}</span>
            {tab.badge != null && tab.badge > 0 && (
              <span
                aria-hidden
                style={{
                  fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                  color: selected ? "var(--accent)" : "var(--text-faint)",
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StatusSpinner({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        flexShrink: 0,
        color,
        animation: "spin 0.8s linear infinite",
      }}
    >
      <Icon name="refresh" size={12} />
    </span>
  );
}

function StatusStrip({
  badge,
  kindLabel,
  subtitle,
  detail,
  actions,
}: {
  badge: { label: string; color: string; connecting?: boolean };
  kindLabel: string;
  subtitle?: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-0)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-busy={badge.connecting || undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: badge.color,
              minWidth: 0,
            }}
          >
            {badge.connecting ? (
              <StatusSpinner color={badge.color} />
            ) : (
              <span
                style={{ width: 8, height: 8, borderRadius: 999, background: badge.color, flexShrink: 0 }}
                aria-hidden
              />
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{badge.label}</span>
          </span>
          {subtitle}
        </div>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--text-faint)",
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {kindLabel}
        </span>
      </div>
      {detail}
      {actions && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{actions}</div>}
    </div>
  );
}

function OverviewMetaRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: valueColor ?? "var(--text)",
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function SandboxConfigPanel({
  sandboxId,
  onDeleted,
}: {
  sandboxId: string;
  onDeleted?: () => void;
}) {
  const electron = getElectron()!;
  const sandbox = electron.sandbox;
  const clipboard = electron.clipboard;
  const queryClient = useQueryClient();
  const { data: scopes } = useSandboxes();
  const { data: allProjects } = useProjects();
  const terminals = useTerminals();
  const userTerminals = useUserTerminals();

  const selectedSandbox = useMemo(
    () => scopes?.sandboxes.find((s) => s.id === sandboxId) ?? null,
    [scopes?.sandboxes, sandboxId],
  );

  const scopedProjects = useMemo(
    () => {
      const projects = allProjects ?? [];
      const ownerProjectId = selectedSandbox?.projectId ?? null;
      if (ownerProjectId) return projects.filter((project) => project.id === ownerProjectId);
      return projects.filter((project) => project.sandboxId === sandboxId);
    },
    [allProjects, sandboxId, selectedSandbox?.projectId],
  );

  const [state, setState] = useState<SandboxState>({ status: "disabled" });
  const [connectionLogs, setConnectionLogs] = useState<string[]>([]);
  const [deployJobs, setDeployJobs] = useState<RemoteVmDeployJobSnapshot[]>([]);
  const [deployLogs, setDeployLogs] = useState<RemoteVmDeployLogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<SandboxConfigTab>("overview");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portsInput, setPortsInput] = useState("");
  const [buildArgsInput, setBuildArgsInput] = useState("");
  const [dockerfileInput, setDockerfileInput] = useState("");
  const [imageTagInput, setImageTagInput] = useState("");
  const [remoteUrlInput, setRemoteUrlInput] = useState("");
  const [remoteApiKeyInput, setRemoteApiKeyInput] = useState("");
  const [dfStatus, setDfStatus] = useState<string | null>(null);
  const [gitPubKey, setGitPubKey] = useState<string | null>(null);
  const [gitAuthBusy, setGitAuthBusy] = useState(false);
  const [gitKeyCopied, setGitKeyCopied] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [cloudBusy, setCloudBusy] = useState<"pausing" | "resuming" | null>(null);
  const [connectClock, setConnectClock] = useState(() => Date.now());
  const logRef = useRef<HTMLDivElement | null>(null);
  const deployLogJobIdRef = useRef<string | null>(null);
  const sandboxIdRef = useRef(sandboxId);

  useEffect(() => {
    sandboxIdRef.current = sandboxId;
  }, [sandboxId]);

  const deployJob = useMemo(
    () => remoteVmDeployJobForSandbox(deployJobs, sandboxId),
    [deployJobs, sandboxId],
  );

  useEffect(() => {
    setActiveTab("overview");
    setBuildArgsInput("");
    setRemoteApiKeyInput("");
    setDfStatus(null);
    setGitPubKey(null);
    setError(null);
    setDeleteOpen(false);
    setDeleteConfirmName("");
    setPauseOpen(false);
    setCloudBusy(null);
    setDeployLogs([]);
  }, [sandboxId]);

  useEffect(() => {
    if (!deployJob) return;
    if (
      deployJob.status === "queued" ||
      deployJob.status === "running" ||
      deployJob.status === "failed" ||
      deployJob.status === "canceled"
    ) {
      setActiveTab("logs");
    }
  }, [sandboxId, deployJob?.id, deployJob?.status]);

  useEffect(() => {
    if (!selectedSandbox || selectedSandbox.id !== sandboxId) return;
    setPortsInput(selectedSandbox.declaredPorts.join(", "));
    setDockerfileInput(selectedSandbox.dockerfilePath ?? "");
    setImageTagInput(selectedSandbox.imageTag ?? "");
    setRemoteUrlInput(selectedSandbox.remoteAgentUrl ?? "");
  }, [sandboxId, selectedSandbox?.id]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const status = await sandbox.status();
      if (!active) return;
      const id = sandboxIdRef.current;
      const found = id ? status.states.find((x) => x.sandboxId === id) : null;
      setState(found ? found.state : { status: "stopped", dockerAvailable: status.dockerAvailable });
    };
    void refresh();
    const offState = sandbox.onStateChange((e) => {
      if (e.sandboxId === sandboxIdRef.current) setState(e.state);
    });
    const offLog = sandbox.onLog((line) =>
      setConnectionLogs((prev) => [...prev.slice(-300), line]),
    );
    return () => {
      active = false;
      offState();
      offLog();
    };
  }, [sandbox, sandboxId]);

  useEffect(() => {
    deployLogJobIdRef.current = deployJob?.id ?? null;
  }, [deployJob?.id]);

  useEffect(() => {
    const remoteVm = electron.remoteVm;
    if (!remoteVm) {
      setDeployJobs([]);
      setDeployLogs([]);
      return;
    }
    let active = true;
    void remoteVm.listDeployJobs().then((nextJobs) => {
      if (active) setDeployJobs(nextJobs);
    });
    const offUpdate = remoteVm.onDeployUpdate((job) => {
      setDeployJobs((current) => {
        const without = current.filter((item) => item.id !== job.id);
        return [job, ...without].sort((a, b) => b.createdAt - a.createdAt);
      });
    });
    const offLog = remoteVm.onDeployLog((entry) => {
      if (entry.jobId !== deployLogJobIdRef.current) return;
      setDeployLogs((current) => mergeRemoteVmDeployLogs(current, [entry]));
    });
    return () => {
      active = false;
      offUpdate();
      offLog();
    };
  }, [electron]);

  useEffect(() => {
    const remoteVm = electron.remoteVm;
    if (!remoteVm || !deployJob) {
      setDeployLogs([]);
      return;
    }
    setDeployLogs((current) => current.filter((entry) => entry.jobId === deployJob.id));
    let active = true;
    void remoteVm.getDeployLogs(deployJob.id, 0).then((result) => {
      if (!active) return;
      setDeployLogs((current) =>
        mergeRemoteVmDeployLogs(
          current.filter((entry) => entry.jobId === deployJob.id),
          result.entries,
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [deployJob?.id, electron]);

  useEffect(() => {
    if (state.status !== "starting" && state.status !== "running") return;
    setConnectClock(Date.now());
    const timer = window.setInterval(() => setConnectClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.status, state.status === "starting" || state.status === "running" ? state.since : null]);

  useEffect(() => {
    if (activeTab !== "logs") return;
    const el = logRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (pinned) el.scrollTop = el.scrollHeight;
  }, [connectionLogs, deployLogs, activeTab]);

  const cancelRemoteDeploy = useCallback(async () => {
    if (!deployJob || !electron.remoteVm) return;
    const result = await electron.remoteVm.cancelDeploy(deployJob.id);
    if (!result.ok) toast.error(result.error);
  }, [deployJob, electron]);

  const patchSelected = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!selectedSandbox) return null;
      setSaving(true);
      setError(null);
      try {
        const { sandbox: next } = await api.updateSandbox(selectedSandbox.id, patch);
        queryClient.setQueryData(queryKeys.sandboxes, (current: typeof scopes | undefined) =>
          current
            ? {
                ...current,
                sandboxes: current.sandboxes.map((s) => (s.id === next.id ? next : s)),
              }
            : current,
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes });
        return next;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [queryClient, scopes, selectedSandbox],
  );

  const run = useCallback(
    async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        if (!r.ok) setError(r.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const savePorts = async () => {
    const declaredPorts = parsePortsInput(portsInput);
    await patchSelected({ declaredPorts });
    setPortsInput(declaredPorts.join(", "));
  };

  const saveBuildArgs = async () => {
    const buildArgs = parseBuildArgsInput(buildArgsInput);
    await patchSelected({ buildArgs });
    setBuildArgsInput("");
  };

  const saveImageTag = async () => {
    await patchSelected({ imageTag: imageTagInput.trim() || null });
  };

  const saveDockerImage = async () => {
    const dockerfileChanged = dockerfileInput.trim() !== (selectedSandbox?.dockerfilePath ?? "");
    if (dockerfileChanged) {
      await validateDockerfile();
    }
    await saveImageTag();
    if (buildArgsInput.trim()) await saveBuildArgs();
  };

  const saveRemoteConfig = async () => {
    if (!selectedSandbox) return;
    const remoteAgentUrl = remoteUrlInput.trim();
    const apiKey = remoteApiKeyInput.trim();
    if (!remoteAgentUrl) {
      setError("Remote agent URL is required.");
      return;
    }
    if (apiKey && apiKey.length < 16) {
      setError("Remote API key must be at least 16 characters.");
      return;
    }
    const urlChanged = remoteAgentUrl !== (selectedSandbox.remoteAgentUrl ?? "");
    const next = await patchSelected({
      remoteAgentUrl,
      ...(apiKey ? { apiKey } : {}),
    });
    if (!next) return;
    setRemoteApiKeyInput("");

    if (!urlChanged && !apiKey) return;

    setBusy(true);
    setError(null);
    try {
      const down = await sandbox.down(sandboxId);
      if (!down.ok) {
        setError(down.error);
        return;
      }
      const up = await sandbox.up(sandboxId);
      if (!up.ok) setError(up.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const validateDockerfile = async () => {
    const value = dockerfileInput.trim();
    if (!value) {
      setDfStatus(null);
      await patchSelected({ dockerfilePath: null });
      return;
    }
    const r = await sandbox.validateDockerfile(value);
    setDfStatus(r.exists ? (r.isDirectory ? "Directory found" : "Dockerfile found") : "Not found");
    await patchSelected({ dockerfilePath: value });
  };

  const setupGitAuth = async () => {
    if (!selectedSandbox) return;
    setGitAuthBusy(true);
    setGitPubKey(null);
    setError(null);
    try {
      const r = await sandbox.setupGitAuth(selectedSandbox.id);
      if (r.publicKey) setGitPubKey(r.publicKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGitAuthBusy(false);
    }
  };

  const setGitAuthMode = async (gitAuthMode: SandboxGitAuthMode) => {
    setGitPubKey(null);
    await patchSelected({ gitAuthMode });
  };

  const closeSandboxUi = useCallback(async () => {
    for (const project of scopedProjects) {
      await terminals.closeForProject(project.id);
      await userTerminals.closeForProject(project.id);
      pruneStoredSessionFinishNotifications({ type: "project", projectId: project.id });
    }
    await userTerminals.closeHomeForScope(sandboxId);
  }, [sandboxId, scopedProjects, terminals, userTerminals]);

  const deleteSandboxConfig = useCallback(async () => {
    if (!selectedSandbox || deleting) return;
    if (deleteConfirmName.trim() !== SANDBOX_DELETE_CONFIRM_TEXT) return;

    setDeleting(true);
    setError(null);
    try {
      await closeSandboxUi();

      const destroy = await sandbox.destroy(sandboxId);
      if (!destroy.ok) throw new Error(destroy.error);

      // Managed cloud VMs (AWS/DO/Railway) need provider teardown so billing stops.
      // Bring-your-own agents only store a URL + API key — skip the cloud CLI.
      const isManagedRemote =
        selectedSandbox.kind === "remote-vm" && !!selectedSandbox.remoteProvider;
      if (isManagedRemote && electron.remoteVm) {
        if (
          deployJob &&
          (deployJob.status === "queued" || deployJob.status === "running")
        ) {
          await electron.remoteVm.cancelDeploy(deployJob.id);
        }
        const terminated = await electron.remoteVm.destroy(sandboxId, { keepRow: true });
        // A "not found" termination means the instance is already gone — the
        // desired end state — so still delete the row instead of stranding it.
        if (!terminated.ok && !isMissingRemoteInstanceError(terminated.error)) {
          throw new Error(terminated.error);
        }
      }

      if (scopes?.activeScopeId === sandboxId) {
        await api.setActiveScope(LOCAL_SCOPE_ID);
        await sandbox.setActive(null);
      }

      await api.deleteSandbox(sandboxId);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);

      setDeleteOpen(false);
      onDeleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }, [
    deleteConfirmName,
    deployJob,
    deleting,
    electron,
    closeSandboxUi,
    onDeleted,
    queryClient,
    sandbox,
    sandboxId,
    scopedProjects,
    scopes?.activeScopeId,
    selectedSandbox,
  ]);

  const pauseRemoteVm = useCallback(async () => {
    if (!selectedSandbox || cloudBusy || !electron.remoteVm) return;
    const sandboxName = selectedSandbox.name;
    const wasActive = scopes?.activeScopeId === sandboxId;
    setCloudBusy("pausing");
    setError(null);
    markSandboxStoppingInCache(queryClient, sandboxId, { switchActiveToLocal: wasActive });
    if (wasActive) {
      await api.setActiveScope(LOCAL_SCOPE_ID).catch(() => undefined);
      await sandbox.setActive(null).catch(() => undefined);
    }
    try {
      await closeSandboxUi();
      const down = await sandbox.down(sandboxId);
      if (!down.ok) throw new Error(down.error);
      const paused = await electron.remoteVm.pause(sandboxId);
      if (!paused.ok) throw new Error(paused.error);
      markSandboxStoppedInCache(queryClient, sandboxId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes });
      setPauseOpen(false);
      toast.success(`${sandboxName} stopped`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updateSandboxRemoteStatusInCache(queryClient, sandboxId, {
        remoteStatus: "pause_failed",
        remoteStatusMessage: message,
      });
      setError(message);
    } finally {
      setCloudBusy(null);
    }
  }, [
    cloudBusy,
    closeSandboxUi,
    electron.remoteVm,
    queryClient,
    sandbox,
    sandboxId,
    scopes?.activeScopeId,
    selectedSandbox,
  ]);

  const resumeRemoteVm = useCallback(async () => {
    if (!selectedSandbox || cloudBusy || !electron.remoteVm) return;
    setCloudBusy("resuming");
    setError(null);
    try {
      const resumed = await electron.remoteVm.resume(sandboxId);
      if (!resumed.ok) throw new Error(resumed.error);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes });
      const up = await sandbox.up(sandboxId);
      if (!up.ok) throw new Error(up.error);
      toast.success("Remote VM resumed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloudBusy(null);
    }
  }, [cloudBusy, electron.remoteVm, queryClient, sandbox, sandboxId, selectedSandbox]);

  useEffect(() => {
    const isRemoteSandbox = selectedSandbox?.kind === "remote-vm";
    if (activeTab === "logs" && !isRemoteSandbox && connectionLogs.length === 0 && !deployJob) {
      setActiveTab("overview");
    }
  }, [activeTab, connectionLogs.length, deployJob, selectedSandbox?.kind]);

  useEffect(() => {
    const managed = selectedSandbox?.kind === "remote-vm" && !!selectedSandbox.remoteProvider;
    if (activeTab === "agent" && managed) {
      setActiveTab("overview");
    }
  }, [activeTab, selectedSandbox?.id, selectedSandbox?.kind, selectedSandbox?.remoteProvider]);

  if (!selectedSandbox) {
    return <p style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>Sandbox not found.</p>;
  }

  const isRemote = selectedSandbox.kind === "remote-vm";
  const badge = statusBadge(state, selectedSandbox.kind, connectClock);
  const connected = state.status === "connected";
  const canStart = state.status === "stopped" || state.status === "error";
  const connecting = state.status === "running" || state.status === "starting";
  const canStopLocal =
    connecting ||
    state.status === "connected" ||
    state.status === "update-required";
  // Remote VMs auto-reconnect on terminal/session use — only offer cancel while connecting.
  const canStop = isRemote ? connecting : canStopLocal;
  const stopLabel = isRemote ? "Cancel connection" : "Stop sandbox";
  const needsUpdate = state.status === "update-required";
  const gitHint = gitAuthHint(selectedSandbox.gitAuthMode, connected, isRemote);

  const remoteDirty =
    remoteUrlInput.trim() !== (selectedSandbox.remoteAgentUrl ?? "") || !!remoteApiKeyInput.trim();
  const dockerDirty =
    imageTagInput.trim() !== (selectedSandbox.imageTag ?? "") ||
    dockerfileInput.trim() !== (selectedSandbox.dockerfilePath ?? "") ||
    !!buildArgsInput.trim();
  const portsDirty = portsInput.trim() !== selectedSandbox.declaredPorts.join(", ");
  const deleteNameMatches = deleteConfirmName.trim() === SANDBOX_DELETE_CONFIRM_TEXT;
  const deployStatus = deployJob ? remoteVmDeployStatusCopy(deployJob) : null;
  const cloudStatus = remoteVmStatusCopy(selectedSandbox.remoteStatus);
  const managedRemote = isRemote && !!selectedSandbox.remoteProvider;
  const cloudActionBusy =
    cloudBusy !== null ||
    selectedSandbox.remoteStatus === "pausing" ||
    selectedSandbox.remoteStatus === "resuming";
  const canPauseVm =
    managedRemote &&
    selectedSandbox.remoteStatus !== "paused" &&
    selectedSandbox.remoteStatus !== "pausing" &&
    selectedSandbox.remoteStatus !== "resuming";
  const canResumeVm =
    managedRemote &&
    (selectedSandbox.remoteStatus === "paused" || selectedSandbox.remoteStatus === "resume_failed");
  const canCancelDeploy =
    deployJob?.status === "queued" || deployJob?.status === "running";
  const deployLogText =
    deployLogs.length > 0
      ? deployLogs.map((entry) => entry.data).join("")
      : deployJob
        ? "Waiting for deploy logs..."
        : "";
  const showLogsTab = isRemote || connectionLogs.length > 0;
  const logsTabBadge =
    deployJob?.status === "queued" || deployJob?.status === "running"
      ? undefined
      : connectionLogs.length > 0
        ? connectionLogs.length
        : deployLogs.length > 0
          ? deployLogs.length
          : undefined;

  const providerLabel = selectedSandbox.remoteProviderName ?? selectedSandbox.remoteProvider;
  const hasRemoteInfraIssue =
    managedRemote &&
    (!!selectedSandbox.remoteStatusMessage ||
      selectedSandbox.remoteStatus === "destroy_failed" ||
      selectedSandbox.remoteStatus === "provisioning_failed" ||
      selectedSandbox.remoteStatus === "pause_failed" ||
      selectedSandbox.remoteStatus === "resume_failed" ||
      selectedSandbox.remoteStatus === "missing");
  // Managed deploys persist URL + API key via the cloud CLI; BYO needs the Agent tab until both are saved.
  const needsAgentConfig =
    isRemote &&
    !managedRemote &&
    (!selectedSandbox.remoteAgentUrl || !selectedSandbox.hasApiKey);
  const showAgentTabBadge = needsAgentConfig && remoteDirty;

  const tabs: { id: SandboxConfigTab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    ...(needsAgentConfig ? [{ id: "agent" as const, label: "Agent", badge: showAgentTabBadge ? 1 : undefined }] : []),
    ...(isRemote ? [] : [{ id: "setup" as const, label: "Docker" }]),
    { id: "git", label: "Git" },
    ...(showLogsTab ? [{ id: "logs" as const, label: "Logs", badge: logsTabBadge }] : []),
    { id: "danger", label: "Danger" },
  ];

  const connectionActions = (
    <>
      {canStart && (
        <Btn
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => sandbox.up(selectedSandbox.id))}
        >
          {state.status === "error" ? "Retry connection" : isRemote ? "Connect" : "Start sandbox"}
        </Btn>
      )}
      {canStop && (
        <Btn variant="danger" size="sm" disabled={busy} onClick={() => void run(() => sandbox.down(selectedSandbox.id))}>
          {stopLabel}
        </Btn>
      )}
      {needsUpdate && !isRemote && (
        <Btn variant="primary" size="sm" disabled={busy} onClick={() => void run(() => sandbox.rebuild(selectedSandbox.id))}>
          Restart to update
        </Btn>
      )}
      {managedRemote && canPauseVm && (
        <Btn
          variant="gray-frame"
          size="sm"
          icon="stop"
          disabled={busy || cloudActionBusy || canCancelDeploy}
          onClick={() => setPauseOpen(true)}
        >
          {cloudBusy === "pausing" ? "Pausing…" : "Pause VM"}
        </Btn>
      )}
      {managedRemote && canResumeVm && (
        <Btn
          variant="primary"
          size="sm"
          icon="play"
          disabled={busy || cloudActionBusy || canCancelDeploy}
          onClick={() => void resumeRemoteVm()}
        >
          {cloudBusy === "resuming" ? "Resuming…" : "Resume VM"}
        </Btn>
      )}
    </>
  );

  const hasConnectionActions =
    canStart || canStop || (needsUpdate && !isRemote) || (managedRemote && (canPauseVm || canResumeVm));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 7,
            border: "1px solid color-mix(in srgb, var(--status-failed) 35%, var(--border))",
            background: "color-mix(in srgb, var(--status-failed) 8%, var(--surface-0))",
            color: "var(--status-failed)",
            fontSize: 12,
          }}
        >
          {error}
        </p>
      )}

      <StatusStrip
        badge={badge}
        kindLabel={isRemote ? "Remote VM" : "Local Docker"}
        subtitle={
          managedRemote ? (
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)" }}>
              {providerLabel}
              <span style={{ color: "var(--text-faint)", margin: "0 6px" }}>·</span>
              <span style={{ color: cloudStatus.color }}>VM {cloudStatus.label}</span>
            </span>
          ) : undefined
        }
        detail={
          hasRemoteInfraIssue ? (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "var(--status-failed)",
                lineHeight: 1.45,
                fontFamily: "var(--mono)",
                wordBreak: "break-word",
              }}
            >
              {selectedSandbox.remoteStatusMessage}
            </p>
          ) : undefined
        }
        actions={hasConnectionActions ? connectionActions : undefined}
      />

      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div
          role="tabpanel"
          id="sandbox-panel-overview"
          aria-labelledby="sandbox-tab-overview"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {managedRemote ? (
            <ConfigSection
              title="Provisioned agent"
              description="URL and API key were generated when this VM was deployed. Mission Control reconnects automatically after resume."
            >
              {selectedSandbox.remoteAgentUrl && (
                <OverviewMetaRow label="Agent URL" value={selectedSandbox.remoteAgentUrl} />
              )}
              {selectedSandbox.remotePublicAddress && (
                <OverviewMetaRow label="Public host" value={selectedSandbox.remotePublicAddress} />
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {selectedSandbox.remoteAgentUrl && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="copy"
                    onClick={() => {
                      void clipboard.writeText(selectedSandbox.remoteAgentUrl!);
                      toast.success("Agent URL copied");
                    }}
                  >
                    Copy agent URL
                  </Btn>
                )}
                {selectedSandbox.hasApiKey && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="copy"
                    onClick={async () => {
                      const revealed = await sandbox.revealApiKey(selectedSandbox.id);
                      if (!revealed.ok) {
                        toast.error(revealed.error);
                        return;
                      }
                      await clipboard.writeText(revealed.apiKey);
                      toast.success("API key copied");
                    }}
                  >
                    Copy API key
                  </Btn>
                )}
                {showLogsTab && (hasRemoteInfraIssue || state.status === "error" || connectionLogs.length > 0) && (
                  <Btn variant="ghost" size="sm" onClick={() => setActiveTab("logs")}>
                    View connection logs
                  </Btn>
                )}
              </div>
            </ConfigSection>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {needsAgentConfig
                ? "Connection controls are in the status card above. Set the agent URL and API key on the Agent tab."
                : isRemote
                  ? "Connection controls are in the status card above."
                  : "Use the status card above to start or stop this sandbox. Image, ports, and build settings are on the Docker tab."}
            </p>
          )}
        </div>
      )}

      {activeTab === "agent" && needsAgentConfig && (
        <div
          role="tabpanel"
          id="sandbox-panel-agent"
          aria-labelledby="sandbox-tab-agent"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <ConfigSection
            title="Agent endpoint"
            description="For agents you host yourself (not AWS/DO/Railway deploy). Use wss:// for public deployments."
            footer={
              <div style={{ width: "100%", display: "flex", justifyContent: "flex-end" }}>
                <Btn variant="primary" size="sm" disabled={saving || busy || !remoteDirty} onClick={() => void saveRemoteConfig()}>
                  Save
                </Btn>
              </div>
            }
          >
            <TextField
              label="Agent URL"
              ariaLabel="Remote agent URL"
              value={remoteUrlInput}
              onChange={setRemoteUrlInput}
              placeholder="https://your-agent.up.railway.app"
              mono
              required
              ariaInvalid={!!error && !remoteUrlInput.trim()}
            />
            <SandboxApiKeyField
              key={`${selectedSandbox.id}:${selectedSandbox.updatedAt}`}
              sandboxId={selectedSandbox.id}
              value={remoteApiKeyInput}
              onChange={setRemoteApiKeyInput}
              hasSavedKey={selectedSandbox.hasApiKey}
              onWriteClipboard={async (text) => {
                await clipboard.writeText(text);
              }}
              ariaInvalid={!!error && !!remoteApiKeyInput.trim() && remoteApiKeyInput.trim().length < 16}
            />
          </ConfigSection>
        </div>
      )}

      {activeTab === "setup" && !isRemote && (
        <div
          role="tabpanel"
          id="sandbox-panel-setup"
          aria-labelledby="sandbox-tab-setup"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <ConfigSection
            title="Docker image"
            description="Leave fields blank to use the bundled default sandbox image."
            footer={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="primary" size="sm" disabled={saving || !dockerDirty} onClick={() => void saveDockerImage()}>
                  Save image settings
                </Btn>
                <Btn variant="ghost" size="sm" disabled={saving} onClick={() => void validateDockerfile()}>
                  Validate Dockerfile
                </Btn>
              </div>
            }
          >
            <TextField
              label="Image tag"
              ariaLabel="Custom image tag"
              value={imageTagInput}
              onChange={setImageTagInput}
              placeholder="mission-control/sandbox-base:latest"
              mono
            />
            <TextField
              label="Dockerfile path"
              ariaLabel="Custom Dockerfile"
              value={dockerfileInput}
              onChange={setDockerfileInput}
              placeholder="/path/to/Dockerfile or build dir"
              hint={dfStatus ?? undefined}
              mono
            />
            <TextField
              label="Build args"
              ariaLabel="Build args"
              value={buildArgsInput}
              onChange={setBuildArgsInput}
              placeholder="NODE_VERSION=22, PNPM_VERSION=10"
              hint={
                selectedSandbox.buildArgKeys.length
                  ? `Existing keys: ${selectedSandbox.buildArgKeys.join(", ")}. Saving replaces the full set.`
                  : "Comma-separated KEY=value pairs."
              }
              mono
            />
          </ConfigSection>

          <ConfigSection
            title="Published ports"
            description="Each sandbox gets its own localhost port mapping. Services inside the container must listen on 0.0.0.0."
            footer={
              <Btn variant="primary" size="sm" disabled={saving || !portsDirty} onClick={() => void savePorts()}>
                Save ports
              </Btn>
            }
          >
            <TextField
              ariaLabel="Published ports"
              value={portsInput}
              onChange={setPortsInput}
              placeholder="3000,5173,8000 or 3000-3010"
              mono
            />
          </ConfigSection>
        </div>
      )}

      {activeTab === "danger" && (
        <div
          role="tabpanel"
          id="sandbox-panel-danger"
          aria-labelledby="sandbox-tab-danger"
        >
          <ConfigSection
            title="Danger zone"
            description="Permanently remove this sandbox and everything scoped to it."
            footer={
              <Btn
                variant="danger"
                size="sm"
                disabled={deleting}
                onClick={() => {
                  setDeleteConfirmName("");
                  setDeleteOpen(true);
                }}
              >
                Delete sandbox…
              </Btn>
            }
          />
        </div>
      )}

      {activeTab === "git" && (
        <div
          role="tabpanel"
          id="sandbox-panel-git"
          aria-labelledby="sandbox-tab-git"
        >
          <ConfigSection
            title="Git authentication"
            description="Required only for cloning private repositories inside this sandbox."
          >
            <SegmentedControl
              ariaLabel="Git authentication mode"
              value={selectedSandbox.gitAuthMode}
              disabled={saving}
              onChange={(mode) => void setGitAuthMode(mode)}
              options={[
                { value: "none", label: "None" },
                { value: "copy-host", label: "Upload local keys" },
                { value: "generate", label: "Generate key" },
              ]}
            />
            {selectedSandbox.gitAuthMode !== "none" && (
              <>
                <Btn
                  variant="ghost"
                  size="sm"
                  disabled={gitAuthBusy || !connected}
                  onClick={() => void setupGitAuth()}
                >
                  {gitAuthBusy
                    ? "Setting up…"
                    : selectedSandbox.gitAuthMode === "generate"
                      ? "Generate and show public key"
                      : "Upload local SSH keys"}
                </Btn>
                {gitHint && (
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>{gitHint}</p>
                )}
              </>
            )}
            {gitPubKey && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  padding: 10,
                }}
              >
                <code
                  style={{
                    flex: 1,
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    wordBreak: "break-all",
                    color: "var(--text)",
                  }}
                >
                  {gitPubKey}
                </code>
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void clipboard.writeText(gitPubKey);
                    setGitKeyCopied(true);
                    setTimeout(() => setGitKeyCopied(false), 1500);
                  }}
                >
                  {gitKeyCopied ? "Copied" : "Copy"}
                </Btn>
              </div>
            )}
          </ConfigSection>
        </div>
      )}

      {activeTab === "logs" && showLogsTab && (
        <div
          role="tabpanel"
          id="sandbox-panel-logs"
          aria-labelledby="sandbox-tab-logs"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {isRemote && deployJob && deployStatus && (
            <ConfigSection
              title="Remote VM deploy"
              description={
                deployJob.input.provider === "railway"
                  ? `${deployJob.input.name} · Railway`
                  : `${deployJob.input.name} · ${
                      deployJob.input.provider === "aws" ? "AWS EC2" : "DigitalOcean"
                    } · ${deployJob.input.region}`
              }
              footer={
                canCancelDeploy ? (
                  <Btn variant="ghost" size="sm" onClick={() => void cancelRemoteDeploy()}>
                    Cancel deploy
                  </Btn>
                ) : undefined
              }
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  role="status"
                  aria-live="polite"
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: deployStatus.color,
                  }}
                >
                  {deployStatus.label}
                </span>
                {deployJob.error && (
                  <p
                    role="alert"
                    style={{
                      margin: 0,
                      flex: "1 1 100%",
                      fontSize: 12,
                      lineHeight: 1.45,
                      color: "var(--status-failed)",
                    }}
                  >
                    {deployJob.error}
                  </p>
                )}
              </div>
              <pre
                role="log"
                aria-label="Remote VM deploy logs"
                aria-live="polite"
                aria-relevant="additions text"
                tabIndex={0}
                style={{
                  margin: 0,
                  maxHeight: 280,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  color: "var(--text-dim)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  lineHeight: 1.45,
                }}
              >
                {deployLogText}
              </pre>
            </ConfigSection>
          )}

          {connectionLogs.length > 0 && (
            <ConfigSection
              title={isRemote ? "Connection logs" : "Sandbox logs"}
              description={
                isRemote ? "Output from connecting to the remote agent." : undefined
              }
            >
              <div
                ref={logRef}
                style={{
                  maxHeight: 280,
                  overflow: "auto",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  color: "var(--text-dim)",
                }}
              >
                {connectionLogs.join("\n")}
              </div>
            </ConfigSection>
          )}

          {isRemote && !deployJob && connectionLogs.length === 0 && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
              No deploy or connection logs yet for this sandbox.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pauseOpen}
        onClose={() => {
          if (!cloudBusy) setPauseOpen(false);
        }}
        onConfirm={() => void pauseRemoteVm()}
        title={`Pause ${selectedSandbox.name}?`}
        confirmLabel="Pause VM"
        icon="stop"
        loading={cloudBusy === "pausing"}
        width={480}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            Mission Control will close the open terminals for this sandbox, disconnect from the agent, and stop provider compute.
          </p>
          <div
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid color-mix(in srgb, var(--status-warning, var(--accent)) 35%, var(--border))",
              background: "color-mix(in srgb, var(--status-warning, var(--accent)) 8%, var(--surface-0))",
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.55,
            }}
          >
            <strong style={{ color: "var(--text)", fontWeight: 600 }}>This keeps:</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              <li>The sandbox configuration and owning project link</li>
              <li>Disk or volume data for the remote workspace</li>
              <li>The ability to resume from this panel later</li>
            </ul>
            <p style={{ margin: "8px 0 0" }}>{providerPauseHint(selectedSandbox.remoteProvider)}</p>
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => {
          if (!deleting) {
            setDeleteOpen(false);
            setDeleteConfirmName("");
          }
        }}
        onConfirm={() => void deleteSandboxConfig()}
        title={`Delete ${selectedSandbox.name}?`}
        confirmLabel="Delete sandbox"
        icon="trash"
        loading={deleting}
        confirmDisabled={!deleteNameMatches}
        width={480}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            This permanently deletes the sandbox configuration and cannot be undone.
          </p>
          <div
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid color-mix(in srgb, var(--status-failed) 35%, var(--border))",
              background: "color-mix(in srgb, var(--status-failed) 8%, var(--surface-0))",
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.55,
            }}
          >
            <strong style={{ color: "var(--text)", fontWeight: 600 }}>This will also:</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {scopedProjects.length > 0 && (
                <li>
                  Close open terminals for {scopedProjects.map((p) => p.name).join(", ")}
                </li>
              )}
              {!isRemote && (
                <li>Stop the Docker container and delete its volumes (cloned repos and workspace data)</li>
              )}
              {managedRemote && (
                <li>Terminate the cloud VM and remove saved connection settings</li>
              )}
              {isRemote && !managedRemote && (
                <li>Remove saved agent URL and API key (your hosted agent is not stopped or deleted)</li>
              )}
            </ul>
          </div>
          <TextField
            label="Confirmation"
            ariaLabel="Type DELETE to delete this sandbox"
            value={deleteConfirmName}
            onChange={setDeleteConfirmName}
            placeholder={SANDBOX_DELETE_CONFIRM_TEXT}
            mono
            hint="Type DELETE to enable Delete sandbox."
            ariaInvalid={deleteConfirmName.trim().length > 0 && !deleteNameMatches}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
