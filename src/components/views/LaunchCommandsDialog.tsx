import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { LAUNCH_COMMANDS_MAX, parseLaunchCommands, type LaunchCommand } from "~/shared/domain";
import type { Project } from "~/db/schema";

function newRowId() {
  return `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function LaunchCommandsDialog({
  open,
  project,
  onClose,
  onSave,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (commands: LaunchCommand[]) => Promise<void> | void;
}) {
  const [rows, setRows] = useState<LaunchCommand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setRows(parseLaunchCommands(project?.launchCommands ?? null));
  }, [open, project?.id]);

  const update = (id: string, patch: Partial<LaunchCommand>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const add = () => {
    if (rows.length >= LAUNCH_COMMANDS_MAX) return;
    setRows((prev) => [...prev, { id: newRowId(), name: "", command: "" }]);
  };

  const save = async () => {
    setError(null);
    const cleaned: LaunchCommand[] = [];
    for (const r of rows) {
      const name = r.name.trim();
      const command = r.command.trim();
      if (!name && !command) continue; // ignore empty rows
      if (!name || !command) {
        setError("Every row needs both a name and a command.");
        return;
      }
      cleaned.push({ id: r.id, name, command });
    }
    if (cleaned.length > LAUNCH_COMMANDS_MAX) {
      setError(`At most ${LAUNCH_COMMANDS_MAX} commands.`);
      return;
    }
    try {
      setSaving(true);
      await onSave(cleaned);
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
      title="Launch commands"
      width={640}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Btn>
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
          Configure up to {LAUNCH_COMMANDS_MAX} commands. Pressing Launch kills any matching
          managed terminals and spawns one new terminal per command in the bottom panel.
        </p>

        {rows.length === 0 && (
          <div
            style={{
              padding: 16,
              border: "1px dashed var(--border)",
              borderRadius: 8,
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--text-faint)",
              textAlign: "center",
            }}
          >
            No commands yet. Add one to get started.
          </div>
        )}

        {rows.map((r, i) => (
          <div
            key={r.id}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: 10,
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-faint)",
                width: 16,
                textAlign: "center",
              }}
            >
              {i + 1}
            </span>
            <input
              autoFocus={i === rows.length - 1 && !r.name && !r.command}
              value={r.name}
              onChange={(e) => update(r.id, { name: e.target.value })}
              placeholder="Name (e.g. dev)"
              style={{
                flex: "0 0 160px",
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontFamily: "var(--sans)",
                fontSize: 12.5,
                padding: "6px 8px",
                borderRadius: 6,
                outline: "none",
              }}
            />
            <input
              value={r.command}
              onChange={(e) => update(r.id, { command: e.target.value })}
              placeholder="Command (e.g. pnpm dev)"
              style={{
                flex: 1,
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                padding: "6px 8px",
                borderRadius: 6,
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => remove(r.id)}
              title="Remove"
              aria-label="Remove launch command"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--text-faint)",
                cursor: "pointer",
                padding: 4,
                display: "flex",
              }}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}

        <div>
          <Btn
            variant="ghost"
            icon="plus"
            size="sm"
            onClick={add}
            disabled={rows.length >= LAUNCH_COMMANDS_MAX}
          >
            Add command{" "}
            <span style={{ color: "var(--text-faint)", marginLeft: 6 }}>
              {rows.length}/{LAUNCH_COMMANDS_MAX}
            </span>
          </Btn>
        </div>

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
