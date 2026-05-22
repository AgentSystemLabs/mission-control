import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { getElectron } from "~/lib/electron";
import { AGENT_REGISTRY } from "~/shared/agents";
import type { CliAvailability } from "~/lib/cli-availability";
import type { TaskAgent } from "~/shared/domain";

const DEFAULT_UPDATE_COMMANDS = ["Update the CLI to the latest version, then try again."] as const;

export function AgentUpdateRequiredDialog({
  open,
  agent,
  availability,
  onClose,
}: {
  open: boolean;
  agent: TaskAgent | null;
  availability: CliAvailability | null;
  onClose: () => void;
}) {
  const label = availability?.label ?? (agent ? AGENT_REGISTRY[agent].label : "Agent CLI");
  const requiredVersion = availability?.requiredVersion ?? "the required version";
  const installedVersion = availability?.version;
  const updateCommands = availability?.updateCommands?.length
    ? availability.updateCommands
    : DEFAULT_UPDATE_COMMANDS;
  const packageUrl = availability?.packageUrl;

  useHotkey("dialog.submit", () => onClose(), { enabled: open });

  const openPackagePage = () => {
    if (!packageUrl) return;
    const electron = getElectron();
    if (electron) {
      void electron.openExternal(packageUrl);
      return;
    }
    window.open(packageUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Update ${label} to ${requiredVersion} or newer`}
      width={540}
      footer={
        <>
          {packageUrl && (
            <Btn variant="ghost" onClick={openPackagePage} icon="external-link">
              Open update page
            </Btn>
          )}
          <HotkeyTooltip action="dialog.submit">
            <Btn variant="primary" icon="check" onClick={onClose}>
              Got it
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)" }}>
          MissionControl needs {label} {requiredVersion} or newer before it can start
          this session.
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--text-dim)",
            lineHeight: 1.55,
          }}
        >
          {installedVersion
            ? `Installed: ${installedVersion}. Required: ${requiredVersion}.`
            : `MissionControl could not verify ${label} ${requiredVersion} or newer.`}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: "color-mix(in oklch, var(--accent) 10%, transparent)",
            border: "1px solid color-mix(in oklch, var(--accent) 35%, var(--border))",
            borderRadius: 7,
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--text)",
            lineHeight: 1.55,
          }}
        >
          {updateCommands.map((command, index) => (
            <div key={command}>
              {index > 0 && <br />}
              {command}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
