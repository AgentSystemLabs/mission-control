import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import { isEditableTarget, useHotkey } from "~/lib/use-hotkey";
import { AGENT_META } from "~/lib/design-meta";
import { AgentLogo } from "~/components/ui/AgentLogo";
import { getElectron } from "~/lib/electron";
import {
  agentCanLaunch,
  availabilityFor,
  firstAvailableAgent,
  type CliAvailability,
  useCliAvailability,
} from "~/lib/cli-availability";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import { AGENT_REGISTRY, UI_AGENTS, agentSupportsSkipPermissions } from "~/shared/agents";
import { DEFAULT_BRANCH } from "~/shared/domain";
import type { TaskAgent } from "~/shared/domain";
import type { Project } from "~/db/schema";

export type RememberPatch = {
  rememberAgentSettings: boolean;
  savedAgent: TaskAgent | null;
  savedSkipPermissions: boolean;
  savedBareSession: boolean;
};

const AGENT_OPTIONS = UI_AGENTS.map((id) => ({ id, ...AGENT_REGISTRY[id] }));

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    !!target.closest("button, a, input, textarea, select, [role='button']");
}

export function NewAgentDialog({
  open,
  project,
  onClose,
  onStart,
  onPersistRemember,
  onAgentUpdateRequired,
  onPrepareWarm,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onStart: (data: {
    agent: TaskAgent;
    title: string;
    branch: string;
    dangerouslySkipPermissions: boolean;
    bareSession: boolean;
  }) => Promise<void> | void;
  onPersistRemember: (patch: RememberPatch) => Promise<void> | void;
  onAgentUpdateRequired?: (agent: TaskAgent, availability: CliAvailability) => void;
  onPrepareWarm?: (payload: {
    agent: TaskAgent;
    branch: string;
    skipPermissions: boolean;
    bareSession: boolean;
  }) => void;
}) {
  const [agent, setAgent] = useState<TaskAgent>("claude-code");
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);
  const [rememberSettings, setRememberSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const cliAvailability = useCliAvailability();

  const buildSessionSettingsPatch = (
    nextRememberSettings: boolean,
    nextAgent: TaskAgent,
    nextSkipPermissions: boolean
  ): RememberPatch => ({
    rememberAgentSettings: nextRememberSettings,
    savedAgent: nextAgent,
    savedSkipPermissions: nextSkipPermissions,
    savedBareSession: false,
  });

  const persistRememberedSettings = async (
    nextAgent: TaskAgent,
    nextSkipPermissions: boolean
  ) => {
    await onPersistRemember(buildSessionSettingsPatch(true, nextAgent, nextSkipPermissions));
  };

  useEffect(() => {
    if (!open || !project || !onPrepareWarm) return;
    const supportsSkip = agentSupportsSkipPermissions(agent);
    onPrepareWarm({
      agent,
      branch: project.branch || DEFAULT_BRANCH,
      skipPermissions: supportsSkip && dangerouslySkipPermissions,
      bareSession: false,
    });
  }, [open, project, agent, dangerouslySkipPermissions, onPrepareWarm]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setSubmitting(false);
      return;
    }
    const seedAgent: TaskAgent = project?.savedAgent ?? "claude-code";
    const seedSkip = !!project?.savedSkipPermissions;
    setAgent(seedAgent);
    setDangerouslySkipPermissions(seedSkip);
    setRememberSettings(!!project?.rememberAgentSettings);
    setError(null);
    setSubmitting(false);
    // Seed only when the dialog opens; later refreshes of `project` (e.g. after
    // persisting the remember toggle) must not stomp in-flight form state.
  }, [open]);

  const toggleRemember = async (next: boolean) => {
    setRememberSettings(next);
    await onPersistRemember(buildSessionSettingsPatch(next, agent, dangerouslySkipPermissions));
  };

  const selectAgent = (nextAgent: TaskAgent) => {
    const nextAvailability = availabilityFor(cliAvailability, nextAgent);
    const canSelect = agentCanLaunch(cliAvailability, nextAgent) ||
      nextAvailability.status === "outdated";
    if (!canSelect) return;
    setAgent(nextAgent);
    void onPersistRemember(buildSessionSettingsPatch(rememberSettings, nextAgent, dangerouslySkipPermissions));
  };

  const setSkipPermissions = (nextSkipPermissions: boolean) => {
    setDangerouslySkipPermissions(nextSkipPermissions);
    void onPersistRemember(buildSessionSettingsPatch(rememberSettings, agent, nextSkipPermissions));
  };

  const submit = () => {
    if (submitting) return;
    const selectedAvailability = availabilityFor(cliAvailability, agent);
    if (selectedAvailability.status === "outdated") {
      onAgentUpdateRequired?.(agent, selectedAvailability);
      return;
    }
    if (selectedAvailability.status === "missing") {
      setError(`${AGENT_REGISTRY[agent].label} is not installed or is not on PATH.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const supportsSkip = agentSupportsSkipPermissions(agent);
      const skip = supportsSkip && dangerouslySkipPermissions;
      if (rememberSettings) {
        void persistRememberedSettings(agent, dangerouslySkipPermissions);
      } else {
        void onPersistRemember(buildSessionSettingsPatch(false, agent, dangerouslySkipPermissions));
      }
      onStart({
        agent,
        title: TITLE_WAITING,
        branch: project?.branch || DEFAULT_BRANCH,
        dangerouslySkipPermissions: skip,
        bareSession: false,
      });
    } catch (e: any) {
      setError(e?.message || "Failed to start session");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (availabilityFor(cliAvailability, agent).status !== "missing") return;
    const next = firstAvailableAgent(cliAvailability);
    if (next && next !== agent) setAgent(next);
  }, [open, agent, cliAvailability]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const ids = AGENT_OPTIONS
          .filter((a) => {
            const availability = availabilityFor(cliAvailability, a.id);
            return agentCanLaunch(cliAvailability, a.id) ||
              availability.status === "outdated";
          })
          .map((a) => a.id);
        const idx = ids.indexOf(agent);
        const next = e.key === "ArrowDown"
          ? Math.min(ids.length - 1, idx + 1)
          : Math.max(0, idx - 1);
        if (next !== idx && ids[next]) setAgent(ids[next]);
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (isInteractiveTarget(e.target)) return;
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, agent, submitting, project, rememberSettings, dangerouslySkipPermissions, cliAvailability]);

  const selectedAvailability = availabilityFor(cliAvailability, agent);
  const selectedAgentOutdated = selectedAvailability.status === "outdated";
  const startDisabled =
    submitting ||
    (!selectedAgentOutdated && !agentCanLaunch(cliAvailability, agent));

  useHotkey("dialog.submit", () => void submit(), { enabled: open && !startDisabled });

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Start a new session"
        width={540}
        footer={
          <>
            <EscTooltip label="Cancel">
              <Btn variant="ghost" onClick={onClose}>
                Cancel
              </Btn>
            </EscTooltip>
            <HotkeyTooltip action="dialog.submit">
              <Btn variant="primary" icon="play" onClick={submit} disabled={startDisabled}>
                Start session
              </Btn>
            </HotkeyTooltip>
          </>
        }
      >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <label
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              display: "block",
              marginBottom: 8,
            }}
          >
            Agent
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {AGENT_OPTIONS.map((a) => {
              const meta = AGENT_META[a.id];
              const selected = agent === a.id;
              const availability = availabilityFor(cliAvailability, a.id);
              const cliChecking =
                availability.status === "checking" ||
                (availability.status === "unknown" && !!getElectron());
              const cliMissing = availability.status === "missing";
              const cliOutdated = availability.status === "outdated";
              const disabled = !cliOutdated && !agentCanLaunch(cliAvailability, a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => !disabled && selectAgent(a.id)}
                  disabled={disabled}
                  aria-disabled={disabled}
                  title={
                    a.disabled
                      ? "Coming soon"
                      : cliMissing
                        ? `${a.command} was not found on PATH`
                        : cliOutdated
                          ? `${a.command} must be updated before launching`
                        : cliChecking
                          ? `Checking for ${a.command}`
                        : undefined
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    textAlign: "left",
                    padding: "12px 14px",
                    background: selected ? "var(--surface-2)" : "var(--surface-0)",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 8,
                    cursor: disabled ? "not-allowed" : "pointer",
                    color: "var(--text)",
                    boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
                    opacity: disabled ? 0.56 : 1,
                  }}
                >
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
                      fontSize: 15,
                      fontFamily: "var(--mono)",
                      flexShrink: 0,
                    }}
                  >
                    <AgentLogo agent={a.id} size={20} title={a.label} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{a.label}</div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--text-dim)",
                        lineHeight: 1.4,
                      }}
                    >
                    {a.description}
                    </div>
                    {(cliChecking || cliMissing || cliOutdated) && (
                      <div
                        style={{
                          marginTop: 5,
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          color: cliMissing || cliOutdated ? "var(--status-failed)" : "var(--text-faint)",
                          lineHeight: 1.35,
                        }}
                      >
                        {cliMissing
                          ? "CLI not found on PATH."
                          : cliOutdated
                            ? `Update required: ${availability.label ?? a.label} ${availability.requiredVersion ?? "latest"} or newer.`
                            : "Checking PATH..."}
                      </div>
                    )}
                  </div>
                  <code
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--text-faint)",
                      background: "var(--surface-0)",
                      padding: "3px 7px",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      textTransform: disabled ? "uppercase" : "none",
                      letterSpacing: disabled ? "0.05em" : "normal",
                    }}
                  >
                    {a.disabled
                      ? "Coming soon"
                      : cliMissing
                        ? "Missing"
                        : cliOutdated
                          ? "Update"
                        : cliChecking
                          ? "Checking"
                          : `$${a.command}`}
                  </code>
                </button>
              );
            })}
          </div>
        </div>

        {agentSupportsSkipPermissions(agent) && (
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
              checked={dangerouslySkipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
              style={{ marginTop: 2, accentColor: "var(--accent)" }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>
                Skip permission prompts
              </div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                  lineHeight: 1.4,
                }}
              >
                Launches with{" "}
                <code style={{ color: "var(--text)" }}>
                  {AGENT_REGISTRY[agent].skipPermissionsFlag}
                </code>
                .
              </div>
            </div>
          </label>
        )}

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
            checked={rememberSettings}
            onChange={(e) => void toggleRemember(e.target.checked)}
            style={{ marginTop: 2, accentColor: "var(--accent)" }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>
              Remember settings for this project
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-dim)",
                lineHeight: 1.4,
              }}
            >
              The New session button will skip this dialog and start{" "}
              <code style={{ color: "var(--text)" }}>{AGENT_META[agent].label}</code> directly.
            </div>
          </div>
        </label>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              border: "1px solid var(--status-failed)",
              background: "color-mix(in oklch, var(--status-failed) 12%, transparent)",
              borderRadius: 7,
              color: "var(--status-failed)",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
            }}
          >
            {error}
          </div>
        )}
      </div>
      </Modal>
    </>
  );
}
