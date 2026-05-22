import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import {
  fetchDiagramSkillInstallStatus,
  runInstallDiagramSkill,
} from "~/lib/install-skills-client";
import {
  allDiagramSkillHarnessesSelected,
  DIAGRAM_SKILL_HARNESS_KEYS,
  DIAGRAM_SKILL_INSTALL_TARGETS,
  diagramSkillInstallPath,
  emptyDiagramSkillHarnessSelection,
  hasDiagramSkillHarnessSelection,
  installedDiagramSkillHarnessLabels,
  type DiagramSkillHarnessSelection,
  type DiagramSkillInstallResult,
} from "~/shared/diagram-skill-install";

type Phase = "idle" | "installing" | "done";

function CheckRow({
  label,
  sub,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 11px",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--surface-0)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>{label}</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            fontFamily: "var(--mono)",
          }}
        >
          {sub}
        </span>
      </span>
    </label>
  );
}

function formatHarnessList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

export function InstallDiagramSkillModal({
  open,
  onClose,
  projectPath,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
}) {
  const [selection, setSelection] = useState<DiagramSkillHarnessSelection>(
    emptyDiagramSkillHarnessSelection,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [installed, setInstalled] = useState<DiagramSkillInstallResult>({
    claudeInstalled: false,
    codexInstalled: false,
    cursorInstalled: false,
  });

  useEffect(() => {
    if (!open) return;
    setSelection(emptyDiagramSkillHarnessSelection());
    setPhase("idle");
    setError(null);
    setNotice(null);
    let cancelled = false;
    fetchDiagramSkillInstallStatus(projectPath)
      .then((status) => {
        if (!cancelled) setInstalled(status);
      })
      .catch(() => {
        if (!cancelled) {
          setInstalled({
            claudeInstalled: false,
            codexInstalled: false,
            cursorInstalled: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath]);

  const isWorking = phase === "installing";
  const harnessSelected = hasDiagramSkillHarnessSelection(selection);
  const canInstall = open && !isWorking && harnessSelected && !!projectPath;

  const setHarness = (harness: keyof DiagramSkillHarnessSelection, next: boolean) => {
    setSelection((current) => ({ ...current, [harness]: next }));
  };

  const submit = async (harnesses: DiagramSkillHarnessSelection = selection) => {
    if (!open || isWorking || !projectPath || !hasDiagramSkillHarnessSelection(harnesses)) {
      return;
    }
    setSelection(harnesses);
    setError(null);
    setNotice(null);
    setPhase("installing");
    try {
      const result = await runInstallDiagramSkill({
        projectPath,
        harnesses,
      });
      setInstalled(result);
      setPhase("done");
      const labels = installedDiagramSkillHarnessLabels(result);
      setNotice(
        labels.length > 0
          ? `Installed diagram skill for ${formatHarnessList(labels)}.`
          : "Diagram skill installed.",
      );
      setTimeout(() => onClose(), 700);
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const installAll = () => {
    void submit(allDiagramSkillHarnessesSelected());
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

  const alreadyInstalled = installedDiagramSkillHarnessLabels(installed).length > 0;
  const installedSummary = installedDiagramSkillHarnessLabels(installed).join(" · ");

  return (
    <Modal
      open={open}
      onClose={isWorking ? () => {} : onClose}
      title="Install diagram skill"
      width={460}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={isWorking}>
            Cancel
          </Btn>
          <StaticHotkeyTooltip hotkey="⌘ Enter" disabled={!canInstall}>
            <Btn variant="primary" onClick={() => void submit()} disabled={!canInstall}>
              {isWorking ? "Installing…" : alreadyInstalled ? "Reinstall selected" : "Install selected"}
            </Btn>
          </StaticHotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Choose which CLI tools should get the Mission Control diagram skill. Each tool reads
          skills from a different folder in this project.
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
          {DIAGRAM_SKILL_HARNESS_KEYS.map((harness) => (
            <CheckRow
              key={harness}
              label={DIAGRAM_SKILL_INSTALL_TARGETS[harness].label}
              sub={diagramSkillInstallPath(harness)}
              checked={selection[harness]}
              onChange={(next) => setHarness(harness, next)}
              disabled={isWorking}
            />
          ))}
        </div>

        {alreadyInstalled && (
          <div
            style={{
              fontSize: 11.5,
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
            }}
          >
            Already installed: {installedSummary}
          </div>
        )}

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
