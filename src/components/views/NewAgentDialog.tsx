import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { isEditableTarget, useHotkey } from "~/lib/use-hotkey";
import { AGENT_META } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
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

type MissingCli = {
  cmd: string;
  label: string;
};

export function NewAgentDialog({
  open,
  project,
  onClose,
  onStart,
  onPersistRemember,
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
}) {
  const [agent, setAgent] = useState<TaskAgent>("claude-code");
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);
  const [rememberSettings, setRememberSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingCli, setMissingCli] = useState<MissingCli | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const persistRememberedSettings = async (
    nextAgent: TaskAgent,
    nextSkipPermissions: boolean
  ) => {
    await onPersistRemember({
      rememberAgentSettings: true,
      savedAgent: nextAgent,
      savedSkipPermissions: agentSupportsSkipPermissions(nextAgent) ? nextSkipPermissions : false,
      savedBareSession: false,
    });
  };

  useEffect(() => {
    if (!open) {
      setError(null);
      setMissingCli(null);
      setSubmitting(false);
      return;
    }
    const seedAgent: TaskAgent =
      project?.rememberAgentSettings && project?.savedAgent ? project.savedAgent : "claude-code";
    const seedSkip = project?.rememberAgentSettings ? !!project.savedSkipPermissions : false;
    setAgent(seedAgent);
    setDangerouslySkipPermissions(seedSkip);
    setRememberSettings(!!project?.rememberAgentSettings);
    setError(null);
    setMissingCli(null);
    setSubmitting(false);
    // Seed only when the dialog opens; later refreshes of `project` (e.g. after
    // persisting the remember toggle) must not stomp in-flight form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleRemember = async (next: boolean) => {
    setRememberSettings(next);
    await onPersistRemember(
      next
        ? {
            rememberAgentSettings: true,
            savedAgent: agent,
            savedSkipPermissions: agentSupportsSkipPermissions(agent) ? dangerouslySkipPermissions : false,
            savedBareSession: false,
          }
        : {
            rememberAgentSettings: false,
            savedAgent: null,
            savedSkipPermissions: false,
            savedBareSession: false,
        }
    );
  };

  const selectAgent = (nextAgent: TaskAgent) => {
    setAgent(nextAgent);
    if (rememberSettings) {
      void persistRememberedSettings(nextAgent, dangerouslySkipPermissions);
    }
  };

  const setSkipPermissions = (nextSkipPermissions: boolean) => {
    setDangerouslySkipPermissions(nextSkipPermissions);
    if (rememberSettings) {
      void persistRememberedSettings(agent, nextSkipPermissions);
    }
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    if (agent !== "shell") {
      const electron = getElectron();
      if (electron) {
        const cmd = AGENT_META[agent].cmd;
        const probe = await electron.cliCheck(cmd);
        if (!probe.ok) {
          setMissingCli({ cmd, label: AGENT_META[agent].label });
          setSubmitting(false);
          return;
        }
      }
    }
    try {
      const supportsSkip = agentSupportsSkipPermissions(agent);
      const skip = supportsSkip && dangerouslySkipPermissions;
      if (rememberSettings) {
        await onPersistRemember({
          rememberAgentSettings: true,
          savedAgent: agent,
          savedSkipPermissions: skip,
          savedBareSession: false,
        });
      }
      await onStart({
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
    if (!open || missingCli) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const ids = AGENT_OPTIONS.filter((a) => !a.disabled).map((a) => a.id);
        const idx = ids.indexOf(agent);
        const next = e.key === "ArrowDown"
          ? Math.min(ids.length - 1, idx + 1)
          : Math.max(0, idx - 1);
        if (next !== idx) setAgent(ids[next]);
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, agent, submitting, project, rememberSettings, dangerouslySkipPermissions, missingCli]);

  useHotkey("dialog.submit", () => void submit(), { enabled: open && !missingCli });

  return (
    <>
      <Modal
        open={open && !missingCli}
        onClose={onClose}
        title="Start a new session"
        width={540}
        footer={
          <>
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
            <HotkeyTooltip action="dialog.submit">
              <Btn variant="primary" icon="play" onClick={submit} disabled={submitting}>
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
              return (
                <button
                  key={a.id}
                  onClick={() => !a.disabled && selectAgent(a.id)}
                  disabled={a.disabled}
                  aria-disabled={a.disabled}
                  title={a.disabled ? "Coming soon" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    textAlign: "left",
                    padding: "12px 14px",
                    background: selected ? "var(--surface-2)" : "var(--surface-0)",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 8,
                    cursor: a.disabled ? "not-allowed" : "pointer",
                    color: "var(--text)",
                    boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
                    opacity: a.disabled ? 0.5 : 1,
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
                    }}
                  >
                    {meta.glyph}
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
                      textTransform: a.disabled ? "uppercase" : "none",
                      letterSpacing: a.disabled ? "0.05em" : "normal",
                    }}
                  >
                    {a.disabled ? "Coming soon" : `$${a.command}`}
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

      <Modal
        open={open && !!missingCli}
        onClose={() => setMissingCli(null)}
        title="CLI not detected"
        width={440}
        footer={
          <Btn variant="primary" onClick={() => setMissingCli(null)}>
            OK
          </Btn>
        }
      >
        {missingCli && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
              Mission Control could not find{" "}
              <code style={{ fontFamily: "var(--mono)", color: "var(--text)" }}>
                {missingCli.cmd}
              </code>{" "}
              for {missingCli.label}.
            </p>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-dim)" }}>
              Install the ship skill, then make sure{" "}
              <code style={{ fontFamily: "var(--mono)", color: "var(--text)" }}>
                {missingCli.cmd}
              </code>{" "}
              is available on your PATH before starting this session.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
