import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AgentLogo } from "~/components/ui/AgentLogo";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { CodeBlock, SettingsSection, ToggleSwitch, useCopy } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { mcToastLoading, mcToastResultCard } from "~/lib/mc-toast";
import {
  cliAvailabilityFromCheckResult,
  type CliAvailability,
} from "~/lib/cli-availability";
import { AGENT_META } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { reorderPinnedIds } from "~/lib/pinned-project-order";
import { queryKeys, useAgentAccounts, useAgentLatestVersions, useSettings } from "~/queries";
import { AGENT_REGISTRY } from "~/shared/agents";
import {
  AGENT_CLI_CONFIG,
  resolveAgentCliUpdateCommands,
} from "~/shared/agent-cli-config";
import { compareCliVersions } from "~/shared/agent-cli-version-compare";
import {
  DEFAULT_AGENT_LAUNCHER_CONFIG,
  visibleLauncherAgents,
  type AgentLauncherConfig,
} from "~/shared/agent-launcher-config";
import type { AgentLatestVersion } from "~/shared/agent-launchers";
import type { TaskAgent } from "~/shared/domain";

const DRAG_THRESHOLD_PX = 4;

// The Providers page runs its own version probe (with verifyVersion) instead
// of piggybacking on the boot-time cli-availability store: the probe spawns
// `<cli> --version` synchronously on the main process, so it should only pay
// that cost when the user actually opens this page. Results persist for the
// app's lifetime at both layers — the main process caches passing probes and
// this module keeps resolved rows across page visits — so only the first
// visit checks; the per-row Check button and a finished update re-probe with
// `fresh` to pick up CLIs changed outside the app.
type InstalledState =
  | { status: "checking" }
  | { status: "browser" }
  | { status: "ready"; availability: CliAvailability };

// Only healthy results are kept across visits: a missing/outdated CLI is
// exactly what the user is likely fixing in a terminal between visits, so
// those rows re-probe on the next mount instead of pinning the bad state.
const installedVersionCache = new Map<TaskAgent, CliAvailability>();

function seedInstalledState(agents: readonly TaskAgent[]): Record<string, InstalledState> {
  if (!getElectron()) {
    return Object.fromEntries(agents.map((a) => [a, { status: "browser" }]));
  }
  return Object.fromEntries(
    agents.map((agent) => {
      const cached = installedVersionCache.get(agent);
      return [agent, cached ? { status: "ready", availability: cached } : { status: "checking" }];
    }),
  );
}

function useInstalledVersions(agents: readonly TaskAgent[]): {
  installed: Record<string, InstalledState>;
  refreshInstalled: (agent: TaskAgent) => Promise<void>;
} {
  const [state, setState] = useState<Record<string, InstalledState>>(() =>
    seedInstalledState(agents),
  );

  const probe = useCallback(async (agent: TaskAgent, opts?: { fresh?: boolean }) => {
    const electron = getElectron();
    if (!electron) return;
    try {
      const result = await electron.cliCheck(AGENT_REGISTRY[agent].command, {
        verifyVersion: true,
        fresh: opts?.fresh,
      });
      const availability = cliAvailabilityFromCheckResult(result);
      if (availability.status === "available") {
        installedVersionCache.set(agent, availability);
      } else {
        installedVersionCache.delete(agent);
      }
      setState((current) => ({
        ...current,
        [agent]: { status: "ready", availability },
      }));
    } catch {
      setState((current) => ({
        ...current,
        [agent]: { status: "ready", availability: { status: "missing" } },
      }));
    }
  }, []);

  const agentsKey = agents.join(",");
  useEffect(() => {
    setState(seedInstalledState(agents));
    if (!getElectron()) return;
    // Probe only rows without a cached healthy result — a revisit (or a drag
    // reorder, which changes agentsKey) reuses what earlier probes resolved.
    for (const agent of agents) {
      if (!installedVersionCache.has(agent)) void probe(agent);
    }
  }, [agentsKey]);

  const refreshInstalled = useCallback(
    async (agent: TaskAgent) => {
      if (!getElectron()) return;
      setState((current) => ({ ...current, [agent]: { status: "checking" } }));
      await probe(agent, { fresh: true });
    },
    [probe],
  );

  return { installed: state, refreshInstalled };
}

export function ProvidersSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const config = settings?.agentLauncherConfig ?? DEFAULT_AGENT_LAUNCHER_CONFIG;
  const { data: accounts } = useAgentAccounts();
  const { data: latestVersions } = useAgentLatestVersions();
  const { copied, copy } = useCopy();
  const [refreshing, setRefreshing] = useState<Partial<Record<TaskAgent, boolean>>>({});
  const [updating, setUpdating] = useState<Partial<Record<TaskAgent, boolean>>>({});

  const { installed, refreshInstalled } = useInstalledVersions(config.order);

  const accountByAgent = useMemo(
    () => new Map((accounts ?? []).map((account) => [account.agent, account])),
    [accounts],
  );
  const latestByAgent = useMemo(
    () => new Map((latestVersions ?? []).map((entry) => [entry.agent, entry])),
    [latestVersions],
  );

  const update = useCallback(
    async (next: AgentLauncherConfig) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings });
      const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
      if (previous) {
        queryClient.setQueryData<AppSettings>(queryKeys.settings, {
          ...previous,
          agentLauncherConfig: next,
        });
      }
      try {
        const saved = await api.updateSettings({ agentLauncherConfig: next });
        queryClient.setQueryData(queryKeys.settings, saved);
      } catch (e) {
        if (previous) queryClient.setQueryData(queryKeys.settings, previous);
        toast.error(e instanceof Error ? e.message : "Could not update provider settings");
      }
    },
    [queryClient],
  );

  // --- drag to reorder (pointer capture, no dnd library — same approach as ProjectBar) ---
  const [dragOrder, setDragOrder] = useState<TaskAgent[] | null>(null);
  const [draggingAgent, setDraggingAgent] = useState<TaskAgent | null>(null);
  const dragOrderRef = useRef<TaskAgent[] | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const configOrderRef = useRef<TaskAgent[]>(config.order);
  configOrderRef.current = config.order;

  const displayOrder = dragOrder ?? config.order;

  const resolveDropIndex = useCallback((clientY: number) => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-provider-row]");
    if (!rows?.length) return 0;
    for (let index = 0; index < rows.length; index++) {
      const rect = rows[index]!.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return rows.length - 1;
  }, []);

  const startReorder = useCallback(
    (agent: TaskAgent, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const captureTarget = event.currentTarget;
      const pointerId = event.pointerId;
      const startY = event.clientY;
      let moved = false;
      dragOrderRef.current = [...configOrderRef.current];
      captureTarget.setPointerCapture(pointerId);

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (!moved && Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return;
        moved = true;
        setDraggingAgent(agent);
        const currentOrder = dragOrderRef.current ?? configOrderRef.current;
        const fromIndex = currentOrder.indexOf(agent);
        const toIndex = resolveDropIndex(moveEvent.clientY);
        if (fromIndex >= 0 && fromIndex !== toIndex) {
          const nextOrder = reorderPinnedIds(currentOrder, fromIndex, toIndex) as TaskAgent[];
          dragOrderRef.current = nextOrder;
          setDragOrder(nextOrder);
        }
        moveEvent.preventDefault();
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        if (captureTarget.hasPointerCapture(pointerId)) {
          captureTarget.releasePointerCapture(pointerId);
        }
        setDraggingAgent(null);
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        const nextOrder = dragOrderRef.current;
        cleanup();
        if (!moved || !nextOrder) {
          dragOrderRef.current = null;
          setDragOrder(null);
          return;
        }
        if (nextOrder.join("\0") === configOrderRef.current.join("\0")) {
          dragOrderRef.current = null;
          setDragOrder(null);
          return;
        }
        void update({ order: nextOrder, hidden: config.hidden }).then(() => {
          dragOrderRef.current = null;
          setDragOrder(null);
        });
      };

      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return;
        cleanup();
        dragOrderRef.current = null;
        setDragOrder(null);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    },
    [config.hidden, resolveDropIndex, update],
  );

  const toggleVisibility = (agent: TaskAgent) => {
    const hidden = config.hidden.includes(agent);
    if (!hidden && visibleLauncherAgents(config).length === 1) {
      toast("At least one agent stays visible in the New Session dialog.");
      return;
    }
    const nextHidden = hidden
      ? config.hidden.filter((a) => a !== agent)
      : [...config.hidden, agent];
    void update({ order: config.order, hidden: nextHidden });
  };

  const checkForUpdate = async (agent: TaskAgent) => {
    setRefreshing((current) => ({ ...current, [agent]: true }));
    // Re-probe the installed version too — an explicit Check is the escape
    // hatch when the CLI was updated outside the app and the cache is stale.
    void refreshInstalled(agent);
    try {
      const { versions } = await api.getAgentLatestVersions([agent], { refresh: true });
      queryClient.setQueryData<AgentLatestVersion[]>(queryKeys.agentLatestVersions, (current) => {
        const byAgent = new Map((current ?? []).map((entry) => [entry.agent, entry]));
        for (const entry of versions) byAgent.set(entry.agent, entry);
        return [...byAgent.values()];
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check for updates");
    } finally {
      setRefreshing((current) => ({ ...current, [agent]: false }));
    }
  };

  const runUpdate = async (agent: TaskAgent) => {
    const electron = getElectron();
    if (!electron?.cliRunUpdate) return;
    const label = AGENT_META[agent].label;
    setUpdating((current) => ({ ...current, [agent]: true }));
    const toastId = mcToastLoading(`Updating ${label}…`, {
      description: "This can take a few minutes.",
    });
    try {
      const result = await electron.cliRunUpdate(agent);
      if (result.ok) {
        toast.success(
          result.version ? `${label} updated to v${result.version}` : `${label} update finished`,
          { id: toastId, description: result.command },
        );
      } else {
        toast.dismiss(toastId);
        const outputTail = result.output?.split("\n").filter(Boolean).slice(-3).join("\n");
        mcToastResultCard(
          {
            tone: "error",
            title:
              result.reason === "timeout"
                ? `${label} update timed out`
                : `${label} update failed`,
            detail:
              outputTail ||
              (result.command
                ? `${result.command} did not succeed — run it in a terminal to see why.`
                : "Run one of the update commands in a terminal to see why."),
          },
          { duration: 10_000 },
        );
      }
    } catch (e) {
      toast.dismiss(toastId);
      mcToastResultCard(
        {
          tone: "error",
          title: `${label} update failed`,
          detail: e instanceof Error ? e.message : "Unknown error.",
        },
        { duration: 10_000 },
      );
    } finally {
      setUpdating((current) => ({ ...current, [agent]: false }));
      void refreshInstalled(agent);
    }
  };

  return (
    <SettingsSection
      title="Providers"
      subtitle="The AI agents offered when starting a new session. Drag to reorder, hide the ones you don't use, and keep each CLI up to date. Hiding an agent only removes it from the picker — a project's saved agent still launches."
      headingLevel="h1"
    >
      <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {displayOrder.map((agent) => (
          <ProviderRow
            key={agent}
            agent={agent}
            hidden={config.hidden.includes(agent)}
            dragging={draggingAgent === agent}
            installed={installed[agent] ?? { status: "checking" }}
            latest={latestByAgent.get(agent)}
            account={accountByAgent.get(agent)}
            refreshing={!!refreshing[agent]}
            updating={!!updating[agent]}
            copiedLabel={copied}
            onCopy={copy}
            onDragStart={(event) => startReorder(agent, event)}
            onToggleVisibility={() => toggleVisibility(agent)}
            onCheckForUpdate={() => void checkForUpdate(agent)}
            onRunUpdate={
              getElectron()?.cliRunUpdate ? () => void runUpdate(agent) : undefined
            }
          />
        ))}
      </div>
    </SettingsSection>
  );
}

function ProviderRow({
  agent,
  hidden,
  dragging,
  installed,
  latest,
  account,
  refreshing,
  updating,
  copiedLabel,
  onCopy,
  onDragStart,
  onToggleVisibility,
  onCheckForUpdate,
  onRunUpdate,
}: {
  agent: TaskAgent;
  hidden: boolean;
  dragging: boolean;
  installed: InstalledState;
  latest: AgentLatestVersion | undefined;
  account: { connected: boolean; identifier: string | null } | undefined;
  refreshing: boolean;
  updating: boolean;
  copiedLabel: string | null;
  onCopy: (text: string, label: string) => void;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggleVisibility: () => void;
  onCheckForUpdate: () => void;
  /** Absent outside the Electron runtime (or with an older preload) — falls back to copy-only. */
  onRunUpdate: (() => void) | undefined;
}) {
  const meta = AGENT_META[agent];
  const registry = AGENT_REGISTRY[agent];
  const cliConfig = AGENT_CLI_CONFIG[agent];
  const [manualOpen, setManualOpen] = useState(false);

  const availability = installed.status === "ready" ? installed.availability : null;
  const installedVersion = availability?.version ?? null;
  const updateAvailable =
    !!latest?.latestVersion &&
    !!installedVersion &&
    compareCliVersions(latest.latestVersion, installedVersion, cliConfig.versionScheme) > 0;
  const updateCommands =
    availability?.updateCommands ??
    resolveAgentCliUpdateCommands(cliConfig.updateCommands, getElectron()?.platform ?? "darwin");

  return (
    <div
      data-provider-row
      style={{
        background: "var(--surface-0)",
        border: `1px solid ${dragging ? "var(--accent-border)" : "var(--border)"}`,
        borderRadius: 8,
        padding: "12px 14px",
        opacity: hidden ? 0.55 : 1,
        boxShadow: dragging ? "0 4px 16px rgba(0,0,0,0.25)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          aria-label={`Reorder ${meta.label}`}
          title="Drag to reorder"
          onPointerDown={onDragStart}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-faint)",
            cursor: "grab",
            padding: "4px 2px",
            fontSize: 13,
            lineHeight: 1,
            letterSpacing: "-1px",
            touchAction: "none",
            flexShrink: 0,
          }}
        >
          ⋮⋮
        </button>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            background: `${meta.color}22`,
            border: `1px solid ${meta.color}44`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: meta.color,
            flexShrink: 0,
          }}
        >
          <AgentLogo agent={agent} size={20} title={meta.label} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
              {meta.label}
            </span>
            <code style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)" }}>
              ${registry.command}
            </code>
          </div>
          <div
            style={{
              marginTop: 3,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                flexShrink: 0,
                background: account?.connected ? "var(--status-done)" : "var(--text-faint)",
              }}
            />
            {account?.connected ? "Connected" : "Not connected"}
            {account?.connected && account.identifier && (
              <BlurredIdentifier value={account.identifier} />
            )}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--text)" }}>
            {installed.status === "checking"
              ? "Checking…"
              : installed.status === "browser"
                ? "—"
                : availability?.status === "missing"
                  ? "Not installed"
                  : installedVersion
                    ? `v${installedVersion}`
                    : "Version unknown"}
          </div>
          <div style={{ marginTop: 3, fontFamily: "var(--mono)", fontSize: 10.5 }}>
            {!latest || !latest.supported ? (
              <a
                href={cliConfig.packageUrl}
                target="_blank"
                rel="noreferrer"
                title="No public release feed for this CLI — check its install page."
                style={{
                  color: "var(--text-faint)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  textDecoration: "none",
                }}
              >
                {latest ? "Check unavailable" : "…"}
                {latest && <Icon name="external-link" size={10} />}
              </a>
            ) : updateAvailable ? (
              <span style={{ color: "var(--accent)" }}>
                Update available → v{latest.latestVersion}
              </span>
            ) : latest.latestVersion && installedVersion ? (
              <span style={{ color: "var(--status-done)" }}>Up to date</span>
            ) : (
              <span style={{ color: "var(--text-faint)" }}>
                {latest.error ? "Check failed" : `Latest: v${latest.latestVersion ?? "?"}`}
              </span>
            )}
          </div>
        </div>
        {updateAvailable && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {onRunUpdate && (
              <Btn
                variant="primary"
                size="sm"
                icon={updating ? "refresh" : "download"}
                onClick={onRunUpdate}
                disabled={updating}
                aria-label={`Update ${meta.label} to v${latest?.latestVersion}`}
              >
                {updating ? "Updating…" : "Update"}
              </Btn>
            )}
            <Btn
              variant="ghost"
              size="sm"
              icon="info"
              onClick={() => setManualOpen(true)}
              aria-label={`How to update ${meta.label} manually`}
              title="Update it yourself"
            />
          </div>
        )}
        {latest?.supported !== false && (
          <Btn
            variant="ghost"
            size="sm"
            icon="refresh"
            onClick={onCheckForUpdate}
            disabled={refreshing}
            aria-label={`Check ${meta.label} for updates`}
          >
            {refreshing ? "Checking…" : "Check"}
          </Btn>
        )}
        <ToggleSwitch
          checked={!hidden}
          onChange={onToggleVisibility}
          label={`Show ${meta.label} in the New Session dialog`}
        />
      </div>
      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title={`Update ${meta.label} manually`}
        width={520}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {onRunUpdate
              ? "Prefer to update it yourself? Run one of these in your terminal — pick the one matching how you installed the CLI."
              : `Run one of these in your terminal to update the ${registry.command} CLI — pick the one matching how you installed it.`}
          </p>
          {updateCommands.map((command) => (
            <CodeBlock
              key={command}
              value={command}
              monoSize={11.5}
              copied={copiedLabel === `${agent}:${command}`}
              onCopy={() => onCopy(command, `${agent}:${command}`)}
            />
          ))}
        </div>
      </Modal>
    </div>
  );
}

/**
 * Sensitive-ish display value (account email / id), blurred until clicked.
 * Selection is disabled while blurred so the obscured text can't be copied
 * by accident; clicking toggles the reveal.
 */
function BlurredIdentifier({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={revealed}
      title={revealed ? "Click to hide" : "Click to reveal"}
      onClick={() => setRevealed((current) => !current)}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: "var(--text-dim)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          filter: revealed ? "none" : "blur(5px)",
          userSelect: revealed ? "text" : "none",
          transition: "filter 120ms ease",
        }}
      >
        {value}
      </span>
      <Icon name={revealed ? "eye-off" : "eye"} size={11} style={{ flexShrink: 0 }} />
    </button>
  );
}
