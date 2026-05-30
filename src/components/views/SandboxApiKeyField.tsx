import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Icon } from "~/components/ui/Icon";
import { api, ApiError } from "~/lib/api";
import { getElectron } from "~/lib/electron";

const SAVED_KEY_MASK_LEN = 24;
const STATUS_MS = 1800;

const iconButtonStyle: CSSProperties = {
  background: "transparent",
  border: 0,
  color: "var(--text-dim)",
  cursor: "pointer",
  padding: 4,
  display: "flex",
  flexShrink: 0,
};

export function SandboxApiKeyField({
  sandboxId,
  value,
  onChange,
  hasSavedKey,
  onWriteClipboard,
  ariaInvalid,
}: {
  sandboxId: string;
  value: string;
  onChange: (value: string) => void;
  hasSavedKey: boolean;
  onWriteClipboard: (text: string) => Promise<void>;
  ariaInvalid?: boolean;
}) {
  const inputId = useId();
  const statusTimerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [loadingSavedKey, setLoadingSavedKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setVisible(false);
    setIsEditing(false);
    setSavedKey(null);
    setLoadingSavedKey(false);
    setStatus(null);
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, [sandboxId]);

  useEffect(
    () => () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    },
    [],
  );

  const showStatus = (message: string) => {
    setStatus(message);
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => {
      setStatus(null);
      statusTimerRef.current = null;
    }, STATUS_MS);
  };

  const showingSaved = hasSavedKey && !isEditing && !value;
  const canReveal = !!value.trim() || hasSavedKey;

  const loadSavedKey = async (): Promise<string | null> => {
    if (savedKey) return savedKey;
    setLoadingSavedKey(true);
    try {
      const electron = getElectron();
      if (electron) {
        const result = await electron.sandbox.revealApiKey(sandboxId);
        if (result.ok) {
          setSavedKey(result.apiKey);
          return result.apiKey;
        }
      }

      const { apiKey } = await api.revealSandboxApiKey(sandboxId);
      setSavedKey(apiKey);
      return apiKey;
    } catch (error) {
      console.error("[sandbox] failed to reveal API key:", error);
      const message =
        error instanceof ApiError && error.status === 404
          ? "No saved API key"
          : "Could not load saved key";
      showStatus(message);
      return null;
    } finally {
      setLoadingSavedKey(false);
    }
  };

  const resolveCopyText = async (): Promise<string | null> => {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
    if (!hasSavedKey) return null;
    return loadSavedKey();
  };

  const beginEditing = (nextValue = "") => {
    setIsEditing(true);
    setVisible(false);
    onChange(nextValue);
  };

  const toggleVisible = async () => {
    if (visible) {
      setVisible(false);
      showStatus("Key hidden");
      return;
    }
    if (value.trim()) {
      setVisible(true);
      showStatus("Key visible");
      return;
    }
    if (hasSavedKey) {
      const key = await loadSavedKey();
      if (key) {
        setVisible(true);
        showStatus("Key visible");
      }
    }
  };

  const copyKey = async () => {
    const text = await resolveCopyText();
    if (!text) {
      if (!hasSavedKey && !value.trim()) showStatus("Nothing to copy");
      return;
    }
    try {
      await onWriteClipboard(text);
      showStatus("Copied");
    } catch (error) {
      console.error("[sandbox] failed to copy API key:", error);
      showStatus("Copy failed");
    }
  };

  const displayValue = value
    ? value
    : showingSaved
      ? visible && savedKey
        ? savedKey
        : "*".repeat(savedKey?.length ?? SAVED_KEY_MASK_LEN)
      : "";
  const readOnly = showingSaved;
  const maskTypedValue = !!value.trim() && !visible;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        htmlFor={inputId}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          fontWeight: 500,
          color: "var(--text-dim)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        API key
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          overflow: "hidden",
        }}
      >
        <input
          id={inputId}
          type="text"
          value={displayValue}
          readOnly={readOnly}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            if (!next.trim() && hasSavedKey) {
              setIsEditing(false);
              setVisible(false);
            } else {
              setIsEditing(true);
            }
          }}
          onKeyDown={(e) => {
            if (!showingSaved) return;
            if (e.key === "Backspace" || e.key === "Delete") {
              e.preventDefault();
              beginEditing("");
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              beginEditing(e.key);
            }
          }}
          placeholder={hasSavedKey ? "Enter a new key to rotate" : "Paste MC_AGENT_API_KEY"}
          aria-label="Remote API key"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={ariaInvalid}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: 0,
            outline: 0,
            color: "var(--text)",
            padding: "9px 12px",
            fontFamily: "var(--mono)",
            fontSize: 13,
            cursor: readOnly ? "default" : "text",
            ...(maskTypedValue ? ({ WebkitTextSecurity: "asterisk" } as CSSProperties) : null),
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 2, paddingRight: 6 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void copyKey();
            }}
            disabled={!canReveal || loadingSavedKey}
            title="Copy API key"
            aria-label="Copy API key"
            style={{
              ...iconButtonStyle,
              cursor: !canReveal || loadingSavedKey ? "not-allowed" : "pointer",
            }}
          >
            <Icon name="copy" size={13} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void toggleVisible();
            }}
            disabled={!canReveal || loadingSavedKey}
            title={visible ? "Hide API key" : "Show API key"}
            aria-label={visible ? "Hide API key" : "Show API key"}
            aria-pressed={visible}
            style={{
              ...iconButtonStyle,
              cursor: !canReveal || loadingSavedKey ? "not-allowed" : "pointer",
            }}
          >
            <Icon name={visible ? "eye-off" : "eye"} size={13} />
          </button>
        </div>
      </div>
      {status && (
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: 0,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--accent)",
          }}
        >
          {status}
        </p>
      )}
    </div>
  );
}
