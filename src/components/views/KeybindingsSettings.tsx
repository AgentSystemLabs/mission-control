import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Btn } from "~/components/ui/Btn";
import { KbdCombo } from "~/components/ui/Kbd";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { useKeybindings } from "~/lib/keybindings/store";
import { bindingComboKey, bindingsEqual, eventToBinding, isValidBinding } from "~/lib/keybindings/match";
import { DEFAULT_BINDINGS } from "~/lib/keybindings/defaults";
import { KEYBINDING_GROUPS } from "~/lib/keybindings/groups";
import { formatPinnedSlotBindingParts } from "~/lib/keybindings/format";
import { ACTION_META, HOTKEY_ACTIONS, type Binding, type HotkeyAction } from "~/lib/keybindings/types";

export function KeybindingsSettings() {
  const { bindings, setBinding, resetBinding, resetAll } = useKeybindings();
  const [recordingFor, setRecordingFor] = useState<HotkeyAction | null>(null);
  const [pendingBinding, setPendingBinding] = useState<Binding | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Conflict map across all current bindings.
  const conflicts = useMemo(() => {
    const byCombo = new Map<string, HotkeyAction[]>();
    for (const action of HOTKEY_ACTIONS) {
      const k = bindingComboKey(bindings[action]);
      const arr = byCombo.get(k) ?? [];
      arr.push(action);
      byCombo.set(k, arr);
    }
    const conflicting = new Set<HotkeyAction>();
    for (const arr of byCombo.values()) {
      if (arr.length > 1) for (const a of arr) conflicting.add(a);
    }
    return conflicting;
  }, [bindings]);

  // Conflict for the *pending* (unsaved) capture: would it collide with another action?
  const pendingConflict = useMemo<HotkeyAction | null>(() => {
    if (!recordingFor || !pendingBinding) return null;
    const k = bindingComboKey(pendingBinding);
    for (const action of HOTKEY_ACTIONS) {
      if (action === recordingFor) continue;
      if (bindingComboKey(bindings[action]) === k) return action;
    }
    return null;
  }, [recordingFor, pendingBinding, bindings]);

  const cancelRecording = () => {
    setRecordingFor(null);
    setPendingBinding(null);
    setRecordError(null);
  };

  const startRecording = (action: HotkeyAction) => {
    setRecordingFor(action);
    setPendingBinding(null);
    setRecordError(null);
  };

  const saveRecording = async () => {
    if (!recordingFor || !pendingBinding || pendingConflict || saving) return;
    setSaving(true);
    try {
      await setBinding(recordingFor, pendingBinding);
      cancelRecording();
    } catch (e: any) {
      setRecordError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const onReset = async (action: HotkeyAction) => {
    await resetBinding(action);
    if (recordingFor === action) cancelRecording();
  };

  const onResetAll = async () => {
    await resetAll();
    cancelRecording();
  };

  return (
    <div>
      {conflicts.size > 0 && (
        <ConflictBanner count={conflicts.size} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {KEYBINDING_GROUPS.map((group) => (
          <BindingGroup
            key={group.id}
            label={group.label}
            description={group.description}
          >
            {group.actions.map((action) => (
              <BindingRow
                key={action}
                action={action}
                binding={bindings[action]}
                isDefault={bindingsEqual(bindings[action], DEFAULT_BINDINGS[action])}
                recording={recordingFor === action}
                pendingBinding={recordingFor === action ? pendingBinding : null}
                pendingConflict={recordingFor === action ? pendingConflict : null}
                recordError={recordingFor === action ? recordError : null}
                saving={saving}
                inConflict={conflicts.has(action)}
                onStartRecording={() => startRecording(action)}
                onCancelRecording={cancelRecording}
                onCapture={(b) => {
                  setPendingBinding(b);
                  setRecordError(null);
                }}
                onCaptureError={(msg) => setRecordError(msg)}
                onSave={saveRecording}
                onReset={() => onReset(action)}
              />
            ))}
          </BindingGroup>
        ))}
      </div>
      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <Btn variant="ghost" size="sm" icon="refresh" onClick={onResetAll}>
          Reset all to defaults
        </Btn>
      </div>
    </div>
  );
}

function ConflictBanner({ count }: { count: number }) {
  return (
    <div
      role="alert"
      style={{
        marginBottom: 12,
        padding: "8px 12px",
        border: "1px solid #b04a4a",
        background: "rgba(176, 74, 74, 0.12)",
        color: "#ff9b9b",
        borderRadius: 6,
        fontFamily: "var(--mono)",
        fontSize: 11,
      }}
    >
      {count} actions share the same shortcut. Resolve the conflicts below.
    </div>
  );
}

function BindingGroup({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div style={{ marginBottom: 10 }}>
        <h2
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text)",
            margin: "0 0 4px",
          }}
        >
          {label}
        </h2>
        <p
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--text-dim)",
            lineHeight: 1.45,
            margin: 0,
          }}
        >
          {description}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </section>
  );
}

function BindingRow({
  action,
  binding,
  isDefault,
  recording,
  pendingBinding,
  pendingConflict,
  recordError,
  saving,
  inConflict,
  onStartRecording,
  onCancelRecording,
  onCapture,
  onCaptureError,
  onSave,
  onReset,
}: {
  action: HotkeyAction;
  binding: Binding;
  isDefault: boolean;
  recording: boolean;
  pendingBinding: Binding | null;
  pendingConflict: HotkeyAction | null;
  recordError: string | null;
  saving: boolean;
  inConflict: boolean;
  onStartRecording: () => void;
  onCancelRecording: () => void;
  onCapture: (b: Binding) => void;
  onCaptureError: (msg: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const captureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!recording) return;
    captureRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRecording();
        return;
      }
      if (e.key === "Enter" && pendingBinding && !pendingConflict) {
        e.preventDefault();
        onSave();
        return;
      }
      const candidate = eventToBinding(e);
      if (!candidate) return;
      e.preventDefault();
      e.stopPropagation();
      const valid = isValidBinding(candidate);
      if (!valid.ok) {
        onCaptureError(valid.reason);
        return;
      }
      onCapture(candidate);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, pendingBinding, pendingConflict, onCancelRecording, onSave, onCapture, onCaptureError]);

  const meta = ACTION_META[action];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: inConflict ? "rgba(176, 74, 74, 0.08)" : "var(--surface-0)",
        border: `1px solid ${inConflict ? "#b04a4a" : "var(--border)"}`,
        borderRadius: 7,
      }}
    >
      <div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600 }}>
          {meta.label}
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-dim)", marginTop: 2 }}>
          {meta.description}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {recording ? (
          <div
            ref={captureRef}
            tabIndex={0}
            aria-label="Press a key combination to bind"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              border: `1px dashed ${pendingConflict ? "#b04a4a" : "var(--accent)"}`,
              borderRadius: 6,
              outline: "none",
              minWidth: 220,
              fontFamily: "var(--mono)",
              fontSize: 11,
            }}
          >
            {pendingBinding ? (
              <KbdCombo binding={pendingBinding} variant="ghost" size="lg" />
            ) : (
              <span style={{ color: pendingConflict ? "#ff9b9b" : "var(--text-dim)" }}>
                Press keys…
              </span>
            )}
            {pendingConflict && (
              <span style={{ color: "#ff9b9b" }}>
                conflicts with “{ACTION_META[pendingConflict].label}”
              </span>
            )}
            {recordError && !pendingConflict && (
              <span style={{ color: "#ff9b9b" }}>{recordError}</span>
            )}
            <StaticHotkeyTooltip hotkey="Esc">
              <Btn
                variant="ghost"
                size="sm"
                onClick={onCancelRecording}
                style={{ marginLeft: "auto" }}
              >
                Cancel
              </Btn>
            </StaticHotkeyTooltip>
            <StaticHotkeyTooltip hotkey="↵">
              <Btn
                variant="primary"
                size="sm"
                onClick={onSave}
                disabled={!pendingBinding || !!pendingConflict || saving}
              >
                Save
              </Btn>
            </StaticHotkeyTooltip>
          </div>
        ) : (
          <>
            {action === "project.pinnedSlot" ? (
              <KbdCombo parts={formatPinnedSlotBindingParts(binding)} variant="ghost" size="lg" />
            ) : (
              <KbdCombo binding={binding} variant="ghost" size="lg" />
            )}
            <Btn variant="ghost" size="sm" onClick={onStartRecording}>
              Rebind
            </Btn>
            {!isDefault && (
              <Btn variant="ghost" size="sm" onClick={onReset}>
                Reset
              </Btn>
            )}
          </>
        )}
      </div>
    </div>
  );
}
