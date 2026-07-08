import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { EscTooltip, Tooltip } from "~/components/ui/Tooltip";
import { Icon } from "~/components/ui/Icon";
import {
  CUSTOM_SCRIPTS_MAX,
  SCRIPT_ARGS_MAX,
  isValidScriptArgName,
  parseCustomScripts,
  type CustomScript,
  type ScriptArg,
} from "~/shared/domain";
import { shortId } from "~/shared/short-id";
import type { Project } from "~/db/schema";

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
    setRows((prev) => [...prev, { id: shortId("cs"), name: "", command: "" }]);
  };

  const addArg = (id: string) =>
    setRows((prev) =>
      prev.map((r) =>
        r.id === id && (r.args?.length ?? 0) < SCRIPT_ARGS_MAX
          ? { ...r, args: [...(r.args ?? []), { name: "", description: "" }] }
          : r
      )
    );

  const updateArg = (id: string, index: number, patch: Partial<ScriptArg>) =>
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              args: (r.args ?? []).map((a, i) => (i === index ? { ...a, ...patch } : a)),
            }
          : r
      )
    );

  const removeArg = (id: string, index: number) =>
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, args: (r.args ?? []).filter((_, i) => i !== index) } : r
      )
    );

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
      const args: ScriptArg[] = [];
      const seen = new Set<string>();
      for (const a of r.args ?? []) {
        const argName = a.name.trim();
        const description = (a.description ?? "").trim();
        if (!argName && !description) continue; // ignore empty arg rows
        if (!isValidScriptArgName(argName)) {
          setError(
            `"${name}": argument "${argName || "(blank)"}" must start with a letter or _ and use only letters, numbers, and _.`
          );
          return;
        }
        if (seen.has(argName)) {
          setError(`"${name}": duplicate argument "$${argName}".`);
          return;
        }
        seen.add(argName);
        args.push(description ? { name: argName, description } : { name: argName });
      }
      cleaned.push(args.length > 0 ? { id: r.id, name, command, args } : { id: r.id, name, command });
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
          the rest live in its dropdown. Add arguments to prompt for values (e.g. write{" "}
          <code style={{ fontFamily: "var(--mono)" }}>lpd deploy --env $ENV</code> and add an{" "}
          <code style={{ fontFamily: "var(--mono)" }}>ENV</code> argument).
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
              flexDirection: "column",
              gap: 10,
              padding: 10,
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                paddingLeft: 28,
              }}
            >
              {(r.args ?? []).map((a, ai) => (
                <div
                  key={`${r.id}-arg-${ai}`}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 13,
                      color: "var(--text-dim)",
                    }}
                  >
                    $
                  </span>
                  <input
                    value={a.name}
                    onChange={(e) => updateArg(r.id, ai, { name: e.target.value })}
                    placeholder="ARG"
                    aria-label="Argument name"
                    style={{
                      flex: "0 0 120px",
                      background: "var(--surface-1)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      padding: "5px 8px",
                      borderRadius: 6,
                      outline: "none",
                    }}
                  />
                  <input
                    value={a.description ?? ""}
                    onChange={(e) => updateArg(r.id, ai, { description: e.target.value })}
                    placeholder="Description (e.g. environment to deploy to)"
                    aria-label="Argument description"
                    style={{
                      flex: 1,
                      background: "var(--surface-1)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontFamily: "var(--sans)",
                      fontSize: 12,
                      padding: "5px 8px",
                      borderRadius: 6,
                      outline: "none",
                    }}
                  />
                  <Tooltip content="Remove argument">
                    <button
                      type="button"
                      onClick={() => removeArg(r.id, ai)}
                      aria-label="Remove argument"
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Btn
                  variant="ghost"
                  icon="plus"
                  size="sm"
                  onClick={() => addArg(r.id)}
                  disabled={(r.args?.length ?? 0) >= SCRIPT_ARGS_MAX}
                >
                  Add argument
                </Btn>
                {(r.args?.length ?? 0) === 0 && (
                  <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                    Reference as{" "}
                    <code style={{ fontFamily: "var(--mono)" }}>$name</code> in the command;
                    you'll be prompted for each value before the script runs.
                  </span>
                )}
              </div>
            </div>
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
