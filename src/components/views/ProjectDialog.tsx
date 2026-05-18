import { useEffect, useRef, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { ICON_COLORS } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { isWebDaytonaRuntime } from "~/lib/runtime";
import { hostedWorkspacePath } from "~/shared/hosted-workspace";
import type { Group, Project } from "~/db/schema";

function repoNameFromGithubUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/\s?#]+?)(?:\.git)?$/i);
  if (ssh) return ssh[2];
  const url = trimmed.match(/^(?:https?|ssh):\/\/(?:git@)?github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  return url?.[2] ?? "";
}

export function ProjectDialog({
  open,
  project,
  groups,
  onClose,
  onSave,
}: {
  open: boolean;
  project: Project | null;
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
    githubUrl?: string;
  }) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("#ff5a1f");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const [pendingImage, setPendingImage] = useState<
    { sourcePath: string; extension: string } | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const hostedRuntime = isWebDaytonaRuntime();
  const hostedCreate = hostedRuntime && !project;
  const hostedRepoName = hostedCreate ? repoNameFromGithubUrl(path) : "";

  useEffect(() => {
    if (open) {
      nameRef.current?.focus();
      nameRef.current?.select();
      setName(project?.name || "");
      setPath(project?.path || "");
      setGroupId(project?.groupId || "");
      setIcon(project?.icon || "");
      setIconColor(project?.iconColor || "#ff5a1f");
      setImagePath(project?.imagePath ?? null);
      setImageVersion(project?.updatedAt ?? 0);
      setPendingImage(null);
      setError(null);
    }
  }, [open, project?.id]);

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
      setImageVersion(Date.now());
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setImagePath(null);
    setPendingImage(null);
    setImageVersion(Date.now());
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

  const submit = async () => {
    setError(null);
    try {
      const effectiveName =
        name.trim() ||
        hostedRepoName ||
        (path.trim().split(/[\\/]/).filter(Boolean).pop() ?? "");
      const effectivePath = hostedCreate
        ? hostedWorkspacePath(hostedRepoName || effectiveName)
        : path;
      await onSave({
        name: name.trim() || undefined,
        path: effectivePath,
        icon: icon || effectiveName.slice(0, 2).toUpperCase(),
        iconColor,
        groupId: groupId || null,
        ...(project ? { imagePath } : { pendingImage }),
        ...(hostedCreate && path.trim() ? { githubUrl: path.trim() } : {}),
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
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
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
          label={hostedCreate ? "Name (optional — defaults to repository name)" : "Name (optional — defaults to folder name)"}
          value={name}
          onChange={setName}
          inputRef={nameRef}
          placeholder={
            hostedCreate
              ? hostedRepoName || "my-project"
              : path.trim().split(/[\\/]/).filter(Boolean).pop() || "my-project"
          }
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
            {hostedCreate ? "GitHub repository URL" : hostedRuntime ? "Hosted workspace path" : "Working directory"}
          </label>
          {hostedCreate && (
            <div
              style={{
                marginBottom: 8,
                color: "var(--text-dim)",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                lineHeight: 1.45,
              }}
            >
              Paste a GitHub repository link. Mission Control will clone it into
              a workspace directory inside the hosted environment.
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <TextField
                mono
                value={path}
                onChange={setPath}
                placeholder={
                  hostedCreate
                    ? "https://github.com/owner/repo"
                    : hostedRuntime
                    ? hostedWorkspacePath(name || "my-project")
                    : "/Users/me/dev/my-project"
                }
              />
            </div>
            {!hostedRuntime && (
              <Btn variant="solid" icon="folder" onClick={browse}>
                Browse…
              </Btn>
            )}
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
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => setGroupId("")}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                background: groupId === "" ? "var(--accent-dim)" : "var(--surface-0)",
                border: `1px solid ${groupId === "" ? "var(--accent)" : "var(--border)"}`,
                color: groupId === "" ? "var(--accent)" : "var(--text-dim)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Ungrouped
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setGroupId(g.id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: groupId === g.id ? "var(--accent-dim)" : "var(--surface-0)",
                  border: `1px solid ${groupId === g.id ? "var(--accent)" : "var(--border)"}`,
                  color: groupId === g.id ? "var(--accent)" : "var(--text-dim)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: g.color }} />
                {g.name}
              </button>
            ))}
          </div>
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
      </div>
    </Modal>
  );
}
