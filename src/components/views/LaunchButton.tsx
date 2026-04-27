import { useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { LaunchCommandsDialog } from "./LaunchCommandsDialog";
import { api } from "~/lib/api";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  parseLaunchCommands,
  type LaunchCommand,
  type Project,
} from "~/db/schema";

export function LaunchButton({
  project,
  onProjectUpdated,
}: {
  project: Project;
  onProjectUpdated: () => Promise<void> | void;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [launching, setLaunching] = useState(false);
  const { createTerminal, killTerminalsByStartCommand, setPanelOpen } = useUserTerminals();

  const commands = parseLaunchCommands(project.launchCommands ?? null);

  const launch = async () => {
    if (commands.length === 0) {
      setShowEmpty(true);
      return;
    }
    setLaunching(true);
    try {
      await killTerminalsByStartCommand(commands.map((c) => c.command));
      for (const c of commands) {
        await createTerminal({ name: c.name, startCommand: c.command });
      }
      setPanelOpen(true);
    } finally {
      setLaunching(false);
    }
  };

  const saveCommands = async (next: LaunchCommand[]) => {
    await api.updateProject(project.id, { launchCommands: next });
    await onProjectUpdated();
  };

  return (
    <>
      <div style={{ display: "inline-flex" }}>
        <button
          onClick={launch}
          disabled={launching}
          title={
            commands.length === 0
              ? "Configure launch commands"
              : `Launch ${commands.length} command${commands.length === 1 ? "" : "s"}`
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 12px",
            background: "var(--surface-2)",
            border: "1px solid var(--border-strong)",
            borderRight: "none",
            borderRadius: "7px 0 0 7px",
            color: "var(--text)",
            fontFamily: "var(--sans)",
            fontSize: 12.5,
            fontWeight: 500,
            cursor: launching ? "wait" : "pointer",
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => {
            if (!launching) e.currentTarget.style.background = "var(--surface-3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--surface-2)";
          }}
        >
          <Icon name="play" size={13} />
          {launching ? "Launching…" : "Launch"}
        </button>
        <button
          onClick={() => setShowConfig(true)}
          title="Configure launch commands"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 30,
            width: 30,
            background: "var(--surface-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: "0 7px 7px 0",
            color: "var(--text-dim)",
            cursor: "pointer",
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--surface-3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--surface-2)";
          }}
        >
          <Icon name="settings" size={13} />
        </button>
      </div>

      <LaunchCommandsDialog
        open={showConfig}
        project={project}
        onClose={() => setShowConfig(false)}
        onSave={saveCommands}
      />

      <Modal
        open={showEmpty}
        onClose={() => setShowEmpty(false)}
        title="No launch commands"
        width={420}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setShowEmpty(false)}>
              Close
            </Btn>
            <Btn
              variant="primary"
              icon="settings"
              onClick={() => {
                setShowEmpty(false);
                setShowConfig(true);
              }}
            >
              Configure
            </Btn>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          You haven't configured any launch commands for this project yet. Open the configuration
          modal to add up to 5 commands that will run when you press Launch.
        </p>
      </Modal>
    </>
  );
}
