import { useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import type { Group } from "~/db/schema";

export function GroupsDialog({
  open,
  groups,
  projects,
  onClose,
  onAdd,
  onRemove,
  onRename,
}: {
  open: boolean;
  groups: Group[];
  projects: { groupId: string | null }[];
  onClose: () => void;
  onAdd: (name: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  onRename: (id: string, name: string) => void | Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [addPending, setAddPending] = useState(false);
  const [renamePending, setRenamePending] = useState(false);
  const [removePendingId, setRemovePendingId] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage groups"
      width={480}
      footer={
        <Btn variant="ghost" onClick={onClose}>
          Done
        </Btn>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <TextField value={newName} onChange={setNewName} placeholder="New group name" />
          </div>
          <Btn
            variant="accent"
            icon="plus"
            disabled={addPending || !newName.trim()}
            onClick={async () => {
              if (!newName.trim() || addPending) return;
              setAddPending(true);
              try {
                await onAdd(newName.trim());
                setNewName("");
              } finally {
                setAddPending(false);
              }
            }}
          >
            {addPending ? "Adding…" : "Add"}
          </Btn>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {groups.map((g) => {
            const count = projects.filter((p) => p.groupId === g.id).length;
            const isEditing = editing?.id === g.id;
            return (
              <div
                key={g.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: "var(--surface-0)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: g.color,
                    boxShadow: `0 0 6px ${g.color}66`,
                  }}
                />
                {isEditing ? (
                  <>
                    <input
                      autoFocus
                      value={editing.name}
                      onChange={(e) =>
                        setEditing({ id: g.id, name: e.target.value })
                      }
                      onKeyDown={async (e) => {
                        if (e.key === "Enter" && editing.name.trim() && !renamePending) {
                          setRenamePending(true);
                          try {
                            await onRename(g.id, editing.name.trim());
                            setEditing(null);
                          } finally {
                            setRenamePending(false);
                          }
                        } else if (e.key === "Escape") {
                          setEditing(null);
                        }
                      }}
                      style={{
                        flex: 1,
                        background: "var(--surface-1)",
                        border: "1px solid var(--accent)",
                        borderRadius: 5,
                        outline: 0,
                        color: "var(--text)",
                        padding: "4px 8px",
                        fontFamily: "var(--mono)",
                        fontSize: 12.5,
                      }}
                    />
                    <Btn
                      size="sm"
                      variant="accent"
                      disabled={renamePending || !editing.name.trim()}
                      onClick={async () => {
                        if (!editing.name.trim() || renamePending) return;
                        setRenamePending(true);
                        try {
                          await onRename(g.id, editing.name.trim());
                          setEditing(null);
                        } finally {
                          setRenamePending(false);
                        }
                      }}
                    >
                      {renamePending ? "Saving…" : "Save"}
                    </Btn>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      title="Cancel"
                      aria-label="Cancel rename"
                      style={{
                        background: "transparent",
                        border: 0,
                        color: "var(--text-faint)",
                        cursor: "pointer",
                        padding: 4,
                        display: "flex",
                      }}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      onClick={() => setEditing({ id: g.id, name: g.name })}
                      style={{
                        flex: 1,
                        fontFamily: "var(--mono)",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                      title="Click to rename"
                    >
                      {g.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--text-faint)",
                      }}
                    >
                      {count} {count === 1 ? "project" : "projects"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing({ id: g.id, name: g.name })}
                      title="Rename"
                      aria-label={`Rename group ${g.name}`}
                      style={{
                        background: "transparent",
                        border: 0,
                        color: "var(--text-faint)",
                        cursor: "pointer",
                        padding: 4,
                        display: "flex",
                      }}
                    >
                      <Icon name="settings" size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove group ${g.name}`}
                      disabled={removePendingId === g.id}
                      onClick={async () => {
                        if (removePendingId) return;
                        if (
                          confirm(
                            `Remove group "${g.name}"?\n\nProjects in this group will become ungrouped — they aren't deleted.`
                          )
                        ) {
                          setRemovePendingId(g.id);
                          try {
                            await onRemove(g.id);
                          } finally {
                            setRemovePendingId(null);
                          }
                        }
                      }}
                      title="Remove group"
                      style={{
                        background: "transparent",
                        border: 0,
                        color: "var(--text-faint)",
                        cursor: removePendingId === g.id ? "not-allowed" : "pointer",
                        opacity: removePendingId === g.id ? 0.5 : 1,
                        padding: 4,
                        display: "flex",
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {groups.length === 0 && (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--text-faint)",
                fontFamily: "var(--mono)",
                fontSize: 12,
              }}
            >
              No groups yet
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
