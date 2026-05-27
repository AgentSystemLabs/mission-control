import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { EscTooltip } from "~/components/ui/Tooltip";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import type { Group, Project } from "~/db/schema";

type GroupsDialogProject = Pick<Project, "id" | "name" | "groupId">;

export function GroupsDialog({
  open,
  groups,
  projects,
  onClose,
  onAdd,
  onRemove,
  onRename,
  onProjectGroupChange,
}: {
  open: boolean;
  groups: Group[];
  projects: GroupsDialogProject[];
  onClose: () => void;
  onAdd: (name: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  onRename: (id: string, name: string) => void | Promise<void>;
  onProjectGroupChange: (projectId: string, groupId: string | null) => void | Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [selectedProjectByGroup, setSelectedProjectByGroup] = useState<Record<string, string>>({});
  const [updatingProjectId, setUpdatingProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const assignProject = async (projectId: string, groupId: string | null) => {
    setError(null);
    setUpdatingProjectId(projectId);
    try {
      await onProjectGroupChange(projectId, groupId);
      if (groupId) {
        setSelectedProjectByGroup((current) => ({ ...current, [groupId]: "" }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update group membership");
    } finally {
      setUpdatingProjectId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage groups"
      width={620}
      footer={
        <EscTooltip label="Done">
          <Btn variant="ghost" onClick={onClose}>
            Done
          </Btn>
        </EscTooltip>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <TextField
              value={newName}
              onChange={setNewName}
              placeholder="New group name"
              ariaLabel="New group name"
            />
          </div>
          <Btn
            variant="accent"
            icon="plus"
            disabled={!newName.trim()}
            onClick={async () => {
              if (newName.trim()) {
                setError(null);
                try {
                  await onAdd(newName.trim());
                  setNewName("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not add group");
                }
              }
            }}
          >
            Add
          </Btn>
        </div>
        {error && (
          <div
            style={{
              padding: "8px 12px",
              border: "1px solid var(--status-failed)",
              background: "color-mix(in oklch, var(--status-failed) 12%, transparent)",
              borderRadius: 7,
              color: "var(--status-failed)",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {groups.map((g) => {
            const count = projects.filter((p) => p.groupId === g.id).length;
            const isEditing = editing?.id === g.id;
            const groupProjects = projects.filter((p) => p.groupId === g.id);
            const availableProjects = projects.filter((p) => p.groupId !== g.id);
            const selectedProjectId = selectedProjectByGroup[g.id] ?? "";
            return (
              <div
                key={g.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: "10px 12px",
                  background: "var(--surface-0)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                          if (e.key === "Enter" && editing.name.trim()) {
                            await onRename(g.id, editing.name.trim());
                            setEditing(null);
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
                        onClick={async () => {
                          if (editing.name.trim()) {
                            await onRename(g.id, editing.name.trim());
                            setEditing(null);
                          }
                        }}
                      >
                        Save
                      </Btn>
                      <button
                        onClick={() => setEditing(null)}
                        title="Cancel"
                        aria-label={`Cancel renaming ${g.name}`}
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
                        onClick={() => setEditing({ id: g.id, name: g.name })}
                        title="Rename"
                        aria-label={`Rename ${g.name}`}
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
                        onClick={async () => {
                          if (
                            confirm(
                              `Remove group "${g.name}"?\n\nProjects in this group will become ungrouped — they aren't deleted.`
                            )
                          ) {
                            await onRemove(g.id);
                          }
                        }}
                        title="Remove group"
                        aria-label={`Remove ${g.name}`}
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
                    </>
                  )}
                </div>
                {!isEditing && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      borderTop: "1px solid var(--border)",
                      paddingTop: 10,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {groupProjects.map((project) => (
                        <div
                          key={project.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minHeight: 28,
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "var(--text)",
                              fontFamily: "var(--mono)",
                              fontSize: 11.5,
                            }}
                            title={project.name}
                          >
                            {project.name}
                          </span>
                          <Btn
                            size="sm"
                            variant="ghost"
                            icon="x"
                            onClick={() => void assignProject(project.id, null)}
                            disabled={updatingProjectId === project.id}
                            aria-label={`Remove ${project.name} from ${g.name}`}
                          >
                            Remove
                          </Btn>
                        </div>
                      ))}
                      {groupProjects.length === 0 && (
                        <div
                          style={{
                            color: "var(--text-faint)",
                            fontFamily: "var(--mono)",
                            fontSize: 11,
                          }}
                        >
                          No projects in this group
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select
                        value={selectedProjectId}
                        onChange={(e) =>
                          setSelectedProjectByGroup((current) => ({
                            ...current,
                            [g.id]: e.target.value,
                          }))
                        }
                        disabled={availableProjects.length === 0}
                        aria-label={`Project to add to ${g.name}`}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          background: "var(--surface-1)",
                          border: "1px solid var(--border)",
                          borderRadius: 7,
                          color: selectedProjectId ? "var(--text)" : "var(--text-faint)",
                          padding: "8px 10px",
                          fontFamily: "var(--mono)",
                          fontSize: 11.5,
                          outline: 0,
                        }}
                      >
                        <option value="">
                          {availableProjects.length === 0 ? "All projects are in this group" : "Add project…"}
                        </option>
                        {availableProjects.map((project) => {
                          const currentGroup = project.groupId
                            ? groupNameById.get(project.groupId)
                            : null;
                          const suffix = currentGroup ? ` - from ${currentGroup}` : " - ungrouped";
                          return (
                            <option key={project.id} value={project.id}>
                              {project.name}
                              {suffix}
                            </option>
                          );
                        })}
                      </select>
                      <Btn
                        size="sm"
                        variant="accent"
                        icon="plus"
                        disabled={!selectedProjectId || updatingProjectId === selectedProjectId}
                        onClick={() => void assignProject(selectedProjectId, g.id)}
                      >
                        Add
                      </Btn>
                    </div>
                  </div>
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
