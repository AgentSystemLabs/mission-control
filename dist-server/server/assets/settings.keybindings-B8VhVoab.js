import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useState, useMemo, useRef, useEffect } from "react";
import { j as useKeybindings, H as HOTKEY_ACTIONS, k as bindingComboKey, l as bindingsEqual, D as DEFAULT_BINDINGS, B as Btn, A as ACTION_META, m as formatBinding, n as Kbd, o as eventToBinding, p as isValidBinding } from "./router-XpjizlSW.js";
import { S as SettingsSection } from "./SettingsParts-BVRE1z9n.js";
import "@tanstack/react-router";
import "@tanstack/react-router-with-query";
import "@tanstack/react-query";
function KeybindingsSettings() {
  const { bindings, setBinding, resetBinding, resetAll } = useKeybindings();
  const [recordingFor, setRecordingFor] = useState(null);
  const [pendingBinding, setPendingBinding] = useState(null);
  const [recordError, setRecordError] = useState(null);
  const [saving, setSaving] = useState(false);
  const conflicts = useMemo(() => {
    const byCombo = /* @__PURE__ */ new Map();
    for (const action of HOTKEY_ACTIONS) {
      const k = bindingComboKey(bindings[action]);
      const arr = byCombo.get(k) ?? [];
      arr.push(action);
      byCombo.set(k, arr);
    }
    const conflicting = /* @__PURE__ */ new Set();
    for (const arr of byCombo.values()) {
      if (arr.length > 1) for (const a of arr) conflicting.add(a);
    }
    return conflicting;
  }, [bindings]);
  const pendingConflict = useMemo(() => {
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
  const startRecording = (action) => {
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
    } catch (e) {
      setRecordError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };
  const onReset = async (action) => {
    await resetBinding(action);
    if (recordingFor === action) cancelRecording();
  };
  const onResetAll = async () => {
    await resetAll();
    cancelRecording();
  };
  return /* @__PURE__ */ jsxs("div", { children: [
    conflicts.size > 0 && /* @__PURE__ */ jsx(ConflictBanner, { count: conflicts.size }),
    /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: HOTKEY_ACTIONS.map((action) => /* @__PURE__ */ jsx(
      BindingRow,
      {
        action,
        binding: bindings[action],
        isDefault: bindingsEqual(bindings[action], DEFAULT_BINDINGS[action]),
        recording: recordingFor === action,
        pendingBinding: recordingFor === action ? pendingBinding : null,
        pendingConflict: recordingFor === action ? pendingConflict : null,
        recordError: recordingFor === action ? recordError : null,
        saving,
        inConflict: conflicts.has(action),
        onStartRecording: () => startRecording(action),
        onCancelRecording: cancelRecording,
        onCapture: (b) => {
          setPendingBinding(b);
          setRecordError(null);
        },
        onCaptureError: (msg) => setRecordError(msg),
        onSave: saveRecording,
        onReset: () => onReset(action)
      },
      action
    )) }),
    /* @__PURE__ */ jsx("div", { style: { marginTop: 16, display: "flex", justifyContent: "flex-end" }, children: /* @__PURE__ */ jsx(Btn, { variant: "ghost", size: "sm", icon: "refresh", onClick: onResetAll, children: "Reset all to defaults" }) })
  ] });
}
function ConflictBanner({ count }) {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      role: "alert",
      style: {
        marginBottom: 12,
        padding: "8px 12px",
        border: "1px solid #b04a4a",
        background: "rgba(176, 74, 74, 0.12)",
        color: "#ff9b9b",
        borderRadius: 6,
        fontFamily: "var(--mono)",
        fontSize: 11
      },
      children: [
        count,
        " actions share the same shortcut. Resolve the conflicts below."
      ]
    }
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
  onReset
}) {
  const captureRef = useRef(null);
  useEffect(() => {
    if (!recording) return;
    captureRef.current?.focus();
    const onKey = (e) => {
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
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: inConflict ? "rgba(176, 74, 74, 0.08)" : "var(--surface-0)",
        border: `1px solid ${inConflict ? "#b04a4a" : "var(--border)"}`,
        borderRadius: 7
      },
      children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { style: { fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600 }, children: meta.label }),
          /* @__PURE__ */ jsx("div", { style: { fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-dim)", marginTop: 2 }, children: meta.description })
        ] }),
        /* @__PURE__ */ jsx("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: recording ? /* @__PURE__ */ jsxs(
          "div",
          {
            ref: captureRef,
            tabIndex: 0,
            "aria-label": "Press a key combination to bind",
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              border: `1px dashed ${pendingConflict ? "#b04a4a" : "var(--accent)"}`,
              borderRadius: 6,
              outline: "none",
              minWidth: 220,
              fontFamily: "var(--mono)",
              fontSize: 11
            },
            children: [
              /* @__PURE__ */ jsx("span", { style: { color: pendingConflict ? "#ff9b9b" : "var(--text-dim)" }, children: pendingBinding ? formatBinding(pendingBinding) : "Press keys…" }),
              pendingConflict && /* @__PURE__ */ jsxs("span", { style: { color: "#ff9b9b" }, children: [
                "conflicts with “",
                ACTION_META[pendingConflict].label,
                "”"
              ] }),
              recordError && !pendingConflict && /* @__PURE__ */ jsx("span", { style: { color: "#ff9b9b" }, children: recordError }),
              /* @__PURE__ */ jsxs(
                Btn,
                {
                  variant: "ghost",
                  size: "sm",
                  onClick: onCancelRecording,
                  style: { marginLeft: "auto" },
                  children: [
                    "Cancel ",
                    /* @__PURE__ */ jsx(Kbd, { variant: "inline", children: "Esc" })
                  ]
                }
              ),
              /* @__PURE__ */ jsxs(
                Btn,
                {
                  variant: "primary",
                  size: "sm",
                  onClick: onSave,
                  disabled: !pendingBinding || !!pendingConflict || saving,
                  children: [
                    "Save ",
                    /* @__PURE__ */ jsx(Kbd, { variant: "onPrimary", children: "↵" })
                  ]
                }
              )
            ]
          }
        ) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Kbd, { variant: "ghost", children: formatBinding(binding) }),
          /* @__PURE__ */ jsx(Btn, { variant: "ghost", size: "sm", onClick: onStartRecording, children: "Rebind" }),
          !isDefault && /* @__PURE__ */ jsx(Btn, { variant: "ghost", size: "sm", onClick: onReset, children: "Reset" })
        ] }) })
      ]
    }
  );
}
function KeybindingsPage() {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("h1", { style: {
      margin: "0 0 24px",
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: "-0.015em"
    }, children: "Keybindings" }),
    /* @__PURE__ */ jsx(SettingsSection, { title: "Keybindings", subtitle: "Rebind any global app shortcut. Bindings are saved per-app and apply immediately.", children: /* @__PURE__ */ jsx(KeybindingsSettings, {}) })
  ] });
}
export {
  KeybindingsPage as component
};
