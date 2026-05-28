import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { EscTooltip } from "~/components/ui/Tooltip";
import { TextField } from "~/components/ui/TextField";
import type { Project } from "~/db/schema";

const MAX_LENGTH = 500;

export function WorktreeSetupCommandDialog({
  open,
  project,
  onClose,
  onSave,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (command: string | null) => Promise<void> | void;
}) {
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setCommand(project?.worktreeSetupCommand ?? "");
  }, [open, project?.id, project?.worktreeSetupCommand]);

  const save = async () => {
    setError(null);
    const trimmed = command.trim();
    if (trimmed.length > MAX_LENGTH) {
      setError(`Command cannot exceed ${MAX_LENGTH} characters.`);
      return;
    }
    try {
      setSaving(true);
      await onSave(trimmed || null);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Worktree init command"
      width={560}
      footer={
        <>
          <EscTooltip label="Cancel">
            <Btn variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Btn>
          </EscTooltip>
          <Btn variant="primary" icon="check" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--text-dim)",
            lineHeight: 1.5,
          }}
        >
          Optional shell command that runs once inside each newly created worktree. Leave empty to
          skip setup.
        </p>

        <TextField
          mono
          label="Init command"
          value={command}
          onChange={(value) => setCommand(value.slice(0, MAX_LENGTH))}
          placeholder="pnpm i"
          hint={`Runs in the new worktree directory after git worktree add. ${command.length}/${MAX_LENGTH}`}
          autoFocus
        />

        {error && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--status-failed)",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
