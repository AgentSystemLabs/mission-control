import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import {
  allShipSkillHarnessesSelected,
  SHIP_SKILL_HARNESS_KEYS,
  SHIP_SKILL_INSTALL_TARGETS,
  shipSkillInstallPath,
  shipSkillInstallCommand,
  emptyShipSkillHarnessSelection,
  hasShipSkillHarnessSelection,
  type ShipSkillHarnessSelection,
} from "~/shared/ship-skill-install";
import { SkillHarnessCheckRow, formatHarnessList } from "./skill-install-shared";

type Phase = "idle" | "installing" | "done";

export function InstallShipSkillModal({
  open,
  onClose,
  projectPath,
  onRunInstall,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  onRunInstall: (command: string) => Promise<void>;
}) {
  const [selection, setSelection] = useState<ShipSkillHarnessSelection>(
    emptyShipSkillHarnessSelection,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelection(emptyShipSkillHarnessSelection());
    setPhase("idle");
    setError(null);
    setNotice(null);
  }, [open, projectPath]);

  const isWorking = phase === "installing";
  const harnessSelected = hasShipSkillHarnessSelection(selection);
  const canInstall = open && !isWorking && harnessSelected && !!projectPath;

  const setHarness = (harness: keyof ShipSkillHarnessSelection, next: boolean) => {
    setSelection((current) => ({ ...current, [harness]: next }));
  };

  const submit = async (harnesses: ShipSkillHarnessSelection = selection) => {
    if (!open || isWorking || !projectPath || !hasShipSkillHarnessSelection(harnesses)) {
      return;
    }
    setSelection(harnesses);
    setError(null);
    setNotice(null);
    setPhase("installing");
    try {
      const command = shipSkillInstallCommand(harnesses);
      await onRunInstall(command);
      setPhase("done");
      const labels = SHIP_SKILL_HARNESS_KEYS.filter((key) => harnesses[key]).map(
        (key) => SHIP_SKILL_INSTALL_TARGETS[key].label,
      );
      setNotice(
        labels.length > 0
          ? `Started install command for ${formatHarnessList(labels)}.`
          : "Started ship skills install.",
      );
      setTimeout(() => onClose(), 500);
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const installAll = () => {
    void submit(allShipSkillHarnessesSelected());
  };

  useHotkey(
    "mod+enter",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      void submit();
    },
    { enabled: canInstall },
  );

  return (
    <Modal
      open={open}
      onClose={isWorking ? () => {} : onClose}
      title="Install ship skills"
      width={480}
      footer={
        <>
          <EscTooltip label="Cancel">
            <Btn variant="ghost" onClick={onClose} disabled={isWorking}>
              Cancel
            </Btn>
          </EscTooltip>
          <HotkeyTooltip action="dialog.submit" disabled={!canInstall}>
            <Btn variant="primary" onClick={() => void submit()} disabled={!canInstall}>
              {isWorking ? "Starting…" : "Install selected"}
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Install the AgentSystem core skill collection (including <code>/ship</code>) and
          reviewer subagents into this project. Each CLI tool reads skills from its own folder,
          so Mission Control opens a terminal and runs <code>agentsystem init</code> for each
          selected tool.
        </p>

        <Btn
          variant="solid"
          onClick={installAll}
          disabled={isWorking || !projectPath}
          style={{ alignSelf: "flex-start" }}
        >
          Install all
        </Btn>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SHIP_SKILL_HARNESS_KEYS.map((harness) => (
            <SkillHarnessCheckRow
              key={harness}
              label={SHIP_SKILL_INSTALL_TARGETS[harness].label}
              sub={shipSkillInstallPath(harness)}
              checked={selection[harness]}
              onChange={(next) => setHarness(harness, next)}
              disabled={isWorking}
            />
          ))}
        </div>

        {notice && (
          <div
            role="status"
            style={{
              fontSize: 12.5,
              color: "var(--text)",
              padding: "8px 10px",
              border: "1px solid var(--accent-border, var(--border))",
              borderRadius: 6,
              background: "var(--accent-dim, var(--surface-1))",
            }}
          >
            {notice}
          </div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12.5,
              color: "var(--status-failed)",
              padding: "8px 10px",
              border: "1px solid rgba(239, 68, 68, 0.45)",
              borderRadius: 6,
              background: "rgba(239, 68, 68, 0.08)",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
