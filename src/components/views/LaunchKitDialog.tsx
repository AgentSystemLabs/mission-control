import { useEffect, useRef, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { HotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import { api } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { useHotkey } from "~/lib/use-hotkey";

type Phase = "idle" | "downloading" | "extracting" | "done";

export function LaunchKitDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [parentDir, setParentDir] = useState("");
  const [projectName, setProjectName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setProjectName("");
    setPhase("idle");
    setError(null);
    nameRef.current?.focus();
  }, [open]);

  const isWorking = phase === "downloading" || phase === "extracting";
  const canSubmit = open && !isWorking && !!parentDir.trim() && !!projectName.trim();

  const browse = async () => {
    const electron = getElectron();
    if (!electron) return;
    const result = await electron.browseFolder();
    if (result) setParentDir(result);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setPhase("downloading");
    try {
      const extractTimer = setTimeout(() => setPhase("extracting"), 700);
      const result = await api.createLaunchKitProject({
        parentDir,
        projectName,
      });
      clearTimeout(extractTimer);
      setPhase("done");
      onCreated(result.project.id);
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useHotkey("dialog.submit", () => void submit(), { enabled: open });

  const phaseLabel =
    phase === "downloading"
      ? "Downloading..."
      : phase === "extracting"
        ? "Creating project..."
        : phase === "done"
          ? "Done"
          : null;

  return (
    <Modal
      open={open}
      onClose={isWorking ? () => {} : onClose}
      title="Launch Kit"
      width={520}
      footer={
        <>
          <EscTooltip label="Cancel">
            <Btn variant="ghost" onClick={onClose} disabled={isWorking}>
              Cancel
            </Btn>
          </EscTooltip>
          <HotkeyTooltip action="dialog.submit">
            <Btn variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
              {isWorking ? phaseLabel : "Create Project"}
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <TextField
          label="Project name"
          value={projectName}
          onChange={setProjectName}
          inputRef={nameRef}
          placeholder="my-saas"
        />

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
              marginBottom: 6,
            }}
          >
            Working directory
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <TextField
                mono
                value={parentDir}
                onChange={setParentDir}
                placeholder="/Users/me/dev"
              />
            </div>
            <Btn variant="solid" icon="folder" onClick={browse} disabled={isWorking}>
              Browse...
            </Btn>
          </div>
        </div>

        <div
          style={{
            fontSize: 12.5,
            color: "var(--text-dim)",
            lineHeight: 1.5,
            padding: "9px 11px",
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--surface-0)",
          }}
        >
          Mission Control downloads the latest Academy Launch Kit, extracts it
          into a new folder, runs git init, and adds the project here.
        </div>

        {phaseLabel && phase !== "done" && (
          <div
            role="status"
            style={{
              fontSize: 12.5,
              color: "var(--text-dim)",
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface-1)",
            }}
          >
            {phaseLabel}
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
