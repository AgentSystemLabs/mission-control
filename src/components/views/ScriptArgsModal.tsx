import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip, StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { substituteScriptArgs, type CustomScript } from "~/shared/domain";

const inputStyle = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontFamily: "var(--sans)",
  fontSize: 12.5,
  padding: "6px 8px",
  borderRadius: 6,
  outline: "none",
  width: "100%",
} as const;

/**
 * Run-time prompt for a custom script that declares `$arg` placeholders. Collects
 * one value per arg, previews the resolved command, and hands the substituted
 * command back to the caller. Mirrors ConfirmDialog hotkeys: Cmd/Ctrl+Enter (and
 * Enter) to run when every field is filled, Esc to cancel.
 */
export function ScriptArgsModal({
  open,
  script,
  onCancel,
  onRun,
}: {
  open: boolean;
  script: CustomScript | null;
  onCancel: () => void;
  onRun: (resolvedCommand: string) => void;
}) {
  const args = script?.args ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Reset the form whenever a different script opens the modal, and move focus to
  // the first field. This effect runs after the shared Modal's panel-focus effect
  // (parent effects fire after child effects), so it wins the initial focus.
  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    for (const a of args) initial[a.name] = "";
    setValues(initial);
    firstInputRef.current?.focus();
  }, [open, script?.id]);

  const canRun = args.length > 0 && args.every((a) => (values[a.name] ?? "").trim() !== "");

  const preview = useMemo(
    () => (script ? substituteScriptArgs(script.command, values) : ""),
    [script, values]
  );

  const submit = () => {
    if (!script || !canRun) return;
    onRun(substituteScriptArgs(script.command, values));
  };

  useHotkey("mod+enter", (e) => { e.preventDefault(); e.stopPropagation(); submit(); }, {
    enabled: open && canRun,
  });
  useHotkey("enter", (e) => { e.preventDefault(); e.stopPropagation(); submit(); }, {
    enabled: open && canRun,
  });

  if (!script) return null;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Run ${script.name}`}
      width={560}
      footer={
        <>
          <StaticHotkeyTooltip hotkey="Esc">
            <Btn variant="ghost" onClick={onCancel}>
              Cancel
            </Btn>
          </StaticHotkeyTooltip>
          <HotkeyTooltip action="dialog.submit">
            <Btn variant="primary" icon="play" onClick={submit} disabled={!canRun}>
              Run
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {args.map((arg, i) => {
          const inputId = `script-arg-${arg.name}`;
          const descId = arg.description ? `${inputId}-desc` : undefined;
          return (
            <div
              key={arg.name}
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <label
                htmlFor={inputId}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--text)",
                }}
              >
                ${arg.name}
              </label>
              {arg.description && (
                <span
                  id={descId}
                  style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.4 }}
                >
                  {arg.description}
                </span>
              )}
              <input
                id={inputId}
                ref={i === 0 ? firstInputRef : undefined}
                aria-describedby={descId}
                value={values[arg.name] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [arg.name]: e.target.value }))
                }
                placeholder={`Value for $${arg.name}`}
                style={inputStyle}
              />
            </div>
          );
        })}

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Command preview</span>
          <code
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--text-dim)",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              wordBreak: "break-all",
            }}
          >
            {preview}
          </code>
        </div>
      </div>
    </Modal>
  );
}
