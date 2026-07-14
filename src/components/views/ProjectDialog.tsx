import { useEffect, useRef, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { FormErrorBox } from "~/components/ui/FormErrorBox";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { HotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { ICON_COLORS } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import type { Group, Project } from "~/db/schema";

export function ProjectDialog({
  open,
  project,
  initialPath = "",
  initialGroupId = null,
  groups,
  onClose,
  onSave,
  onCreateGroup,
}: {
  open: boolean;
  project: Project | null;
  initialPath?: string;
  /** Create flow only: pre-select this group (e.g. the globally active one). */
  initialGroupId?: string | null;
  groups: Group[];
  onClose: () => void;
  onSave: (data: {
    name?: string;
    path: string;
    icon?: string;
    iconColor: string;
    groupId: string | null;
    imagePath?: string | null;
    pendingImage?: { sourcePath: string; extension: string } | null;
    worktreeSetupCommand?: string | null;
  }) => Promise<void> | void;
  onCreateGroup?: (name: string) => Promise<Group> | Group;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupTypeaheadOpen, setGroupTypeaheadOpen] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("#ff5a1f");
  const [worktreeSetupCommand, setWorktreeSetupCommand] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<
    { sourcePath: string; extension: string } | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const selectedGroup = groupId ? groups.find((group) => group.id === groupId) ?? null : null;
  const normalizedGroupQuery = groupQuery.trim().toLowerCase();
  const exactGroupMatch = normalizedGroupQuery
    ? groups.find((group) => group.name.toLowerCase() === normalizedGroupQuery) ?? null
    : null;
  const filteredGroups = normalizedGroupQuery
    ? groups.filter((group) => group.name.toLowerCase().includes(normalizedGroupQuery))
    : groups;
  const canCreateGroup =
    !!onCreateGroup && !!groupQuery.trim() && !exactGroupMatch;

  useEffect(() => {
    if (open) {
      const initialName = initialPath.split(/[\\/]/).filter(Boolean).pop() || "";
      nameRef.current?.focus();
      nameRef.current?.select();
      const seededGroupId = project?.groupId ?? (!project ? initialGroupId : null) ?? "";
      setName(project?.name || (!project ? initialName : ""));
      setPath(project?.path || (!project ? initialPath : ""));
      setGroupId(seededGroupId);
      setGroupQuery(
        seededGroupId
          ? groups.find((group) => group.id === seededGroupId)?.name ?? ""
          : "",
      );
      setGroupTypeaheadOpen(false);
      setCreatingGroup(false);
      setIcon(project?.icon || "");
      setIconColor(project?.iconColor || "#ff5a1f");
      setWorktreeSetupCommand(project?.worktreeSetupCommand || "");
      setImagePath(project?.imagePath ?? null);
      setPendingImage(null);
      setError(null);
    }
  }, [initialGroupId, initialPath, open, project?.id]);

  useEffect(() => {
    if (!open || !selectedGroup || groupQuery.trim()) return;
    setGroupQuery(selectedGroup.name);
  }, [groupQuery, open, selectedGroup]);

  const chooseImage = async () => {
    setError(null);
    const electron = getElectron();
    if (!electron) return;
    const picked = await electron.pickImage();
    if (!picked) return;
    if ("error" in picked) {
      setError(picked.error);
      return;
    }
    if (!project) {
      // Create flow: defer upload until after the project exists.
      setPendingImage(picked);
      return;
    }
    setUploading(true);
    try {
      const result = await electron.saveProjectImage({
        projectId: project.id,
        sourcePath: picked.sourcePath,
        extension: picked.extension,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setImagePath(result.filename);
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setImagePath(null);
    setPendingImage(null);
  };

  const browse = async () => {
    const electron = getElectron();
    if (!electron) return;
    const result = await electron.browseFolder();
    if (result) {
      setPath(result);
      if (!name.trim()) {
        const basename = result.split(/[\\/]/).filter(Boolean).pop() || "";
        if (basename) setName(basename);
      }
    }
  };

  const selectGroup = (group: Group) => {
    setGroupId(group.id);
    setGroupQuery(group.name);
    setGroupTypeaheadOpen(false);
  };

  const clearGroup = () => {
    setGroupId("");
    setGroupQuery("");
    setGroupTypeaheadOpen(false);
  };

  const createAndSelectGroup = async (groupName: string): Promise<string | null> => {
    if (!onCreateGroup || creatingGroup) return groupId || null;
    setError(null);
    setCreatingGroup(true);
    try {
      const group = await onCreateGroup(groupName);
      selectGroup(group);
      return group.id;
    } catch (e: any) {
      setError(e?.message || "Could not add group");
      throw e;
    } finally {
      setCreatingGroup(false);
    }
  };

  const commitGroupQuery = async () => {
    const trimmed = groupQuery.trim();
    if (!trimmed) {
      clearGroup();
      return;
    }
    if (exactGroupMatch) {
      selectGroup(exactGroupMatch);
      return;
    }
    if (!onCreateGroup || creatingGroup) return;
    await createAndSelectGroup(trimmed);
  };

  const resolveGroupIdForSave = async (): Promise<string | null> => {
    const trimmed = groupQuery.trim();
    if (!trimmed) return null;
    if (exactGroupMatch) return exactGroupMatch.id;
    if (selectedGroup?.name === trimmed) return selectedGroup.id;
    if (onCreateGroup) return createAndSelectGroup(trimmed);
    return groupId || null;
  };

  const submit = async () => {
    setError(null);
    try {
      const effectiveGroupId = await resolveGroupIdForSave();
      const effectiveName =
        name.trim() || (path.trim().split(/[\\/]/).filter(Boolean).pop() ?? "");
      await onSave({
        name: name.trim() || undefined,
        path,
        icon: icon || effectiveName.slice(0, 2).toUpperCase(),
        iconColor,
        groupId: effectiveGroupId,
        ...(project ? { imagePath } : { pendingImage }),
        ...(project ? { worktreeSetupCommand: worktreeSetupCommand.trim() || null } : {}),
      });
    } catch (e: any) {
      setError(e?.message || "Save failed");
    }
  };

  useHotkey("dialog.submit", () => void submit(), { enabled: open });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Edit project" : "Add project"}
      width={520}
      footer={
        <>
          <EscTooltip label="Cancel">
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
          </EscTooltip>
          <HotkeyTooltip action="dialog.submit">
            <Btn
              variant="primary"
              onClick={submit}
              style={{
                height: 36,
                ["--mc-btn-height" as any]: "36px",
                ["--mc-btn-padding-x" as any]: "18px",
                ["--mc-btn-frame-border" as any]: "14px",
                minWidth: 80,
              }}
            >
              {project ? "Save" : "Add project"}
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <TextField
          label="Name (optional — defaults to folder name)"
          value={name}
          onChange={setName}
          inputRef={nameRef}
          placeholder={path.trim().split(/[\\/]/).filter(Boolean).pop() || "my-project"}
        />

        <div>
          <label
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              display: "block",
              marginBottom: 6,
            }}
          >
            Working directory
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <TextField
                mono
                value={path}
                onChange={setPath}
                placeholder="/Users/me/dev/my-project"
              />
            </div>
            <Btn variant="solid" icon="folder" onClick={browse}>
              Browse…
            </Btn>
          </div>
        </div>

        <div>
          <label
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              display: "block",
              marginBottom: 6,
            }}
          >
            Custom image
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Btn variant="solid" icon="folder" onClick={chooseImage} disabled={uploading}>
              {uploading
                ? "Uploading…"
                : imagePath || pendingImage
                  ? "Replace image…"
                  : "Choose image…"}
            </Btn>
            {(imagePath || pendingImage) && (
              <Btn variant="ghost" onClick={removeImage}>
                Remove
              </Btn>
            )}
            {pendingImage && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                {pendingImage.sourcePath.split(/[\\/]/).pop()} — uploads on save
              </span>
            )}
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-faint)",
              }}
            >
              PNG / JPG / WebP / GIF, ≤ 5MB
            </span>
          </div>
        </div>

        <div>
          <label
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              display: "block",
              marginBottom: 6,
            }}
          >
            Icon (fallback)
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 2).toUpperCase())}
              maxLength={2}
              placeholder="AB"
              style={{
                width: 60,
                textAlign: "center",
                background: "var(--surface-0)",
                border: "1px solid var(--border)",
                borderRadius: 7,
                outline: 0,
                color: "var(--text)",
                padding: "9px 8px",
                fontFamily: "var(--mono)",
                fontSize: 14,
                fontWeight: 600,
              }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ICON_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setIconColor(c)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: c,
                    border: iconColor === c ? "2px solid var(--text)" : "2px solid transparent",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <label
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              display: "block",
              marginBottom: 6,
            }}
          >
            Group
          </label>
          <div style={{ position: "relative" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--surface-0)",
                border: `1px solid ${groupTypeaheadOpen ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 7,
                padding: "0 8px 0 12px",
                minHeight: 38,
              }}
            >
              {selectedGroup && (
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: selectedGroup.color,
                    flex: "0 0 auto",
                  }}
                />
              )}
              <input
                value={groupQuery}
                onFocus={() => setGroupTypeaheadOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setGroupTypeaheadOpen(false), 100);
                }}
                onChange={(e) => {
                  const next = e.target.value;
                  setGroupQuery(next);
                  setGroupTypeaheadOpen(true);
                  if (!next.trim()) setGroupId("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitGroupQuery();
                  } else if (e.key === "Escape") {
                    setGroupTypeaheadOpen(false);
                  }
                }}
                role="combobox"
                aria-expanded={groupTypeaheadOpen}
                aria-controls="project-group-options"
                aria-label="Project group"
                placeholder="Ungrouped or group name"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "transparent",
                  border: 0,
                  outline: 0,
                  color: "var(--text)",
                  padding: "9px 0",
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                }}
              />
              {(groupQuery || groupId) && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearGroup}
                  aria-label="Clear group"
                  title="Clear group"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 24,
                    border: 0,
                    background: "transparent",
                    color: "var(--text-faint)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
            {groupTypeaheadOpen && (
              <div
                id="project-group-options"
                role="listbox"
                style={{
                  position: "absolute",
                  zIndex: 20,
                  left: 0,
                  right: 0,
                  top: "calc(100% + 6px)",
                  maxHeight: 220,
                  overflow: "auto",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 14px 36px rgba(0, 0, 0, 0.32)",
                  padding: 6,
                }}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={groupId === ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearGroup}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 32,
                    border: 0,
                    borderRadius: 6,
                    background: groupId === "" ? "var(--accent-dim)" : "transparent",
                    color: groupId === "" ? "var(--accent-ink)" : "var(--text-dim)",
                    cursor: "pointer",
                    padding: "7px 9px",
                    textAlign: "left",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                  }}
                >
                  Ungrouped
                </button>
                {filteredGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    role="option"
                    aria-selected={groupId === group.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectGroup(group)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 32,
                      border: 0,
                      borderRadius: 6,
                      background: groupId === group.id ? "var(--accent-dim)" : "transparent",
                      color: groupId === group.id ? "var(--accent-ink)" : "var(--text)",
                      cursor: "pointer",
                      padding: "7px 9px",
                      textAlign: "left",
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: group.color,
                      }}
                    />
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {group.name}
                    </span>
                  </button>
                ))}
                {canCreateGroup && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={creatingGroup}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void commitGroupQuery()}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 32,
                      border: 0,
                      borderRadius: 6,
                      background: "transparent",
                      color: "var(--accent-ink)",
                      cursor: creatingGroup ? "default" : "pointer",
                      opacity: creatingGroup ? 0.65 : 1,
                      padding: "7px 9px",
                      textAlign: "left",
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                    }}
                  >
                    <Icon name="plus" size={12} />
                    {creatingGroup ? "Creating..." : `Create "${groupQuery.trim()}"`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {project && (
          <TextField
            mono
            label="New worktree setup command"
            value={worktreeSetupCommand}
            onChange={(value) => setWorktreeSetupCommand(value.slice(0, 500))}
            placeholder="pnpm i"
            hint="Optional. Runs once inside each newly created worktree."
          />
        )}

        <FormErrorBox error={error} />
      </div>
    </Modal>
  );
}
