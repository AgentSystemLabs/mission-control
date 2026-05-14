import { useEffect, useRef, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { BRAND_PALETTE } from "~/lib/design-meta";
import { getRuntime } from "~/lib/runtime";
import { ApiError } from "~/lib/api";
import { compressProjectImageFile, PROJECT_IMAGE_MAX_SOURCE_BYTES } from "~/lib/project-image-client";
import type { Group, Project } from "~/db/schema";
import { getErrorMessage } from "~/shared/errors";

function repoNameFromUrl(value: string): string {
  return (
    value
      .trim()
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/\.git$/i, "") ?? ""
  );
}

const CLOUD_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function apiErrorCode(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const body = e.body;
  return body &&
    typeof body === "object" &&
    "code" in body &&
    typeof (body as { code?: unknown }).code === "string"
    ? (body as { code: string }).code
    : null;
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
    path?: string;
    icon?: string;
    iconColor: string;
    groupId: string | null;
    imagePath?: string | null;
    imageDataUrl?: string | null;
    pendingImage?: { sourcePath: string; extension: string } | null;
    repoUrl?: string | null;
  }) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("#ff5a1f");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageDataName, setImageDataName] = useState<string | null>(null);
  const [imageDirty, setImageDirty] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const [pendingImage, setPendingImage] = useState<
    { sourcePath: string; extension: string } | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [repoUrlInvalid, setRepoUrlInvalid] = useState(false);
  const [runtimeHost, setRuntimeHost] = useState<"desktop" | "cloud">(
    () => getRuntime()?.hostKind ?? "cloud",
  );
  const nameRef = useRef<HTMLInputElement>(null);
  const repoUrlRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageReadIdRef = useRef(0);
  const imagePickerIdRef = useRef(0);
  const dialogResetIdentityRef = useRef<string | null>(null);
  const projectName = project?.name || "";
  const projectPath = project?.path || "";
  const projectRepoUrl = project?.repoUrl || "";
  const projectGroupId = project?.groupId || "";
  const projectIcon = project?.icon || "";
  const projectIconColor = project?.iconColor || "#ff5a1f";
  const projectImagePath = project?.imagePath ?? null;
  const projectImageDataUrl = project?.imageDataUrl ?? null;
  const projectUpdatedAt = project?.updatedAt ?? 0;

  useEffect(() => {
    setRuntimeHost(getRuntime()?.hostKind ?? "cloud");
  }, []);

  useEffect(() => {
    const resetIdentity = open ? (project?.id ?? "new") : "closed";
    if (dialogResetIdentityRef.current === resetIdentity) return;
    dialogResetIdentityRef.current = resetIdentity;
    imageReadIdRef.current += 1;
    setUploading(false);
    if (!open) {
      return;
    }
    setName(projectName);
    setPath(projectPath);
    setRepoUrl(projectRepoUrl);
    setGroupId(projectGroupId);
    setIcon(projectIcon);
    setIconColor(projectIconColor);
    setImagePath(projectImagePath);
    setImageDataUrl(projectImageDataUrl);
    setImageDataName(null);
    setImageDirty(false);
    setImageVersion(projectUpdatedAt);
    setPendingImage(null);
    setError(null);
    setImageError(false);
    setRepoUrlInvalid(false);
  }, [
    open,
    projectName,
    projectPath,
    projectRepoUrl,
    projectGroupId,
    projectIcon,
    projectIconColor,
    projectImagePath,
    projectImageDataUrl,
    projectUpdatedAt,
    project?.id,
  ]);

  useEffect(() => {
    if (!open) return;
    const primaryInput = runtimeHost === "cloud" && !project ? repoUrlRef : nameRef;
    primaryInput.current?.focus();
    primaryInput.current?.select();
  }, [open, project, runtimeHost]);

  const isCloudProject = project ? project.runtimeKind === "daytona" : runtimeHost === "cloud";
  const isCloudCreate = isCloudProject && !project;
  const hasImagePreview = Boolean(imagePath || imageDataUrl);
  const imagePreviewProject = {
    icon: (icon || name.slice(0, 2) || "PR").toUpperCase().slice(0, 2),
    iconColor,
    imagePath,
    imageDataUrl,
    updatedAt: imageVersion,
  };

  const chooseImage = async () => {
    setError(null);
    setImageError(false);
    if (isCloudProject) {
      imagePickerIdRef.current = ++imageReadIdRef.current;
      if (imageInputRef.current) imageInputRef.current.value = "";
      imageInputRef.current?.click();
      return;
    }
    const electron = getRuntime();
    if (!electron) return;
    // Capture the project identity at the start: if the dialog is reused for
    // a different project between awaits we must not write image state into
    // the wrong project's form.
    const projectIdAtStart = project?.id;
    const picked = await electron.pickImage();
    if (!picked) return;
    if ("error" in picked) {
      setError(picked.error);
      setImageError(true);
      return;
    }
    if (!project) {
      // No further awaits in this branch, so projectIdAtStart is still
      // accurate — just defer the upload until the project exists.
      setPendingImage(picked);
      setImageDirty(true);
      return;
    }
    setUploading(true);
    try {
      const result = await electron.saveProjectImage({
        projectId: project.id,
        sourcePath: picked.sourcePath,
        extension: picked.extension,
      });
      if (project?.id !== projectIdAtStart) return;
      if ("error" in result) {
        setError(result.error);
        setImageError(true);
        return;
      }
      setImagePath(result.filename);
      setImageDirty(true);
      setImageVersion(Date.now());
    } finally {
      setUploading(false);
    }
  };

  const chooseCloudImage = async (file: File | undefined) => {
    if (!file) return;
    if (imagePickerIdRef.current !== imageReadIdRef.current) return;
    setError(null);
    setImageError(false);
    if (!CLOUD_IMAGE_TYPES.has(file.type)) {
      setError("Choose a PNG, JPG, WebP, or GIF image");
      setImageError(true);
      return;
    }
    if (file.size > PROJECT_IMAGE_MAX_SOURCE_BYTES) {
      setError("Choose an image under 10MB so it can be optimized");
      setImageError(true);
      return;
    }
    const readId = ++imageReadIdRef.current;
    setUploading(true);
    try {
      const dataUrl = await compressProjectImageFile(file);
      if (imageReadIdRef.current !== readId) return;
      setImageDataUrl(dataUrl);
      setImageDataName(file.name);
      setImageDirty(true);
      setImageVersion(Date.now());
    } catch (e: unknown) {
      if (imageReadIdRef.current !== readId) return;
      setError(getErrorMessage(e) || "Could not read image");
      setImageError(true);
    } finally {
      if (imageReadIdRef.current === readId) setUploading(false);
    }
  };

  const removeImage = () => {
    imageReadIdRef.current += 1;
    if (imageError) setError(null);
    setImagePath(null);
    setImageDataUrl(null);
    setImageDataName(null);
    setPendingImage(null);
    setImageDirty(true);
    setImageError(false);
    setImageVersion(Date.now());
  };

  const browse = async () => {
    const electron = getRuntime();
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

  const [submitting, setSubmitting] = useState(false);
  const closeIfIdle = () => {
    if (!submitting && !uploading) onClose();
  };
  const submit = async () => {
    if (submitting || uploading) return;
    setError(null);
    setImageError(false);
    setRepoUrlInvalid(false);
    if (isCloudCreate && !repoUrl.trim()) {
      setError("Git repository URL is required in cloud mode");
      setRepoUrlInvalid(true);
      return;
    }
    if (!isCloudProject && !path.trim()) {
      setError("Working directory is required");
      return;
    }
    setSubmitting(true);
    try {
      const repoName = repoNameFromUrl(repoUrl);
      const effectiveName =
        name.trim() ||
        (isCloudCreate
          ? repoName
          : (path.trim().split(/[\\/]/).filter(Boolean).pop() ?? ""));
      await onSave({
        name: name.trim() || undefined,
        ...(isCloudProject ? {} : { path }),
        icon: icon || effectiveName.slice(0, 2).toUpperCase(),
        iconColor,
        groupId: groupId || null,
        ...(isCloudCreate ? { repoUrl: repoUrl.trim() } : {}),
        ...(isCloudProject && (!project || imageDirty) ? { imageDataUrl } : {}),
        ...(isCloudProject ? {} : project && imageDirty ? { imagePath } : project ? {} : { pendingImage }),
      });
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Save failed");
      if (isCloudCreate && apiErrorCode(e) === "duplicate_project") {
        setRepoUrlInvalid(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  useHotkey("dialog.submit", () => void submit(), { enabled: open });

  return (
    <Modal
      open={open}
      onClose={closeIfIdle}
      title={project ? "Edit project" : "Add project"}
      width={520}
      footer={
        <>
          <Btn variant="ghost" onClick={closeIfIdle} disabled={submitting || uploading}>
            Cancel
          </Btn>
          <HotkeyTooltip action="dialog.submit">
            <Btn
              variant="primary"
              onClick={submit}
              disabled={submitting || uploading}
              style={{
                height: 36,
                "--mc-btn-height": "36px",
                "--mc-btn-padding-x": "18px",
                "--mc-btn-frame-border": "14px",
                minWidth: 80,
              }}
            >
              {submitting ? "Saving…" : uploading ? "Reading…" : project ? "Save" : "Add project"}
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <TextField
          label={
            isCloudCreate
              ? "Name (optional — defaults to repo name)"
              : "Name (optional — defaults to folder name)"
          }
          value={name}
          onChange={setName}
          inputRef={nameRef}
          placeholder={
            isCloudCreate
              ? repoNameFromUrl(repoUrl) || "my-project"
              : path.trim().split(/[\\/]/).filter(Boolean).pop() || "my-project"
          }
        />

        {isCloudCreate ? (
          <TextField
            id="project-repo-url"
            label="Git repository URL"
            hint="Mission Control will clone this repo into a Daytona workspace before running commands."
            value={repoUrl}
            onChange={(value) => {
              setRepoUrl(value);
              if (repoUrlInvalid) setRepoUrlInvalid(false);
            }}
            inputRef={repoUrlRef}
            ariaDescribedBy={repoUrlInvalid ? "project-dialog-error" : undefined}
            ariaInvalid={repoUrlInvalid}
            placeholder="https://github.com/owner/repo.git"
            mono
            type="url"
          />
        ) : isCloudProject ? (
          <div>
            <label
              htmlFor="project-path"
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
              Cloud workspace
            </label>
            <div
              style={{
                padding: "9px 12px",
                border: "1px solid var(--border)",
                borderRadius: 7,
                background: "var(--surface-0)",
                color: "var(--text-dim)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={project?.repoUrl || project?.workspacePath || project?.path}
            >
              {project?.repoUrl || project?.workspacePath || project?.path}
            </div>
          </div>
        ) : (
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
                <TextField id="project-path" mono value={path} onChange={setPath} placeholder="/Users/me/dev/my-project" />
              </div>
              {runtimeHost === "desktop" ? (
                <Btn variant="solid" icon="folder" onClick={browse}>
                  Browse…
                </Btn>
              ) : null}
            </div>
          </div>
        )}

        <div role="group" aria-labelledby="project-image-label">
          <label
            id="project-image-label"
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
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {hasImagePreview ? <ProjectIcon project={imagePreviewProject} size={40} /> : null}
            {isCloudProject ? (
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => void chooseCloudImage(e.currentTarget.files?.[0])}
                style={{ display: "none" }}
              />
            ) : null}
            <Btn
              variant="solid"
              icon="folder"
              onClick={chooseImage}
              disabled={uploading}
              aria-describedby={error && imageError ? "project-dialog-error project-image-help" : "project-image-help"}
            >
              {uploading
                ? isCloudProject
                  ? "Optimizing…"
                  : "Uploading…"
                : imagePath || pendingImage || imageDataUrl
                  ? "Replace image…"
                  : "Choose image…"}
            </Btn>
            {(imagePath || pendingImage || imageDataUrl) && (
              <Btn variant="ghost" onClick={removeImage} disabled={uploading}>
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
            {imageDataName && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                {imageDataName} — saves on save
              </span>
            )}
            {imageDataUrl && !imageDataName && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                Custom image stored in Postgres
              </span>
            )}
            <span
              id="project-image-help"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-faint)",
              }}
            >
              {isCloudProject
                ? "PNG / JPG / WebP / GIF, source ≤ 10MB, auto-scaled to 128px and saved under 512KB"
                : "PNG / JPG / WebP / GIF, ≤ 5MB"}
            </span>
          </div>
        </div>

        <div>
          <label
            htmlFor="project-icon-fallback"
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
              id="project-icon-fallback"
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
              {BRAND_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setIconColor(c)}
                  aria-label={`Use icon color ${c}`}
                  aria-pressed={iconColor === c}
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
            id="project-dialog-error"
            role="alert"
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
