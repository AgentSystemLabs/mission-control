import { useEffect } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { isEditableTarget, useHotkey } from "~/lib/use-hotkey";
import { agentSupportsSkipPermissions } from "~/shared/agents";
import type { TaskAgent } from "~/shared/domain";
import type { Project } from "~/db/schema";
import { AgentPicker } from "./NewAgentDialog/AgentPicker";
import { SkipPermissionsCheckbox } from "./NewAgentDialog/SkipPermissionsCheckbox";
import { RememberSettingsCheckbox } from "./NewAgentDialog/RememberSettingsCheckbox";
import { MissingCliDialog } from "./NewAgentDialog/MissingCliDialog";
import { useNewAgentForm } from "./NewAgentDialog/useNewAgentForm";
import type { RememberPatch } from "./NewAgentDialog/types";

export type { RememberPatch } from "./NewAgentDialog/types";

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
  const {
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
    dismissMissingCli,
  } = useNewAgentForm({ open, project, onStart, onPersistRemember });

  useEffect(() => {
    if (!open || missingCli) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        stepAgent(e.key === "ArrowDown" ? "down" : "up");
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
          <AgentPicker agent={agent} onSelect={selectAgent} />

          {agentSupportsSkipPermissions(agent) && (
            <SkipPermissionsCheckbox
              agent={agent}
              checked={dangerouslySkipPermissions}
              onChange={setSkipPermissions}
            />
          )}

          <RememberSettingsCheckbox
            agent={agent}
            checked={rememberSettings}
            onChange={(next) => void toggleRemember(next)}
          />

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

      <MissingCliDialog
        open={open && !!missingCli}
        missingCli={missingCli}
        onClose={dismissMissingCli}
      />
    </>
  );
}
