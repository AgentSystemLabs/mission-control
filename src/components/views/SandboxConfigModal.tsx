import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { SandboxConfigPanel } from "~/components/views/SandboxConfigPanel";
import { api } from "~/lib/api";
import { queryKeys, useSandboxes } from "~/queries";

const iconButtonStyle = {
  background: "transparent",
  border: 0,
  color: "var(--text-dim)",
  cursor: "pointer",
  padding: 4,
  display: "flex",
  flexShrink: 0,
} as const;

function SandboxModalTitle({
  sandboxId,
  name,
  active,
}: {
  sandboxId: string;
  name: string;
  active: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!active) setEditing(false);
  }, [active]);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [editing, name]);

  const cancel = () => {
    setEditing(false);
    setDraft(name);
  };

  const confirm = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      cancel();
      return;
    }

    setSaving(true);
    try {
      const { sandbox: next } = await api.updateSandbox(sandboxId, { name: trimmed });
      queryClient.setQueryData(queryKeys.sandboxes, (current: Awaited<ReturnType<typeof api.listSandboxes>> | undefined) =>
        current
          ? {
              ...current,
              sandboxes: current.sandboxes.map((s) => (s.id === next.id ? next : s)),
            }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes });
      setEditing(false);
    } catch (error) {
      console.error("[sandbox] failed to rename:", error);
      cancel();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, width: "100%" }}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void confirm();
            else if (e.key === "Escape") cancel();
          }}
          disabled={saving}
          aria-label="Sandbox name"
          style={{
            flex: "0 1 auto",
            width: "100%",
            maxWidth: 240,
            minWidth: 0,
            background: "var(--surface-0)",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: 0,
            color: "var(--text)",
            padding: "4px 8px",
            fontFamily: "var(--mono)",
            fontSize: 12,
            fontWeight: 600,
          }}
        />
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={saving || !draft.trim()}
          title="Save name"
          aria-label="Save sandbox name"
          style={{
            ...iconButtonStyle,
            color: draft.trim() ? "var(--accent-ink)" : "var(--text-faint)",
            cursor: saving || !draft.trim() ? "not-allowed" : "pointer",
          }}
        >
          <Icon name="check" size={13} />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          title="Cancel"
          aria-label="Cancel renaming sandbox"
          style={iconButtonStyle}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to rename"
      style={{
        background: "transparent",
        border: 0,
        padding: 0,
        margin: 0,
        minWidth: 0,
        width: "100%",
        textAlign: "left",
        fontFamily: "var(--mono)",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: "var(--text)",
        cursor: "pointer",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {name}
    </button>
  );
}

export function SandboxConfigModal({
  open,
  onClose,
  sandboxId,
}: {
  open: boolean;
  onClose: () => void;
  sandboxId: string | null;
}) {
  const { data: scopes } = useSandboxes();
  const sandbox = sandboxId ? scopes?.sandboxes.find((s) => s.id === sandboxId) : null;
  const title =
    sandboxId && sandbox ? (
      <SandboxModalTitle sandboxId={sandboxId} name={sandbox.name} active={open} />
    ) : (
      "Sandbox"
    );

  return (
    <Modal
      open={open && !!sandboxId}
      onClose={onClose}
      closeOnBackdropClick={false}
      title={title}
      width={560}
      maxHeight="90vh"
      contentStyle={{ padding: "12px 18px 18px" }}
    >
      {sandboxId && <SandboxConfigPanel sandboxId={sandboxId} onDeleted={onClose} />}
    </Modal>
  );
}
