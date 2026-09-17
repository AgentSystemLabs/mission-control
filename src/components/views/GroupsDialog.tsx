import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Modal } from "~/components/ui/Modal";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { FormErrorBox } from "~/components/ui/FormErrorBox";
import { Btn } from "~/components/ui/Btn";
import { EscTooltip } from "~/components/ui/Tooltip";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { GROUP_COLORS } from "~/lib/design-meta";
import { reorderPinnedIds } from "~/lib/pinned-project-order";
import {
  clampVerticalDragDelta,
  verticalDragSettleDelta,
  verticalDragShifts,
  verticalDragTargetIndex,
  type VerticalDragRow,
} from "~/lib/vertical-reorder-drag";
import type { Group, Project } from "~/db/schema";

const DRAG_THRESHOLD_PX = 4;
const GROUP_GAP = 6;
const DRAG_SETTLE_MS = 200;
const DRAG_SETTLE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

type GroupsDialogProject = Pick<Project, "id" | "name" | "groupId">;

export function GroupsDialog({
  open,
  groups,
  projects,
  onClose,
  onAdd,
  onRemove,
  onRename,
  onRecolor,
  onReorder,
  onProjectGroupChange,
}: {
  open: boolean;
  groups: Group[];
  projects: GroupsDialogProject[];
  onClose: () => void;
  onAdd: (name: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  onRename: (id: string, name: string) => void | Promise<void>;
  onRecolor: (id: string, color: string) => void | Promise<void>;
  onReorder: (orderedIds: string[]) => void | Promise<void>;
  onProjectGroupChange: (projectId: string, groupId: string | null) => void | Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [selectedProjectByGroup, setSelectedProjectByGroup] = useState<Record<string, string>>({});
  const [updatingProjectId, setUpdatingProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Group | null>(null);
  const [removing, setRemoving] = useState(false);
  const [recoloringId, setRecoloringId] = useState<string | null>(null);
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));

  // Manual reorder. `dragOrder` overrides the prop order while dragging or
  // while an optimistic reorder is in flight; it resets to follow the props
  // (server truth) once they reflect the new order.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  // Keep the DOM order frozen during a pointer drag. The grabbed card follows
  // the pointer while neighboring cards translate aside to expose its landing
  // slot; only after the drop settles do we commit the new array order.
  const [groupDrag, setGroupDrag] = useState<{
    id: string;
    delta: number;
    shifts: Record<string, number>;
    settling: boolean;
  } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);
  const dragSettlingRef = useRef(false);
  const dragSettleTimerRef = useRef<number | null>(null);
  const groupIds = useMemo(() => groups.map((group) => group.id), [groups]);
  const orderedGroups = useMemo(() => {
    if (!dragOrder) return groups;
    const byId = new Map(groups.map((group) => [group.id, group]));
    return dragOrder.flatMap((id) => {
      const group = byId.get(id);
      return group ? [group] : [];
    });
  }, [dragOrder, groups]);

  // Once the props catch up to (or diverge from) the optimistic order, stop
  // overriding — the server list is authoritative again.
  useEffect(() => {
    if (!dragOrder) return;
    if (groupDrag) return;
    if (dragOrder.join("\0") === groupIds.join("\0")) {
      setDragOrder(null);
      dragOrderRef.current = null;
    }
  }, [dragOrder, groupDrag, groupIds]);

  useEffect(() => {
    if (open) {
      setError(null);
      setPendingRemove(null);
      setRecoloringId(null);
    } else {
      if (dragSettleTimerRef.current !== null) {
        window.clearTimeout(dragSettleTimerRef.current);
        dragSettleTimerRef.current = null;
      }
      setDragOrder(null);
      dragOrderRef.current = null;
      dragSettlingRef.current = false;
      setGroupDrag(null);
    }
  }, [open]);

  const commitReorder = useCallback(
    (next: string[]) => {
      if (next.join("\0") === groupIds.join("\0")) return;
      setDragOrder(next);
      dragOrderRef.current = next;
      Promise.resolve(onReorder(next)).catch((e) => {
        setError(e instanceof Error ? e.message : "Could not reorder groups");
      });
    },
    [groupIds, onReorder],
  );

  const moveGroupByKeyboard = useCallback(
    (id: string, direction: -1 | 1) => {
      const current = dragOrderRef.current ?? groupIds;
      const from = current.indexOf(id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(current.length - 1, from + direction));
      if (from === to) return;
      commitReorder(reorderPinnedIds(current, from, to));
    },
    [commitReorder, groupIds],
  );

  const startPointerDrag = useCallback(
    (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      if (dragSettlingRef.current) return;
      const startY = event.clientY;
      const startX = event.clientX;
      const initialOrder = [...(dragOrderRef.current ?? groupIds)];
      const rows: VerticalDragRow[] = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>("[data-group-row]") ?? [],
      ).flatMap((element) => {
        const rowId = element.dataset.groupId;
        if (!rowId) return [];
        const rect = element.getBoundingClientRect();
        return [{ id: rowId, top: rect.top, height: rect.height }];
      });
      const fromIndex = rows.findIndex((row) => row.id === id);
      if (fromIndex < 0 || rows.length < 2) return;
      event.stopPropagation();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      let moved = false;
      let targetIndex = fromIndex;

      const shiftsFor = (nextTargetIndex: number) =>
        verticalDragShifts(rows, fromIndex, nextTargetIndex, GROUP_GAP);

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        moved = true;
        const delta = clampVerticalDragDelta(rows, fromIndex, moveEvent.clientY - startY);
        targetIndex = verticalDragTargetIndex(rows, fromIndex, delta);
        setGroupDrag({
          id,
          delta,
          shifts: shiftsFor(targetIndex),
          settling: false,
        });
        moveEvent.preventDefault();
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      };

      const settleThenCommit = (nextOrder: string[] | null) => {
        dragSettlingRef.current = true;
        setGroupDrag({
          id,
          delta: verticalDragSettleDelta(rows, fromIndex, targetIndex),
          shifts: shiftsFor(targetIndex),
          settling: true,
        });
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        dragSettleTimerRef.current = window.setTimeout(() => {
          dragSettleTimerRef.current = null;
          dragSettlingRef.current = false;
          setGroupDrag(null);
          if (nextOrder) commitReorder(nextOrder);
        }, reduceMotion ? 0 : DRAG_SETTLE_MS);
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== event.pointerId) return;
        cleanup();
        if (!moved) {
          setGroupDrag(null);
          return;
        }
        upEvent.preventDefault();
        const nextOrder =
          targetIndex === fromIndex
            ? null
            : reorderPinnedIds(initialOrder, fromIndex, targetIndex);
        settleThenCommit(nextOrder);
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== event.pointerId) return;
        cleanup();
        if (!moved) {
          setGroupDrag(null);
          return;
        }
        targetIndex = fromIndex;
        settleThenCommit(null);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [commitReorder, groupIds],
  );

  const pendingRemoveCount = pendingRemove
    ? projects.filter((p) => p.groupId === pendingRemove.id).length
    : 0;

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
        <FormErrorBox error={error} />
        <div
          ref={listRef}
          style={{ display: "flex", flexDirection: "column", gap: GROUP_GAP, isolation: "isolate" }}
        >
          {orderedGroups.map((g) => {
            const count = projects.filter((p) => p.groupId === g.id).length;
            const isEditing = editing?.id === g.id;
            const groupProjects = projects.filter((p) => p.groupId === g.id);
            const availableProjects = projects.filter((p) => p.groupId !== g.id);
            const selectedProjectId = selectedProjectByGroup[g.id] ?? "";
            const isDragging = groupDrag?.id === g.id;
            const dragOffset = groupDrag
              ? isDragging
                ? groupDrag.delta
                : groupDrag.shifts[g.id] ?? 0
              : 0;
            const isLifted = isDragging && !groupDrag?.settling;
            const shouldAnimatePosition = groupDrag !== null && !isLifted;
            return (
              <div
                key={g.id}
                data-group-row
                data-group-id={g.id}
                data-dragging={isDragging || undefined}
                className="mc-groups-dialog-row"
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: "10px 12px",
                  background: isDragging ? "var(--surface-2)" : "var(--surface-0)",
                  border: `1px solid ${isDragging ? "var(--accent-border)" : "var(--border)"}`,
                  borderRadius: 8,
                  opacity: isDragging ? 0.98 : 1,
                  boxShadow: isLifted ? "0 10px 14px -10px rgba(0, 0, 0, 0.72)" : undefined,
                  transform: `translate3d(0, ${dragOffset}px, 0) scale(${isLifted ? 1.008 : 1})`,
                  transformOrigin: "center",
                  zIndex: isDragging ? 3 : 1,
                  willChange: groupDrag ? "transform" : undefined,
                  transition: [
                    ...(shouldAnimatePosition
                      ? [`transform ${DRAG_SETTLE_MS}ms ${DRAG_SETTLE_EASE}`]
                      : []),
                    "background 120ms cubic-bezier(0.25, 1, 0.5, 1)",
                    "border-color 120ms cubic-bezier(0.25, 1, 0.5, 1)",
                    "box-shadow 120ms cubic-bezier(0.25, 1, 0.5, 1)",
                    "opacity 120ms cubic-bezier(0.25, 1, 0.5, 1)",
                  ].join(", "),
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {orderedGroups.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Reorder ${g.name}. Use arrow up and down keys, or drag`}
                      aria-keyshortcuts="ArrowUp ArrowDown"
                      title="Drag to reorder (or focus and use ↑/↓)"
                      onPointerDown={(e) => startPointerDrag(g.id, e)}
                      onDragStart={(e) => e.preventDefault()}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          moveGroupByKeyboard(g.id, -1);
                        } else if (e.key === "ArrowDown") {
                          e.preventDefault();
                          moveGroupByKeyboard(g.id, 1);
                        }
                      }}
                      className="mc-groups-dialog-drag-handle"
                      data-active={isDragging || undefined}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, 3px)",
                        gap: 3,
                        justifyContent: "center",
                        alignContent: "center",
                        width: 18,
                        height: 22,
                        padding: 0,
                        border: 0,
                        borderRadius: 4,
                        cursor: isDragging ? "grabbing" : "grab",
                        touchAction: "none",
                        flexShrink: 0,
                        userSelect: "none",
                        ["WebkitUserDrag" as any]: "none",
                      }}
                    >
                      {Array.from({ length: 6 }).map((_, dot) => (
                        <span
                          key={dot}
                          aria-hidden
                          style={{ width: 3, height: 3, borderRadius: "50%", background: "currentColor" }}
                        />
                      ))}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRecoloringId((current) => (current === g.id ? null : g.id))}
                    title="Change color"
                    aria-label={`Change color of ${g.name}`}
                    aria-expanded={recoloringId === g.id}
                    style={{
                      background: "transparent",
                      border: 0,
                      cursor: "pointer",
                      padding: 4,
                      margin: -4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: g.color,
                        boxShadow: `0 0 6px ${g.color}66`,
                        outline: recoloringId === g.id ? "2px solid var(--accent-border)" : undefined,
                        outlineOffset: 2,
                      }}
                    />
                  </button>
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
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "var(--mono)",
                          fontSize: 12.5,
                          cursor: "pointer",
                        }}
                        title={g.name}
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
                        onClick={() => setPendingRemove(g)}
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
                {recoloringId === g.id && (
                  <div
                    role="group"
                    aria-label={`Pick a color for ${g.name}`}
                    style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 2 }}
                  >
                    {GROUP_COLORS.map((color) => {
                      const selected = color.toLowerCase() === g.color.toLowerCase();
                      return (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Set color ${color}`}
                          aria-pressed={selected}
                          onClick={async () => {
                            setError(null);
                            try {
                              await onRecolor(g.id, color);
                              setRecoloringId(null);
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Could not update group color");
                            }
                          }}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 6,
                            border: selected
                              ? "2px solid var(--text)"
                              : "1px solid var(--border-strong)",
                            background: color,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        />
                      );
                    })}
                  </div>
                )}
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
      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          const group = pendingRemove;
          if (!group) return;
          setRemoving(true);
          setError(null);
          try {
            await onRemove(group.id);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not remove group");
          } finally {
            setRemoving(false);
            setPendingRemove(null);
          }
        }}
        title="Remove group?"
        confirmLabel="Remove group"
        cancelLabel="Keep group"
        variant="danger"
        icon="trash"
        loading={removing}
        width={420}
      >
        <div
          style={{
            fontSize: 13,
            color: "var(--text)",
            marginBottom: 6,
            overflowWrap: "anywhere",
          }}
        >
          Remove &ldquo;{pendingRemove?.name}&rdquo;?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {pendingRemoveCount === 0
            ? "This group is empty, so nothing else changes."
            : `Its ${pendingRemoveCount} ${
                pendingRemoveCount === 1 ? "project" : "projects"
              } will become ungrouped — they aren't deleted.`}
        </div>
      </ConfirmDialog>
    </Modal>
  );
}
