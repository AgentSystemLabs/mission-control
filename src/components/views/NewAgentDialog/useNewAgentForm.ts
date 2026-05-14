import { useEffect, useState } from "react";
import { AGENT_META } from "~/lib/design-meta";
import { getRuntime } from "~/lib/runtime";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import { agentSupportsSkipPermissions } from "~/shared/agents";
import { getErrorMessage } from "~/shared/errors";
import { DEFAULT_BRANCH } from "~/shared/domain";
import type { TaskAgent } from "~/shared/domain";
import type { Project } from "~/db/schema";
import { AGENT_OPTIONS, type MissingCli, type RememberPatch } from "./types";

export function useNewAgentForm({
  open,
  project,
  onStart,
  onPersistRemember,
}: {
  open: boolean;
  project: Project | null;
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
      void persistRememberedSettings(nextAgent, dangerouslySkipPermissions).catch(
        (err) =>
          console.warn("[new-agent-dialog] persist remembered (agent) failed:", err)
      );
    }
  };

  const setSkipPermissions = (nextSkipPermissions: boolean) => {
    setDangerouslySkipPermissions(nextSkipPermissions);
    if (rememberSettings) {
      void persistRememberedSettings(agent, nextSkipPermissions).catch((err) =>
        console.warn("[new-agent-dialog] persist remembered (skip) failed:", err)
      );
    }
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    if (agent !== "shell") {
      const electron = getRuntime();
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
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Failed to start session");
    } finally {
      setSubmitting(false);
    }
  };

  const stepAgent = (direction: "up" | "down") => {
    const ids = AGENT_OPTIONS.filter((a) => !a.disabled).map((a) => a.id);
    const idx = ids.indexOf(agent);
    const next = direction === "down"
      ? Math.min(ids.length - 1, idx + 1)
      : Math.max(0, idx - 1);
    if (next !== idx) setAgent(ids[next]);
  };

  return {
    agent,
    dangerouslySkipPermissions,
    rememberSettings,
    error,
    missingCli,
    submitting,
    selectAgent,
    setSkipPermissions,
    toggleRemember,
    submit,
    stepAgent,
    dismissMissingCli: () => setMissingCli(null),
  };
}
