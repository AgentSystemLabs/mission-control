import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { SandboxConfigModal } from "~/components/views/SandboxConfigModal";
import { api } from "~/lib/api";
import { getElectron, isElectron } from "~/lib/electron";
import { mcToastLoading } from "~/lib/mc-toast";
import {
  buildOptimisticRemoteVmSandboxFromDeployJob,
  markSandboxStoppedInCache,
  markSandboxStoppingInCache,
  mergeServerSandboxesPreservingPending,
  removeSandboxFromCache,
  restoreSandboxesCache,
  updateSandboxRemoteStatusInCache,
  upsertSandboxInCache,
  type SandboxesQueryData,
} from "~/lib/optimistic-sandbox";
import { isMissingRemoteInstanceError, remoteVmDeployJobForSandbox } from "~/lib/remote-vm-deploy";
import { setSandboxBusyState, type SandboxBusyMap, type SandboxBusyState } from "~/lib/sandbox-busy";
import { pruneStoredSessionFinishNotifications } from "~/lib/session-notification-store";
import { scopedSandboxesForProject } from "~/lib/project-scoped-sandboxes";
import { useProjectSandboxFlow } from "~/lib/use-project-sandbox-flow";
import { useHotkey } from "~/lib/use-hotkey";
import { useTerminalActions } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  queryKeys,
  sandboxesQueryOptions,
  useProjects,
  useSandboxes,
} from "~/queries";
import type { RemoteVmDeployJobSnapshot } from "~/shared/electron-contract";
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

function isStoppingStatus(status: string | null | undefined): boolean {
  return status === "pausing";
}

/** The cloud instance is gone (deleted out-of-band) — usable only by removing it. */
function isMissingStatus(status: string | null | undefined): boolean {
  return status === "missing";
}

function isManagedAwsRemote(s: { kind: string; remoteProvider: string | null }): boolean {
  return s.kind === "remote-vm" && s.remoteProvider === "aws";
}

function isRunningManagedRemoteStatus(status: string | null | undefined): boolean {
  return status === "ready";
}

const MANAGED_REMOTE_RECONCILE_TTL_MS = 30_000;
const MANAGED_REMOTE_RECONCILE_POLL_MS = 60_000;

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
  busy,
  onClick,
}: {
  label: string;
  subtitle: string;
  color: string;
  active: boolean;
  /** Dim the row to signal an in-progress lifecycle action. Stays clickable so the
   *  click can surface an informational modal (e.g. "is being deleted"). */
  busy?: boolean;
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
    opacity: busy ? 0.55 : 1,
  };
  return (
    <button type="button" onClick={onClick} style={style} aria-current={active} aria-busy={busy}>
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }}
      />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-faint)" }}>{subtitle}</span>
      {active && <Icon name="check" size={12} style={{ color: "var(--accent-ink)" }} />}
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
  onResume,
  onSwitchLocal,
  onDelete,
  onClose,
}: {
  sandbox: { id: string; name: string } | null;
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
    { enabled: !!sandbox },
  );
  return (
    <Modal
      open={!!sandbox}
      onClose={onClose}
      title={sandbox ? `${sandbox.name} is paused` : "Sandbox is paused"}
      width={460}
      footer={
        <>
          <Btn variant="ghost" onClick={onSwitchLocal}>
            Switch to Local
          </Btn>
          <Btn variant="danger" icon="trash" onClick={onDelete}>
            Delete sandbox
          </Btn>
          <HotkeyTooltip action="dialog.submit">
            <Btn variant="primary" icon="refresh" onClick={onResume}>
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

function StoppingSandboxModal({
  sandbox,
  onSwitchLocal,
  onClose,
}: {
  sandbox: { id: string; name: string } | null;
  onSwitchLocal: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!sandbox}
      onClose={onClose}
      title={sandbox ? `${sandbox.name} is stopping` : "Sandbox is stopping"}
      width={440}
      footer={
        <Btn variant="primary" icon="home" onClick={onSwitchLocal}>
          Switch to Local
        </Btn>
      }
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
        This sandbox is stopping, so Mission Control has closed its terminals and will not switch
        back until the stop finishes. Wait for it to show Paused, then resume it when needed.
      </p>
    </Modal>
  );
}

function DeletingSandboxModal({
  sandbox,
  onClose,
}: {
  sandbox: { id: string; name: string } | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!sandbox}
      onClose={onClose}
      title={sandbox ? `${sandbox.name} is being deleted` : "Sandbox is being deleted"}
      width={440}
      footer={
        <Btn variant="primary" onClick={onClose}>
          Got it
        </Btn>
      }
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
        This sandbox is being torn down — Mission Control is terminating its cloud VM and removing
        it. It will disappear from the list once the teardown finishes.
      </p>
    </Modal>
  );
}

function MissingSandboxModal({
  sandbox,
  isActiveScope,
  deleting,
  onSwitchLocal,
  onDelete,
  onClose,
}: {
  sandbox: { id: string; name: string } | null;
  isActiveScope: boolean;
  deleting: boolean;
  onSwitchLocal: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // mod+enter drives the SAFE action (switch/keep) — deleting cascades the
  // sandbox's projects/terminals, so it must be an explicit click, never a default.
  useHotkey(
    "mod+enter",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSwitchLocal();
    },
    { enabled: !!sandbox && !deleting },
  );
  return (
    <Modal
      open={!!sandbox}
      onClose={() => {
        if (!deleting) onClose();
      }}
      title={sandbox ? `${sandbox.name} was deleted` : "Sandbox was deleted"}
      width={460}
      footer={
        <>
          <Btn variant="danger" icon="trash" onClick={onDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete from Mission Control"}
          </Btn>
          <HotkeyTooltip action="dialog.submit">
            <Btn
              variant="primary"
              icon={isActiveScope ? "home" : undefined}
              onClick={onSwitchLocal}
              disabled={deleting}
            >
              {isActiveScope ? "Switch to Local" : "Close"}
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
        The cloud instance for this sandbox no longer exists, so Mission Control cannot connect to
        it. Switch back to your Local workspace and keep the record for troubleshooting, or delete
        the sandbox from Mission Control (this also removes its scoped projects and terminals).
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
  const qc = useQueryClient();
  const { data } = useSandboxes();
  const { data: allProjects = [] } = useProjects();
  // The switcher lives in the global header, so derive the project being viewed
  // from the route. On a project screen we scope the list to that project's sandboxes.
  const currentPath = useRouterState({ select: (state) => state.location.pathname });
  const currentProjectId = currentPath.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
  const terminals = useTerminalActions();
  const userTerminals = useUserTerminals();
  const [open, setOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [missingRemoteSandbox, setMissingRemoteSandbox] = useState<{ id: string; name: string } | null>(null);
  // Set when the user tries to switch into a paused remote VM — the modal makes
  // them resume, switch back to Local, or delete it instead of silently loading a
  // dead scope.
  const [pausedPrompt, setPausedPrompt] = useState<{ id: string; name: string } | null>(null);
  const [stoppingPrompt, setStoppingPrompt] = useState<{ id: string; name: string } | null>(null);
  // Set when the user clicks a sandbox that is currently being torn down — the
  // modal tells them it's in progress instead of re-triggering delete.
  const [deletingPrompt, setDeletingPrompt] = useState<{ id: string; name: string } | null>(null);
  const [deletingMissingRemote, setDeletingMissingRemote] = useState(false);
  const [teardownConfirmOpen, setTeardownConfirmOpen] = useState(false);
  // Per-sandbox busy state, keyed by sandbox id — NOT a single global flag, so
  // pausing/tearing down one sandbox never disables the controls of another and
  // multiple can be stopped concurrently.
  const [cloudBusy, setCloudBusy] = useState<SandboxBusyMap>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const deployCacheRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcileInFlightRef = useRef<Set<string>>(new Set());
  const reconcilePromptIfActiveRef = useRef<Set<string>>(new Set());
  const reconcileCheckedAtRef = useRef<Map<string, number>>(new Map());
  const initialReconcileDoneRef = useRef(false);
  // Optimistic rows for deploys that haven't persisted server-side yet, re-applied
  // after any mid-deploy refetch so the new sandbox never flickers out of the list.
  const pendingDeploysRef = useRef<Map<string, SandboxPublicView>>(new Map());
  // Ids currently being torn down. A synchronous ref (not derived from the async
  // cloudBusy state) so the double-delete guard and the reconcile/deploy-refresh
  // resurrection guards are correct even on a same-tick double-fire. teardownSandbox
  // is the only writer (add at start, delete in finally).
  const destroyingIdsRef = useRef<Set<string>>(new Set());
  const currentProject = currentProjectId
    ? allProjects.find((p) => p.id === currentProjectId) ?? null
    : null;
  const routeProjectScope = currentProject ?? (currentProjectId ? { id: currentProjectId } : null);
  const projectSandbox = useProjectSandboxFlow(currentProject);
  const rawActiveScopeId = data?.activeScopeId ?? LOCAL_SCOPE_ID;
  const rawActiveSandbox =
    data?.sandboxes.find((sandbox) => sandbox.id === rawActiveScopeId) ?? null;
  const activeScopeAllowed =
    !data?.enabled ||
    rawActiveScopeId === LOCAL_SCOPE_ID ||
    !routeProjectScope ||
    (!!rawActiveSandbox &&
      isManagedAwsRemote(rawActiveSandbox) &&
      rawActiveSandbox.projectId === routeProjectScope.id);
  const effectiveActiveScopeId = activeScopeAllowed ? rawActiveScopeId : LOCAL_SCOPE_ID;

  // Refetch the server state but re-apply any still-pending deploy rows on top,
  // so any refresh triggered while switching scopes can't drop an optimistic
  // provisioning sandbox before the server has persisted it.
  const refreshSandboxesPreservingPending = useCallback(async () => {
    const current = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
    const pending = Array.from(pendingDeploysRef.current.values());
    const electron = getElectron();
    if (electron?.remoteVm?.listDeployJobs) {
      try {
        const jobs = await electron.remoteVm.listDeployJobs();
        for (const job of jobs) {
          const sandboxId = job.input.sandboxId;
          if (job.status !== "queued" && job.status !== "running") continue;
          // Never re-apply a row that's mid-teardown — that's the resurrection bug.
          if (!sandboxId || destroyingIdsRef.current.has(sandboxId)) continue;
          if (pending.some((sandbox) => sandbox.id === sandboxId)) continue;
          const existing = current?.sandboxes.find((sandbox) => sandbox.id === sandboxId);
          const optimistic = buildOptimisticRemoteVmSandboxFromDeployJob(job, existing);
          if (!optimistic) continue;
          pendingDeploysRef.current.set(sandboxId, optimistic);
          pending.push(optimistic);
        }
      } catch {
        /* fall back to the pending rows already captured from deploy events */
      }
    }
    try {
      const fresh = await api.listSandboxes();
      const latest = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
      const clientActiveScopeId = latest?.activeScopeId ?? current?.activeScopeId ?? null;
      qc.setQueryData<SandboxesQueryData>(
        queryKeys.sandboxes,
        mergeServerSandboxesPreservingPending(fresh, pending, clientActiveScopeId),
      );
    } catch {
      /* keep the optimistic state if the refresh fails */
    }
  }, [qc]);

  const reconcileManagedRemoteInBackground = useCallback(
    (
      sandbox: Pick<SandboxPublicView, "id" | "name" | "kind" | "remoteProvider" | "remoteStatus">,
      options: { force?: boolean; promptIfActive?: boolean } = {},
    ) => {
      const electron = getElectron();
      if (!isManagedAwsRemote(sandbox) || !electron?.remoteVm?.reconcile) return;
      // A sandbox mid-teardown must not be reconciled — a refetch could resurface a
      // paused/missing prompt for a row that's about to disappear.
      if (destroyingIdsRef.current.has(sandbox.id)) return;
      if (options.promptIfActive) reconcilePromptIfActiveRef.current.add(sandbox.id);
      if (reconcileInFlightRef.current.has(sandbox.id)) return;

      // Surface a status that needs the user's attention — but only for the
      // currently-active scope. A gone ("missing") instance always surfaces (the
      // user is stranded on a dead scope); paused/stopping prompts only on a
      // user-initiated activation so a background refresh never nags.
      const surface = (status: string | null) => {
        const current = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
        if (current?.activeScopeId !== sandbox.id) return;
        // An in-flight reconcile that resolves after teardown began must stay quiet.
        if (destroyingIdsRef.current.has(sandbox.id)) return;
        if (isMissingStatus(status)) {
          setMissingRemoteSandbox({ id: sandbox.id, name: sandbox.name });
          return;
        }
        if (!options.promptIfActive && !reconcilePromptIfActiveRef.current.has(sandbox.id)) return;
        if (isResumableStatus(status)) {
          setPausedPrompt({ id: sandbox.id, name: sandbox.name });
        } else if (isStoppingStatus(status)) {
          setStoppingPrompt({ id: sandbox.id, name: sandbox.name });
        }
      };

      const now = Date.now();
      const checkedAt = reconcileCheckedAtRef.current.get(sandbox.id) ?? 0;
      if (!options.force && now - checkedAt < MANAGED_REMOTE_RECONCILE_TTL_MS) {
        const currentSandbox = qc
          .getQueryData<SandboxesQueryData>(queryKeys.sandboxes)
          ?.sandboxes.find((s) => s.id === sandbox.id);
        const status = currentSandbox?.remoteStatus ?? sandbox.remoteStatus ?? null;
        // Within the reconcile TTL we trust the cached status: still surface a
        // known-gone active scope, and any pending user-initiated prompt.
        if (options.promptIfActive || isMissingStatus(status)) {
          surface(status);
          reconcilePromptIfActiveRef.current.delete(sandbox.id);
        }
        return;
      }

      reconcileInFlightRef.current.add(sandbox.id);
      reconcileCheckedAtRef.current.set(sandbox.id, now);
      void (async () => {
        try {
          const rec = await electron.remoteVm.reconcile(sandbox.id);
          if (!rec.ok) {
            console.warn("[scope-dropdown] remote VM reconcile failed", {
              sandboxId: sandbox.id,
              error: rec.error,
            });
            return;
          }
          if (rec.changed) await refreshSandboxesPreservingPending();
          surface(rec.status ?? sandbox.remoteStatus ?? null);
        } catch (error) {
          console.warn("[scope-dropdown] remote VM reconcile threw", {
            sandboxId: sandbox.id,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          reconcileInFlightRef.current.delete(sandbox.id);
          reconcilePromptIfActiveRef.current.delete(sandbox.id);
        }
      })();
    },
    [qc, refreshSandboxesPreservingPending],
  );

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
    const scopeId = data.enabled && activeScopeAllowed ? scopeToSandboxId(data.activeScopeId) : null;
    void getElectron()?.sandbox.setActive(scopeId);
  }, [activeScopeAllowed, data?.activeScopeId, data?.enabled]);

  // Bucket dashboard "home" terminals under the active scope so switching
  // sandboxes shows that sandbox's terminals (a home terminal runs a shell ON
  // that machine). Sandboxes disabled → everything is Local.
  useEffect(() => {
    userTerminals.setHomeScopeId(data?.enabled && activeScopeAllowed ? data.activeScopeId : LOCAL_SCOPE_ID);
  }, [activeScopeAllowed, data?.activeScopeId, data?.enabled, userTerminals.setHomeScopeId]);

  useEffect(() => {
    if (!data || effectiveActiveScopeId === LOCAL_SCOPE_ID) setConfigOpen(false);
  }, [data?.activeScopeId, effectiveActiveScopeId]);

  // When the switcher is opened, sync each managed AWS sandbox's saved status with
  // its real instance state so an idle-auto-stopped VM shows as Paused (and is
  // resumable) instead of silently appearing connected.
  useEffect(() => {
    if (!open) return;
    for (const sandbox of data?.sandboxes ?? []) {
      reconcileManagedRemoteInBackground(sandbox);
    }
  }, [data?.sandboxes, open, reconcileManagedRemoteInBackground]);

  useEffect(() => {
    if (!data?.sandboxes.length || initialReconcileDoneRef.current) return;
    initialReconcileDoneRef.current = true;
    for (const sandbox of data.sandboxes) {
      reconcileManagedRemoteInBackground(sandbox, { force: true });
    }
  }, [data?.sandboxes, reconcileManagedRemoteInBackground]);

  useEffect(() => {
    if (!data?.sandboxes) return;
    const poll = () => {
      // Network reconcile across all sandboxes — skip ticks nobody can see;
      // the next visible tick (≤60s away) catches up.
      if (document.hidden) return;
      const current = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes) ?? data;
      for (const sandbox of current.sandboxes) {
        reconcileManagedRemoteInBackground(sandbox, { force: true });
      }
    };
    const interval = window.setInterval(poll, MANAGED_REMOTE_RECONCILE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [data, qc, reconcileManagedRemoteInBackground]);

  useEffect(() => {
    const electron = getElectron();
    if (!electron?.remoteVm) return;
    let cancelled = false;

    const upsertPendingDeployJob = (job: RemoteVmDeployJobSnapshot) => {
      const sandboxId = job.input.sandboxId;
      // A stale in-flight deploy event must not re-insert a row that's mid-teardown.
      if (sandboxId && destroyingIdsRef.current.has(sandboxId)) return false;
      if ((job.status === "queued" || job.status === "running") && sandboxId) {
        const current = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
        const existing = current?.sandboxes.find((sandbox) => sandbox.id === sandboxId);
        const optimistic = buildOptimisticRemoteVmSandboxFromDeployJob(job, existing);
        if (!optimistic) return false;
        pendingDeploysRef.current.set(sandboxId, optimistic);
        upsertSandboxInCache(qc, optimistic, { activate: current?.activeScopeId === sandboxId });
        return true;
      }
      return false;
    };

    void electron.remoteVm.listDeployJobs().then((jobs) => {
      if (cancelled) return;
      const hasPending = jobs.some(upsertPendingDeployJob);
      if (hasPending) void refreshSandboxesPreservingPending();
    }).catch((error) => {
      console.warn("[scope-dropdown] list deploy jobs failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    const offDeployUpdate = electron.remoteVm.onDeployUpdate((job) => {
      const sandboxId = job.input.sandboxId;
      upsertPendingDeployJob(job);
      if (job.status === "succeeded" || job.status === "failed" || job.status === "canceled") {
        if (sandboxId) pendingDeploysRef.current.delete(sandboxId);
        if (deployCacheRefreshRef.current) {
          clearTimeout(deployCacheRefreshRef.current);
          deployCacheRefreshRef.current = null;
        }
      }
      if (job.status === "running" && sandboxId) {
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
    return () => {
      cancelled = true;
      offDeployUpdate();
    };
  }, [qc, refreshSandboxesPreservingPending]);

  useEffect(
    () => () => {
      if (deployCacheRefreshRef.current) clearTimeout(deployCacheRefreshRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!data?.enabled || data.activeScopeId === LOCAL_SCOPE_ID || activeScopeAllowed) return;
    qc.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) =>
      current ? { ...current, activeScopeId: LOCAL_SCOPE_ID } : current,
    );
    void api.setActiveScope(LOCAL_SCOPE_ID).catch(() => undefined);
    void getElectron()?.sandbox.setActive(null).catch(() => undefined);
  }, [activeScopeAllowed, data?.activeScopeId, data?.enabled, qc]);

  // Desktop-only, and only on project routes — scope switching is a
  // project-screen affordance.
  if (!isElectron() || !data?.enabled || !currentProjectId) return null;

  const { sandboxes } = data;
  const activeScopeId = effectiveActiveScopeId;
  // On a project screen, narrow the switcher to Local + that project's sandboxes.
  // See scopedSandboxesForProject for why.
  const visibleSandboxes = scopedSandboxesForProject(
    sandboxes,
    allProjects,
    routeProjectScope,
    activeScopeId,
  );
  const activeSandbox = visibleSandboxes.find((s) => s.id === activeScopeId) ?? null;
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

  const activateScope = async (scopeId: string) => {
    const previous = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
    qc.setQueryData(queryKeys.sandboxes, (current) =>
      current ? { ...current, activeScopeId: scopeId } : current,
    );
    try {
      await api.setActiveScope(scopeId);
      void refreshSandboxesPreservingPending();
    } catch (error) {
      restoreSandboxesCache(qc, previous);
      toast.error(error instanceof Error ? error.message : "Failed to switch sandbox.");
    }
  };

  const closeSandboxUi = async (sandboxId: string) => {
    const ownerProjectId = sandboxes.find((sandbox) => sandbox.id === sandboxId)?.projectId ?? null;
    const projects = ownerProjectId
      ? allProjects.filter((project) => project.id === ownerProjectId)
      : allProjects.filter((project) => project.sandboxId === sandboxId);
    for (const project of projects) {
      await terminals.closeForProject(project.id);
      await userTerminals.closeForProject(project.id);
      pruneStoredSessionFinishNotifications({ type: "project", projectId: project.id });
    }
    await userTerminals.closeHomeForScope(sandboxId);
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
    const toastId = mcToastLoading(`Resuming ${sandbox.name}…`, {
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
    const sandboxName = activeSandbox.name;
    setSandboxBusy(sandboxId, "pausing");
    markSandboxStoppingInCache(qc, sandboxId, { switchActiveToLocal: true });
    await api.setActiveScope(LOCAL_SCOPE_ID).catch(() => undefined);
    await electron.sandbox.setActive(null).catch(() => undefined);
    const toastId = mcToastLoading(`Stopping ${sandboxName}…`, {
      description: "Pausing the EC2 instance and disconnecting the agent.",
    });
    try {
      await closeSandboxUi(sandboxId);
      const down = await electron.sandbox.down(sandboxId);
      if (!down.ok) throw new Error(down.error);
      const paused = await electron.remoteVm.pause(sandboxId);
      if (!paused.ok) throw new Error(paused.error);
      markSandboxStoppedInCache(qc, sandboxId);
      await qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
      toast.success(`${sandboxName} stopped`, { id: toastId, description: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to stop ${sandboxName}.`;
      updateSandboxRemoteStatusInCache(qc, sandboxId, {
        remoteStatus: "pause_failed",
        remoteStatusMessage: message,
      });
      toast.error(message, {
        id: toastId,
        description: "Open sandbox settings → Logs for details.",
      });
      void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
    } finally {
      setSandboxBusy(sandboxId, null);
    }
  };

  const teardownSandbox = async (target: { id: string; name: string }) => {
    // Synchronous guard (ref, not async cloudBusy) so a same-tick double-fire of
    // delete can't launch two teardown pipelines — there is no idempotency key on
    // the destroy/delete calls, so a duplicate is a real second delete.
    if (destroyingIdsRef.current.has(target.id) || cloudBusy[target.id]) return;
    const electron = getElectron();
    if (!electron?.remoteVm) return;
    const isActive = activeScopeId === target.id;

    // Mark the row "destroying" and keep it visible so the dropdown shows
    // "Deleting…" for the whole teardown. Removing it optimistically let a
    // concurrent refetch (reconcile poll / deploy listener) pull the still-present
    // server row back, so the sandbox flickered back into the list with a stale
    // status. We only drop the row once the server delete has committed below.
    destroyingIdsRef.current.add(target.id);
    // Drop any pending-deploy placeholder so a mid-flight refresh can't re-apply it.
    pendingDeploysRef.current.delete(target.id);
    setSandboxBusy(target.id, "destroying");
    setPausedPrompt(null);
    const toastId = mcToastLoading(`Deleting ${target.name}…`, {
      description: "Terminating the cloud VM and removing the sandbox.",
    });

    try {
      await closeSandboxUi(target.id);

      const destroy = await electron.sandbox.destroy(target.id);
      if (!destroy.ok) throw new Error(destroy.error);

      const deployJobs = await electron.remoteVm.listDeployJobs();
      const deployJob = remoteVmDeployJobForSandbox(deployJobs, target.id);
      if (deployJob && (deployJob.status === "queued" || deployJob.status === "running")) {
        await electron.remoteVm.cancelDeploy(deployJob.id);
      }
      const terminated = await electron.remoteVm.destroy(target.id, { keepRow: true });
      // A "not found" termination means the instance is already gone — the desired
      // end state — so don't strand an undeletable sandbox; proceed to row cleanup.
      if (!terminated.ok && !isMissingRemoteInstanceError(terminated.error)) {
        throw new Error(terminated.error);
      }

      if (isActive) {
        await api.setActiveScope(LOCAL_SCOPE_ID);
        await electron.sandbox.setActive(null);
        qc.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) =>
          current ? { ...current, activeScopeId: LOCAL_SCOPE_ID } : current,
        );
      }

      await api.deleteSandbox(target.id);
      // The server delete has committed — now drop the row. A refetch after this
      // can no longer resurrect it.
      removeSandboxFromCache(qc, target.id, { switchActiveToLocal: isActive });
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.sandboxes }),
        qc.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
      setTeardownConfirmOpen(false);
      toast.success(`${target.name} deleted`, { id: toastId, description: undefined });
    } catch (error) {
      // Leave the row in place (it reverts to its real status) so the user can retry.
      toast.error(error instanceof Error ? error.message : `Failed to delete ${target.name}.`, {
        id: toastId,
        description: undefined,
      });
    } finally {
      destroyingIdsRef.current.delete(target.id);
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
    const target = sandboxes.find((s) => s.id === scopeId) ?? null;
    // A sandbox mid-teardown can't be used — inform instead of re-triggering delete
    // or activating a row that's about to disappear. Checked before status branches
    // because its server status is still the stale pre-delete value.
    if (target && cloudBusy[target.id] === "destroying") {
      setDeletingPrompt({ id: target.id, name: target.name });
      return;
    }
    // A sandbox whose cloud instance is gone can't be used — prompt to remove it
    // or switch to Local, even when it's the currently-active (dead) scope.
    if (target && isMissingStatus(target.remoteStatus)) {
      setMissingRemoteSandbox({ id: target.id, name: target.name });
      return;
    }
    if (scopeId === activeScopeId) return;
    // Note: a sandbox that is resuming can still be switched into — the route
    // shows a resuming overlay until its agent is back. The resume keeps running
    // in the background regardless of which scope is active.
    if (target && isStoppingStatus(target.remoteStatus)) {
      setStoppingPrompt({ id: target.id, name: target.name });
      return;
    }
    // A paused remote VM can't be used until it's resumed — intercept and prompt
    // instead of silently activating a dead scope. Managed AWS remotes also run
    // a background reconcile after activation to catch stale provider state.
    if (target && target.kind === "remote-vm" && isResumableStatus(target.remoteStatus)) {
      setPausedPrompt({ id: target.id, name: target.name });
      return;
    }
    await activateScope(scopeId);
    if (target && isManagedAwsRemote(target)) {
      reconcileManagedRemoteInBackground(target, { promptIfActive: true });
    }
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
  const cancelStoppingToLocal = () => {
    setStoppingPrompt(null);
    if (activeScopeId !== LOCAL_SCOPE_ID) void activateScope(LOCAL_SCOPE_ID);
  };
  // Missing-VM modal: get off the dead scope (only switch when it's the one
  // we're sitting on) and keep the record so the user can delete it deliberately.
  const switchMissingToLocal = () => {
    const target = missingRemoteSandbox;
    setMissingRemoteSandbox(null);
    if (target && activeScopeId === target.id && activeScopeId !== LOCAL_SCOPE_ID) {
      void activateScope(LOCAL_SCOPE_ID);
    }
  };
  const missingIsActiveScope = !!missingRemoteSandbox && activeScopeId === missingRemoteSandbox.id;

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
          <Icon
            name="chevron-down"
            size={11}
            style={{
              color: "var(--text-faint)",
              flexShrink: 0,
              transform: open ? "rotate(180deg)" : undefined,
              transition: "transform 120ms ease",
            }}
          />
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
            {visibleSandboxes.map((s) => {
              // Local "destroying" is the freshest truth — the row's server status is
              // still its stale pre-delete value, so it overrides every status branch.
              const destroying = cloudBusy[s.id] === "destroying";
              const missing = !destroying && isMissingStatus(s.remoteStatus);
              const stopping = !destroying && !missing && isStoppingStatus(s.remoteStatus);
              const resuming =
                !destroying && !missing && (resumingId === s.id || s.remoteStatus === "resuming");
              const paused =
                !destroying &&
                !missing &&
                !stopping &&
                !resuming &&
                isResumableStatus(s.remoteStatus);
              let subtitle = "AWS VM";
              if (s.remoteStatus === "provisioning") subtitle = "Provisioning…";
              if (paused) subtitle = "Paused";
              if (resuming) subtitle = "Resuming…";
              if (stopping) subtitle = "Stopping…";
              if (missing) subtitle = "Deleted";
              if (destroying) subtitle = "Deleting…";
              return (
                <ScopeItem
                  key={s.id}
                  label={s.name}
                  subtitle={subtitle}
                  color={missing ? "var(--status-failed)" : s.color ?? "var(--accent)"}
                  active={s.id === activeScopeId}
                  busy={destroying}
                  onClick={() => void pick(s.id)}
                />
              );
            })}
            {projectSandbox.canCreate && (
              <>
                <div
                  aria-hidden
                  style={{
                    height: 1,
                    margin: "4px 8px",
                    background: "var(--border)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void projectSandbox.openDialog();
                  }}
                  disabled={projectSandbox.checking}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 8px",
                    borderRadius: 6,
                    border: "none",
                    cursor: projectSandbox.checking ? "default" : "pointer",
                    background: "transparent",
                    color: projectSandbox.checking ? "var(--text-faint)" : "var(--text)",
                    opacity: projectSandbox.checking ? 0.7 : 1,
                  }}
                >
                  <Icon name="plus" size={12} style={{ color: "var(--accent-ink)", flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                    {projectSandbox.checking ? "Checking…" : "Create sandbox"}
                  </span>
                </button>
              </>
            )}
          </CardFrame>
        )}
      </div>

      {projectSandbox.dialogs}

      <SandboxConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        sandboxId={activeSandbox?.id ?? null}
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
          This terminates the cloud VM and removes the sandbox configuration from Mission Control. The owning project
          stays in place.
        </p>
      </ConfirmDialog>

      <MissingSandboxModal
        sandbox={missingRemoteSandbox}
        isActiveScope={missingIsActiveScope}
        deleting={deletingMissingRemote}
        onSwitchLocal={switchMissingToLocal}
        onDelete={() => void deleteMissingRemoteSandbox()}
        onClose={() => setMissingRemoteSandbox(null)}
      />

      <PausedSandboxModal
        sandbox={pausedPrompt}
        onResume={resumeFromPrompt}
        onSwitchLocal={cancelPausedToLocal}
        onDelete={() => pausedPrompt && void teardownSandbox(pausedPrompt)}
        onClose={() => setPausedPrompt(null)}
      />

      <StoppingSandboxModal
        sandbox={stoppingPrompt}
        onSwitchLocal={cancelStoppingToLocal}
        onClose={() => setStoppingPrompt(null)}
      />

      <DeletingSandboxModal sandbox={deletingPrompt} onClose={() => setDeletingPrompt(null)} />
    </>
  );
}
