import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { NewSandboxModal, type NewSandboxPayload } from "~/components/views/NewSandboxModal";
import { SandboxConfigModal } from "~/components/views/SandboxConfigModal";
import { LicenseEntryModal } from "~/components/views/LicenseEntryModal";
import { api, ApiError } from "~/lib/api";
import { getElectron, isElectron } from "~/lib/electron";
import {
  buildOptimisticRemoteVmSandbox,
  managedProviderFromDeployInput,
  mergeServerSandboxesPreservingPending,
  restoreSandboxesCache,
  upsertSandboxInCache,
  type SandboxesQueryData,
} from "~/lib/optimistic-sandbox";
import { remoteVmDeployJobForSandbox } from "~/lib/remote-vm-deploy";
import { setSandboxBusyState, type SandboxBusyMap, type SandboxBusyState } from "~/lib/sandbox-busy";
import { pruneStoredSessionFinishNotifications } from "~/lib/session-notification-store";
import { useHotkey } from "~/lib/use-hotkey";
import { useTerminals } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  licenseQueryOptions,
  queryKeys,
  sandboxesQueryOptions,
  useSandboxes,
  useScopedProjects,
} from "~/queries";
import { FREE_SANDBOX_CAP, isProTier } from "~/shared/license";
import { newClientId } from "~/shared/client-id";
import { LOCAL_SCOPE_ID, scopeToSandboxId, type SandboxPublicView } from "~/shared/sandbox";

const LOCAL_DOT = "var(--text-faint)";
const MESSAGE_TOAST_CLASS = "mc-toast-panel";

/**
 * A managed-remote status that means the cloud instance is (or may be) stopped.
 * The user resumes explicitly from the header so switching scopes never starts
 * provider compute as a side effect.
 */
function isResumableStatus(status: string | null | undefined): boolean {
  return status === "paused" || status === "pause_failed" || status === "resume_failed";
}

function isMissingRemoteInstanceError(message: string): boolean {
  return /InvalidInstanceID\.NotFound|instance ID .* does not exist|instance .* not found/i.test(message);
}

function isManagedAwsRemote(s: { kind: string; remoteProvider: string | null }): boolean {
  return s.kind === "remote-vm" && s.remoteProvider === "aws";
}

function isRunningManagedRemoteStatus(status: string | null | undefined): boolean {
  return status === "ready";
}

function attachedBtnClass(left?: boolean, right?: boolean): string | undefined {
  const classes = [
    left ? "mc-btn-attached-left" : null,
    right ? "mc-btn-attached-right" : null,
  ].filter(Boolean);
  return classes.length > 0 ? classes.join(" ") : undefined;
}

function ScopeItem({
  label,
  subtitle,
  color,
  active,
  onClick,
}: {
  label: string;
  subtitle: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "7px 8px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--accent-dim)" : "transparent",
    color: "var(--text)",
  };
  return (
    <button type="button" onClick={onClick} style={style} aria-current={active}>
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }}
      />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-faint)" }}>{subtitle}</span>
      {active && <Icon name="check" size={12} style={{ color: "var(--accent)" }} />}
    </button>
  );
}

/**
 * Shown when the user tries to switch into a paused remote VM. Offers the three
 * ways forward (resume / switch to Local / delete) instead of activating a scope
 * that can't run anything. Always mounted (toggled by `sandbox`) so the
 * Cmd+Enter→Resume hotkey hook stays unconditional, mirroring ConfirmDialog.
 */
function PausedSandboxModal({
  sandbox,
  deleting,
  onResume,
  onSwitchLocal,
  onDelete,
  onClose,
}: {
  sandbox: { id: string; name: string } | null;
  deleting: boolean;
  onResume: () => void;
  onSwitchLocal: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useHotkey(
    "mod+enter",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onResume();
    },
    { enabled: !!sandbox && !deleting },
  );
  return (
    <Modal
      open={!!sandbox}
      onClose={() => {
        if (!deleting) onClose();
      }}
      title={sandbox ? `${sandbox.name} is paused` : "Sandbox is paused"}
      width={460}
      footer={
        <>
          <Btn variant="ghost" onClick={onSwitchLocal} disabled={deleting}>
            Switch to Local
          </Btn>
          <Btn variant="danger" icon="trash" onClick={onDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete sandbox"}
          </Btn>
          <HotkeyTooltip action="dialog.submit">
            <Btn variant="primary" icon="refresh" onClick={onResume} disabled={deleting}>
              Resume
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
        This sandbox is paused and must be resumed before you can use it. Resume it to start the
        cloud VM and reconnect the agent, switch back to your Local workspace, or delete the
        sandbox entirely.
      </p>
    </Modal>
  );
}

/**
 * Header scope switcher: pick Local (host) or a sandbox. Selecting a scope
 * re-scopes the project list (the list filters on the active scope) and points
 * new work at that environment. Rendered only when sandboxes are enabled.
 */
export function ScopeDropdown() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useSandboxes();
  const { data: scopedProjects = [] } = useScopedProjects();
  const terminals = useTerminals();
  const userTerminals = useUserTerminals();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [checkingCreateAccess, setCheckingCreateAccess] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [missingRemoteSandbox, setMissingRemoteSandbox] = useState<{ id: string; name: string } | null>(null);
  // Set when the user tries to switch into a paused remote VM — the modal makes
  // them resume, switch back to Local, or delete it instead of silently loading a
  // dead scope.
  const [pausedPrompt, setPausedPrompt] = useState<{ id: string; name: string } | null>(null);
  const [deletingMissingRemote, setDeletingMissingRemote] = useState(false);
  const [teardownConfirmOpen, setTeardownConfirmOpen] = useState(false);
  // Per-sandbox busy state, keyed by sandbox id — NOT a single global flag, so
  // pausing/tearing down one sandbox never disables the controls of another and
  // multiple can be stopped concurrently.
  const [cloudBusy, setCloudBusy] = useState<SandboxBusyMap>({});
  // Switching into a managed cloud sandbox runs a provider reconcile that can take
  // several seconds — `switching` drives a centered connecting modal, `switchError`
  // the fallback dialog that offers a one-click return to Local.
  const [switching, setSwitching] = useState<{ id: string; name: string } | null>(null);
  const [switchError, setSwitchError] = useState<{ id: string; name: string; message: string } | null>(null);
  const switchAbortRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const deployCacheRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Optimistic rows for deploys that haven't persisted server-side yet, re-applied
  // after any mid-deploy refetch so the new sandbox never flickers out of the list.
  const pendingDeploysRef = useRef<Map<string, SandboxPublicView>>(new Map());

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  // Keep the main process's active scope in sync (it routes remote PTY/fs/git and
  // drives per-project runtime). Runs on load + whenever the selected scope changes.
  useEffect(() => {
    if (!data) return;
    void getElectron()?.sandbox.setActive(data.enabled ? scopeToSandboxId(data.activeScopeId) : null);
  }, [data?.activeScopeId, data?.enabled]);

  // Bucket dashboard "home" terminals under the active scope so switching
  // sandboxes shows that sandbox's terminals (a home terminal runs a shell ON
  // that machine). Sandboxes disabled → everything is Local.
  useEffect(() => {
    userTerminals.setHomeScopeId(data?.enabled ? data.activeScopeId : LOCAL_SCOPE_ID);
  }, [data?.activeScopeId, data?.enabled, userTerminals.setHomeScopeId]);

  useEffect(() => {
    if (!data || data.activeScopeId === LOCAL_SCOPE_ID) setConfigOpen(false);
  }, [data?.activeScopeId]);

  // When the switcher is opened, sync each managed AWS sandbox's saved status with
  // its real instance state so an idle-auto-stopped VM shows as Paused (and is
  // resumable) instead of silently appearing connected.
  useEffect(() => {
    if (!open) return;
    const electron = getElectron();
    if (!electron?.remoteVm?.reconcile) return;
    const remotes = (data?.sandboxes ?? []).filter(isManagedAwsRemote);
    if (remotes.length === 0) return;
    let cancelled = false;
    void (async () => {
      let anyChanged = false;
      for (const s of remotes) {
        try {
          const rec = await electron.remoteVm.reconcile(s.id);
          if (rec.ok && rec.changed) anyChanged = true;
        } catch {
          /* best-effort; leave last-known status */
        }
        if (cancelled) return;
      }
      if (anyChanged && !cancelled) void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const electron = getElectron();
    if (!electron?.remoteVm) return;

    // Refetch the server state but re-apply any still-pending deploy rows on top,
    // so a mid-deploy refresh can't drop the not-yet-persisted sandbox (or reset
    // the active scope away from it). Falls back to a plain invalidate when nothing
    // is pending.
    const refreshSandboxesPreservingPending = async () => {
      const pending = Array.from(pendingDeploysRef.current.values());
      if (pending.length === 0) {
        await qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
        return;
      }
      const clientActiveScopeId =
        qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes)?.activeScopeId ?? null;
      try {
        const fresh = await api.listSandboxes();
        qc.setQueryData<SandboxesQueryData>(
          queryKeys.sandboxes,
          mergeServerSandboxesPreservingPending(fresh, pending, clientActiveScopeId),
        );
      } catch {
        /* keep the optimistic state if the refresh fails */
      }
    };

    return electron.remoteVm.onDeployUpdate((job) => {
      const sandboxId = job.input.sandboxId;
      const managedProvider = managedProviderFromDeployInput(job.input.provider);
      if ((job.status === "queued" || job.status === "running") && sandboxId) {
        const current = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
        const existing = current?.sandboxes.find((sandbox) => sandbox.id === sandboxId);
        const optimistic = buildOptimisticRemoteVmSandbox({
          id: sandboxId,
          name: job.input.name,
          createdAt: job.createdAt,
          remoteProvider: managedProvider,
          remoteAgentUrl: existing?.remoteAgentUrl,
          remotePublicAddress: existing?.remotePublicAddress,
          remoteStatus: managedProvider ? "provisioning" : existing?.remoteStatus,
          remoteStatusMessage: existing?.remoteStatusMessage,
          hasApiKey: managedProvider ? true : existing?.hasApiKey,
        });
        pendingDeploysRef.current.set(sandboxId, optimistic);
        upsertSandboxInCache(qc, optimistic, { activate: current?.activeScopeId === sandboxId });
      }
      if (job.status === "succeeded" || job.status === "failed" || job.status === "canceled") {
        if (sandboxId) pendingDeploysRef.current.delete(sandboxId);
        if (deployCacheRefreshRef.current) {
          clearTimeout(deployCacheRefreshRef.current);
          deployCacheRefreshRef.current = null;
        }
      }
      if (job.status === "running" && sandboxId && managedProvider) {
        if (deployCacheRefreshRef.current) clearTimeout(deployCacheRefreshRef.current);
        deployCacheRefreshRef.current = setTimeout(() => {
          deployCacheRefreshRef.current = null;
          void refreshSandboxesPreservingPending();
        }, 20_000);
      }
      if (job.status === "succeeded" && sandboxId) {
        const current = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
        if (current?.activeScopeId === sandboxId) {
          void (async () => {
            try {
              await api.setActiveScope(sandboxId);
              await electron.sandbox.setActive(job.result?.sandboxId ?? sandboxId);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Failed to select deployed VM.");
            } finally {
              void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
            }
          })();
        } else {
          void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
        }
      } else if (job.status === "failed" || job.status === "canceled") {
        void (async () => {
          await qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
          const refreshed = await qc.fetchQuery(sandboxesQueryOptions());
          const persisted =
            sandboxId && refreshed.sandboxes.some((sandbox) => sandbox.id === sandboxId);
          if (persisted && sandboxId) {
            qc.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) =>
              current ? { ...current, activeScopeId: sandboxId } : current,
            );
            setConfigOpen(true);
          }
        })();
      }
      if (job.status === "succeeded") {
        toast.success(`${job.input.name} VM is ready`);
        return;
      }
      if (job.status === "failed") {
        toast.error(job.error ?? `${job.input.name} VM deploy failed`, {
          description: "Open sandbox settings → Logs for the full deploy output.",
          duration: 20_000,
        });
        return;
      }
      if (job.status === "canceled") {
        toast.message(`${job.input.name} VM deploy canceled`, {
          className: MESSAGE_TOAST_CLASS,
        });
      }
    });
  }, [qc]);

  useEffect(
    () => () => {
      if (deployCacheRefreshRef.current) clearTimeout(deployCacheRefreshRef.current);
    },
    [],
  );

  // Desktop-only, and only once the feature is enabled.
  if (!isElectron() || !data?.enabled) return null;

  const { sandboxes, activeScopeId } = data;
  const activeSandbox = sandboxes.find((s) => s.id === activeScopeId) ?? null;
  const isLocal = activeScopeId === LOCAL_SCOPE_ID || !activeSandbox;
  const label = isLocal ? "Local" : activeSandbox!.name;
  const activeColor = isLocal ? LOCAL_DOT : activeSandbox!.color ?? "var(--accent)";
  const activeManagedRemote = !!activeSandbox && isManagedAwsRemote(activeSandbox);
  // Only the ACTIVE sandbox's own busy state gates its controls — a pause/teardown
  // of a different sandbox must not disable this one's stop button.
  const activeBusy = activeSandbox ? cloudBusy[activeSandbox.id] : undefined;
  const activeDestroying = activeBusy === "destroying";
  const cloudActionBusy =
    activeBusy != null ||
    activeSandbox?.remoteStatus === "pausing" ||
    activeSandbox?.remoteStatus === "resuming";

  // Set/clear a single sandbox's busy state without touching any other's.
  const setSandboxBusy = (id: string, state: SandboxBusyState | null) =>
    setCloudBusy((prev) => setSandboxBusyState(prev, id, state));
  const activeSandboxResumable =
    activeManagedRemote && isResumableStatus(activeSandbox!.remoteStatus);
  const activeSandboxRunning =
    activeManagedRemote &&
    isRunningManagedRemoteStatus(activeSandbox!.remoteStatus) &&
    !cloudActionBusy;
  const activeSandboxStopped =
    activeManagedRemote && isResumableStatus(activeSandbox!.remoteStatus);
  const hasTrailingSandboxActions =
    activeSandboxResumable || activeSandboxRunning || activeSandboxStopped;

  const kindLabel = (kind: string) => (kind === "remote-vm" ? "Remote VM" : "Docker");

  const activateScope = async (scopeId: string) => {
    const previous = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
    qc.setQueryData(queryKeys.sandboxes, (current) =>
      current ? { ...current, activeScopeId: scopeId } : current,
    );
    try {
      await api.setActiveScope(scopeId);
      void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
      void router.navigate({ to: "/" });
    } catch (error) {
      restoreSandboxesCache(qc, previous);
      toast.error(error instanceof Error ? error.message : "Failed to switch sandbox.");
    }
  };

  const resumeAndActivate = async (sandbox: { id: string; name: string }) => {
    const electron = getElectron();
    if (!electron?.remoteVm?.resume) {
      await activateScope(sandbox.id);
      return;
    }
    const previousScopeId = activeScopeId;
    setResumingId(sandbox.id);
    // Activate the scope AND mark it resuming in one cache write so the user lands
    // on the resuming overlay immediately instead of waiting on the old scope.
    // Deliberately no invalidate here — an early refetch would clobber the
    // optimistic "resuming" status that drives the overlay.
    qc.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) =>
      current
        ? {
            ...current,
            activeScopeId: sandbox.id,
            sandboxes: current.sandboxes.map((s) =>
              s.id === sandbox.id ? { ...s, remoteStatus: "resuming" } : s,
            ),
          }
        : current,
    );
    // Persist the active scope; the activeScopeId effect syncs it to the main process.
    await api.setActiveScope(sandbox.id).catch(() => {});
    void router.navigate({ to: "/" });
    const toastId = toast.loading(`Resuming ${sandbox.name}…`, {
      description: "Starting the EC2 instance and reconnecting the agent.",
    });
    try {
      const res = await electron.remoteVm.resume(sandbox.id);
      if (!res.ok) throw new Error(res.error);
      // Resume done — refetch flips the status to running and clears the overlay.
      await qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
      toast.success(`${sandbox.name} resumed`, { id: toastId, description: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to resume ${sandbox.name}.`;
      if (isMissingRemoteInstanceError(message)) {
        toast.dismiss(toastId);
        setMissingRemoteSandbox(sandbox);
      } else {
        toast.error(message, {
          id: toastId,
          description: "Open sandbox settings → Logs for details.",
        });
      }
      // Don't strand the user on a sandbox that failed to resume — return them to
      // the scope they came from (when the resume wasn't started from it).
      if (previousScopeId !== sandbox.id) {
        await activateScope(previousScopeId);
      } else {
        void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
      }
    } finally {
      setResumingId(null);
    }
  };

  const pauseActiveRemoteVm = async () => {
    if (!activeSandbox || !activeSandboxRunning || cloudBusy[activeSandbox.id]) return;
    const electron = getElectron();
    if (!electron?.remoteVm?.pause) return;
    const sandboxId = activeSandbox.id;
    setSandboxBusy(sandboxId, "pausing");
    const toastId = toast.loading(`Stopping ${activeSandbox.name}…`, {
      description: "Pausing the EC2 instance and disconnecting the agent.",
    });
    try {
      for (const project of scopedProjects) {
        await terminals.closeForProject(project.id);
        await userTerminals.closeForProject(project.id);
      }
      const down = await electron.sandbox.down(activeSandbox.id);
      if (!down.ok) throw new Error(down.error);
      const paused = await electron.remoteVm.pause(activeSandbox.id);
      if (!paused.ok) throw new Error(paused.error);
      await qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
      toast.success(`${activeSandbox.name} stopped`, { id: toastId, description: undefined });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to stop ${activeSandbox.name}.`, {
        id: toastId,
        description: "Open sandbox settings → Logs for details.",
      });
      void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
    } finally {
      setSandboxBusy(sandboxId, null);
    }
  };

  const teardownSandbox = async (target: { id: string; name: string }) => {
    if (cloudBusy[target.id]) return;
    const electron = getElectron();
    if (!electron?.remoteVm) return;
    const isActive = activeScopeId === target.id;
    setSandboxBusy(target.id, "destroying");
    try {
      // Only the active scope has live terminals to close; a paused target has none.
      if (isActive) {
        for (const project of scopedProjects) {
          await terminals.closeForProject(project.id);
          await userTerminals.closeForProject(project.id);
          pruneStoredSessionFinishNotifications({ type: "project", projectId: project.id });
        }
      }

      const destroy = await electron.sandbox.destroy(target.id);
      if (!destroy.ok) throw new Error(destroy.error);

      const deployJobs = await electron.remoteVm.listDeployJobs();
      const deployJob = remoteVmDeployJobForSandbox(deployJobs, target.id);
      if (deployJob && (deployJob.status === "queued" || deployJob.status === "running")) {
        await electron.remoteVm.cancelDeploy(deployJob.id);
      }
      const terminated = await electron.remoteVm.destroy(target.id, { keepRow: true });
      if (!terminated.ok) throw new Error(terminated.error);

      if (isActive) {
        await api.setActiveScope(LOCAL_SCOPE_ID);
        await electron.sandbox.setActive(null);
        qc.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) =>
          current ? { ...current, activeScopeId: LOCAL_SCOPE_ID } : current,
        );
      }

      await api.deleteSandbox(target.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.sandboxes }),
        qc.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
      setTeardownConfirmOpen(false);
      setPausedPrompt(null);
      toast.success(`${target.name} torn down`);
      void router.navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to tear down ${target.name}.`);
    } finally {
      setSandboxBusy(target.id, null);
    }
  };

  const teardownActiveRemoteVm = async () => {
    if (!activeSandbox) return;
    await teardownSandbox(activeSandbox);
  };

  const deleteMissingRemoteSandbox = async () => {
    if (!missingRemoteSandbox || deletingMissingRemote) return;
    setDeletingMissingRemote(true);
    try {
      if (activeScopeId === missingRemoteSandbox.id) {
        await api.setActiveScope(LOCAL_SCOPE_ID);
        await getElectron()?.sandbox.setActive(null);
        qc.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) =>
          current ? { ...current, activeScopeId: LOCAL_SCOPE_ID } : current,
        );
      }
      await api.deleteSandbox(missingRemoteSandbox.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.sandboxes }),
        qc.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
      setMissingRemoteSandbox(null);
      toast.success(`${missingRemoteSandbox.name} removed from Mission Control.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete sandbox.");
    } finally {
      setDeletingMissingRemote(false);
    }
  };

  const pick = async (scopeId: string) => {
    setOpen(false);
    if (scopeId === activeScopeId) return;
    // Note: a sandbox that is resuming can still be switched into — the route
    // shows a resuming overlay until its agent is back. The resume keeps running
    // in the background regardless of which scope is active.
    const target = sandboxes.find((s) => s.id === scopeId) ?? null;
    const electron = getElectron();
    // A paused remote VM can't be used until it's resumed — intercept and prompt
    // instead of silently activating a dead scope. Managed AWS remotes reconcile
    // first (below) to confirm fresh status; other remotes use last-known status.
    if (
      target &&
      target.kind === "remote-vm" &&
      !isManagedAwsRemote(target) &&
      isResumableStatus(target.remoteStatus)
    ) {
      setPausedPrompt({ id: target.id, name: target.name });
      return;
    }
    // Managed AWS remotes can be idle-auto-stopped by the provider, so a cold
    // switch confirms status with an EC2 describe (reconcile) before activating.
    // But that round-trip takes seconds — and if the agent WebSocket is ALREADY
    // live (registry status connected/update-required) we know the VM is online
    // right now, so skip the describe and its connecting modal and switch
    // instantly. The dropdown's open-time reconcile keeps saved status fresh for
    // the genuinely-cold case below.
    const needsConnect = !!target && isManagedAwsRemote(target) && !!electron?.remoteVm?.reconcile;
    let showedSwitching = false;
    if (needsConnect) {
      const liveState = await electron!.sandbox.getState(scopeId).catch(() => null);
      const alreadyOnline =
        liveState?.status === "connected" || liveState?.status === "update-required";
      if (!alreadyOnline) {
        switchAbortRef.current = false;
        setSwitching({ id: scopeId, name: target!.name });
        showedSwitching = true;
        let status: string | null = target!.remoteStatus ?? null;
        try {
          const rec = await electron!.remoteVm.reconcile(scopeId);
          if (switchAbortRef.current) return; // user dismissed the connecting modal
          if (!rec.ok) throw new Error(rec.error);
          status = rec.status ?? status;
          if (rec.changed) void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
        } catch (error) {
          if (switchAbortRef.current) return;
          setSwitching(null);
          setSwitchError({
            id: scopeId,
            name: target!.name,
            message: error instanceof Error ? error.message : "Couldn't reach the cloud instance.",
          });
          return;
        }
        // Reconcile revealed the instance is stopped/paused — prompt instead of
        // activating a scope that can't actually run anything.
        if (isResumableStatus(status)) {
          setSwitching(null);
          void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
          setPausedPrompt({ id: scopeId, name: target!.name });
          return;
        }
      }
    }
    try {
      await activateScope(scopeId);
    } finally {
      if (showedSwitching) setSwitching(null);
    }
  };

  const cancelSwitch = () => {
    switchAbortRef.current = true;
    setSwitching(null);
  };

  const switchToLocalFromError = async () => {
    setSwitchError(null);
    await activateScope(LOCAL_SCOPE_ID);
  };

  // Paused-VM modal actions.
  const resumeFromPrompt = () => {
    if (!pausedPrompt) return;
    const target = pausedPrompt;
    setPausedPrompt(null);
    void resumeAndActivate(target); // drives its own resume toast + activation
  };
  const cancelPausedToLocal = () => {
    setPausedPrompt(null);
    if (activeScopeId !== LOCAL_SCOPE_ID) void activateScope(LOCAL_SCOPE_ID);
  };

  const create = async (payload: NewSandboxPayload) => {
    try {
      if ("deployProvider" in payload) {
        const electron = getElectron();
        if (!electron?.remoteVm) throw new Error("Remote VM deployment is only available in the desktop app.");
        const sandboxId = newClientId("sb");
        const managedProvider =
          payload.deployProvider === "aws" ||
          payload.deployProvider === "digitalocean" ||
          payload.deployProvider === "railway"
            ? payload.deployProvider
            : null;
        const optimisticSandbox = buildOptimisticRemoteVmSandbox({
          id: sandboxId,
          name: payload.name,
          remoteProvider: managedProvider,
          hasApiKey: !!managedProvider,
        });
        const previous = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
        upsertSandboxInCache(qc, optimisticSandbox, { activate: true });
        let jobId: string;
        try {
          if (payload.deployProvider === "railway") {
            ({ jobId } = await electron.remoteVm.startDeploy({
              provider: "railway",
              name: payload.name,
              activate: false,
              sandboxId,
            }));
          } else {
            const startInput = {
              name: payload.name,
              region: payload.region,
              size: payload.size,
              accessCidr: payload.accessCidr,
              activate: false,
              sandboxId,
            };
            ({ jobId } =
              payload.deployProvider === "aws"
                ? await electron.remoteVm.startDeploy({
                    ...startInput,
                    provider: "aws",
                    gitAuthMode: payload.gitAuthMode,
                    copyAgentCreds: payload.copyAgentCreds,
                    idleTimeoutMinutes: payload.idleTimeoutMinutes,
                    setupScript: payload.setupScript,
                  })
                : await electron.remoteVm.startDeploy({
                    ...startInput,
                    provider: "digitalocean",
                  }));
          }
        } catch (error) {
          restoreSandboxesCache(qc, previous);
          throw error;
        }
        toast.message(`Deploying ${payload.name} VM`, {
          className: MESSAGE_TOAST_CLASS,
          description: `Job ${jobId} is running. Open sandbox settings → Logs to follow progress.`,
        });
        setConfigOpen(true);
        void router.navigate({ to: "/" });
        return;
      }
      const { sandbox } = await api.createSandbox(payload);
      const previous = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
      upsertSandboxInCache(qc, sandbox, { activate: true });
      try {
        await api.setActiveScope(sandbox.id);
      } catch (error) {
        restoreSandboxesCache(qc, previous);
        toast.error(error instanceof Error ? error.message : "Sandbox created, but selection failed.");
      }
      void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
      void router.navigate({ to: "/" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setCreating(false);
        setPaywallOpen(true);
        return;
      }
      throw e;
    }
  };

  const openCreateSandbox = async () => {
    if (checkingCreateAccess) return;
    setCheckingCreateAccess(true);
    try {
      const latestLicense = await qc.ensureQueryData(licenseQueryOptions());
      const latestSandboxes = await qc.ensureQueryData(sandboxesQueryOptions());
      setOpen(false);
      if (!isProTier(latestLicense) && latestSandboxes.sandboxes.length >= FREE_SANDBOX_CAP) {
        setPaywallOpen(true);
        return;
      }
      setCreating(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to check sandbox access.");
    } finally {
      setCheckingCreateAccess(false);
    }
  };

  const showConfig = !isLocal && activeSandbox;

  return (
    <>
      <div
        ref={wrapRef}
        role="group"
        aria-label="Sandbox scope"
        style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 0 }}
      >
        <Btn
          variant="gray-frame"
          className={showConfig ? attachedBtnClass(false, true) : undefined}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title="Switch sandbox"
        >
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: "50%", background: activeColor, flexShrink: 0 }}
          />
          <span>{label}</span>
          <Icon name="chevron-down" size={11} style={{ color: "var(--text-faint)" }} />
        </Btn>

        {showConfig && (
          <Btn
            variant="gray-frame"
            className={attachedBtnClass(true, hasTrailingSandboxActions)}
            icon="settings"
            aria-label={`Configure ${activeSandbox!.name}`}
            title={`Configure ${activeSandbox!.name}`}
            onClick={() => setConfigOpen(true)}
            style={{ minWidth: 52, paddingInline: 0 }}
          />
        )}

        {activeSandboxResumable && (
          <Btn
            variant="primary"
            className={attachedBtnClass(true, activeSandboxStopped)}
            icon="play"
            aria-label={`Resume ${activeSandbox!.name}`}
            title={`Resume ${activeSandbox!.name}`}
            disabled={!!resumingId || cloudActionBusy}
            onClick={() => void resumeAndActivate({ id: activeSandbox!.id, name: activeSandbox!.name })}
            style={{ minWidth: 52, paddingInline: 0 }}
          />
        )}

        {activeSandboxRunning && (
          <Btn
            variant="gray-frame"
            className={attachedBtnClass(true, false)}
            icon="stop"
            aria-label={`Stop ${activeSandbox!.name}`}
            title={`Stop ${activeSandbox!.name}`}
            disabled={cloudActionBusy}
            onClick={() => void pauseActiveRemoteVm()}
            style={{ minWidth: 52, paddingInline: 0 }}
          />
        )}

        {activeSandboxStopped && (
          <Btn
            variant="danger"
            className={attachedBtnClass(true, false)}
            icon="trash"
            aria-label={`Tear down ${activeSandbox!.name}`}
            title={`Tear down ${activeSandbox!.name}`}
            disabled={cloudActionBusy || !!resumingId}
            onClick={() => setTeardownConfirmOpen(true)}
            style={{ minWidth: 52, paddingInline: 0 }}
          />
        )}

        {open && (
          <CardFrame
            glow
            solid
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              minWidth: 260,
              boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
              zIndex: 100,
              display: "flex",
              flexDirection: "column",
              padding: 4,
            }}
          >
            <ScopeItem
              label="Local"
              subtitle="Host"
              color={LOCAL_DOT}
              active={isLocal}
              onClick={() => void pick(LOCAL_SCOPE_ID)}
            />
            {sandboxes.map((s) => {
              const resuming = resumingId === s.id || s.remoteStatus === "resuming";
              const paused = !resuming && isResumableStatus(s.remoteStatus);
              const subtitle = resuming
                ? "Resuming…"
                : paused
                  ? "Paused"
                  : kindLabel(s.kind);
              return (
                <ScopeItem
                  key={s.id}
                  label={s.name}
                  subtitle={subtitle}
                  color={s.color ?? "var(--accent)"}
                  active={s.id === activeScopeId}
                  onClick={() => void pick(s.id)}
                />
              );
            })}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
              <button
                type="button"
                onClick={() => void openCreateSandbox()}
                disabled={checkingCreateAccess}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 8px",
                  borderRadius: 6,
                  border: "none",
                  cursor: checkingCreateAccess ? "wait" : "pointer",
                  background: "transparent",
                  color: checkingCreateAccess ? "var(--text-faint)" : "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                <Icon name="plus" size={12} />
                <span>{checkingCreateAccess ? "Checking..." : "New sandbox"}</span>
              </button>
            </div>
          </CardFrame>
        )}
      </div>

      <SandboxConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        sandboxId={activeSandbox?.id ?? null}
      />

      <NewSandboxModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={create}
      />

      <LicenseEntryModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="paywall"
        paywallContext="sandboxes"
      />

      <ConfirmDialog
        open={teardownConfirmOpen}
        onClose={() => {
          if (!activeDestroying) setTeardownConfirmOpen(false);
        }}
        onConfirm={() => void teardownActiveRemoteVm()}
        title={activeSandbox ? `Tear down ${activeSandbox.name}?` : "Tear down sandbox?"}
        confirmLabel="Tear down"
        icon="trash"
        loading={activeDestroying}
        width={460}
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
          This terminates the cloud VM, removes the sandbox configuration, and deletes scoped projects from Mission
          Control.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!missingRemoteSandbox}
        onClose={() => {
          if (!deletingMissingRemote) setMissingRemoteSandbox(null);
        }}
        onConfirm={() => void deleteMissingRemoteSandbox()}
        title={missingRemoteSandbox ? `${missingRemoteSandbox.name} was deleted` : "Sandbox was deleted"}
        confirmLabel="Delete local record"
        icon="trash"
        loading={deletingMissingRemote}
        width={460}
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
          The cloud instance for this sandbox no longer exists, so Mission Control cannot resume it. You can keep the
          sandbox record for troubleshooting, or delete just the local SQLite record now.
        </p>
      </ConfirmDialog>

      <PausedSandboxModal
        sandbox={pausedPrompt}
        deleting={!!pausedPrompt && cloudBusy[pausedPrompt.id] === "destroying"}
        onResume={resumeFromPrompt}
        onSwitchLocal={cancelPausedToLocal}
        onDelete={() => pausedPrompt && void teardownSandbox(pausedPrompt)}
        onClose={() => setPausedPrompt(null)}
      />

      <Modal
        open={!!switching}
        onClose={cancelSwitch}
        title={switching ? `Connecting to ${switching.name}` : "Connecting…"}
        width={420}
        footer={
          <Btn variant="ghost" onClick={cancelSwitch}>
            Cancel
          </Btn>
        }
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            padding: "8px 4px 4px",
            textAlign: "center",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              color: "var(--accent)",
              animation: "spin 0.8s linear infinite",
            }}
          >
            <Icon name="refresh" size={26} />
          </span>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            Checking the cloud instance and switching your workspace. This can take a few seconds.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!switchError}
        onClose={() => setSwitchError(null)}
        onConfirm={() => void switchToLocalFromError()}
        title={switchError ? `Couldn't connect to ${switchError.name}` : "Couldn't connect"}
        confirmLabel="Switch to Local"
        cancelLabel="Stay"
        variant="primary"
        icon="home"
        width={460}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            Mission Control couldn&apos;t reach the cloud instance, so it didn&apos;t switch scopes. Switch back to your
            Local workspace, or stay here and retry from the sandbox menu.
          </p>
          {switchError?.message && (
            <p
              style={{
                margin: 0,
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-dim)",
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {switchError.message}
            </p>
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}
