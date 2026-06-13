import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { EscTooltip, Tooltip } from "~/components/ui/Tooltip";
import { Icon } from "~/components/ui/Icon";
import { CUSTOM_SCRIPTS_MAX, parseCustomScripts, type CustomScript } from "~/shared/domain";
import type { Project } from "~/db/schema";

function newRowId() {
  return `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function CustomScriptsDialog({
  open,
  project,
  onClose,
  onSave,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (scripts: CustomScript[]) => Promise<void> | void;
}) {
  const [rows, setRows] = useState<CustomScript[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRows(parseCustomScripts(project?.customScripts ?? null));
  }, [open, project?.id]);

  const update = (id: string, patch: Partial<CustomScript>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const move = (index: number, delta: number) =>
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const add = () => {
    if (rows.length >= CUSTOM_SCRIPTS_MAX) return;
    setRows((prev) => [...prev, { id: newRowId(), name: "", command: "" }]);
  };

  const save = () => {
    setError(null);
    const cleaned: CustomScript[] = [];
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
    if (cleaned.length > CUSTOM_SCRIPTS_MAX) {
      setError(`At most ${CUSTOM_SCRIPTS_MAX} scripts.`);
      return;
    }
    void Promise.resolve(onSave(cleaned))
      .then(() => onClose())
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to save");
      });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Custom scripts"
      width={640}
      footer={
        <>
          <EscTooltip label="Cancel">
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
          </EscTooltip>
          <Btn variant="primary" icon="check" onClick={save}>
            Save
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
          Configure up to {CUSTOM_SCRIPTS_MAX} scripts. Each runs on demand in its own
          terminal in the bottom panel. The first script is the default primary button;
          the rest live in its dropdown.
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
            No scripts yet. Add one to get started.
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
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="Move up"
                aria-label="Move up"
                style={{
                  background: "transparent",
                  border: 0,
                  color: i === 0 ? "var(--text-faint)" : "var(--text-dim)",
                  cursor: i === 0 ? "default" : "pointer",
                  padding: 0,
                  display: "flex",
                  opacity: i === 0 ? 0.4 : 1,
                }}
              >
                <Icon name="chevron-up" size={12} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1}
                title="Move down"
                aria-label="Move down"
                style={{
                  background: "transparent",
                  border: 0,
                  color:
                    i === rows.length - 1 ? "var(--text-faint)" : "var(--text-dim)",
                  cursor: i === rows.length - 1 ? "default" : "pointer",
                  padding: 0,
                  display: "flex",
                  opacity: i === rows.length - 1 ? 0.4 : 1,
                }}
              >
                <Icon name="chevron-down" size={12} />
              </button>
            </div>
            <input
              autoFocus={i === rows.length - 1 && !r.name && !r.command}
              value={r.name}
              onChange={(e) => update(r.id, { name: e.target.value })}
              placeholder="Name (e.g. Test)"
              aria-label="Script name"
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
              placeholder="Command (e.g. pnpm test)"
              aria-label="Command"
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
            {i === 0 && (
              <span
                title="Runs as the primary button"
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--accent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
                  borderRadius: 999,
                  padding: "1px 7px",
                  whiteSpace: "nowrap",
                }}
              >
                Primary
              </span>
            )}
            <Tooltip content="Remove">
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label="Remove script"
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
            </Tooltip>
          </div>
        ))}

        <div>
          <Btn
            variant="ghost"
            icon="plus"
            size="sm"
            onClick={add}
            disabled={rows.length >= CUSTOM_SCRIPTS_MAX}
          >
            Add script{" "}
            <span style={{ color: "var(--text-faint)", marginLeft: 6 }}>
              {rows.length}/{CUSTOM_SCRIPTS_MAX}
            </span>
          </Btn>
        </div>

        {error && (
          <div
            role="alert"
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
