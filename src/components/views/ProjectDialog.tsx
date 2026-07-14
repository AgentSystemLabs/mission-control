import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Modal } from "~/components/ui/Modal";
import { FolderBrowser } from "~/components/ui/FolderBrowser";
import { FormErrorBox } from "~/components/ui/FormErrorBox";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { AgentLogo } from "~/components/ui/AgentLogo";
import { PickCardGroup } from "~/components/ui/PickCardGroup";
import { ToggleSwitch } from "~/components/views/SettingsParts";
import { HotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { AGENT_META, ICON_COLORS } from "~/lib/design-meta";
import {
  agentCanLaunch,
  availabilityFor,
  useCliAvailability,
} from "~/lib/cli-availability";
import { getElectron } from "~/lib/electron";
import { useSettings } from "~/queries";
import { AGENT_REGISTRY } from "~/shared/agents";
import {
  DEFAULT_AGENT_LAUNCHER_CONFIG,
  visibleLauncherAgents,
} from "~/shared/agent-launcher-config";
import type { TaskAgent } from "~/shared/domain";
import type { Group, Project } from "~/db/schema";

const fieldLabelStyle: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  fontWeight: 500,
  color: "var(--text-dim)",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  display: "block",
  marginBottom: 6,
};

function FieldLabel({ children }: { children: ReactNode }) {
  // A <span>, not a <label>: nothing here wires htmlFor, and an unassociated
  // <label> misleads AT. The controls carry their own accessible names.
  return <span style={fieldLabelStyle}>{children}</span>;
}

/** Last segment of a filesystem path, ignoring trailing separators. */
function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || "";
}

/**
 * A titled group in the dialog — same title/description vocabulary as the
 * Settings pages' SettingCard, but outlined (transparent fill) rather than
 * filled, so the already-bordered controls inside recede instead of reading
 * as nested cards.
 */
function GroupCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{title}</div>
        {description && (
          <div
            style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 3 }}
          >
            {description}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/** Tiny wireframe that shows what each layout does at a glance. */
function LayoutGlyph({ variant, active }: { variant: "list" | "grid"; active: boolean }) {
  const cell = active ? "var(--accent)" : "var(--text-faint)";
  const frame: CSSProperties = {
    width: 34,
    // 26 tall to match the agent cards' icon tile, so the List/Grid cards
    // beside the agent grid land on exactly the same row heights.
    height: 26,
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--surface-0)",
    padding: 4,
    flex: "0 0 auto",
  };
  if (variant === "list") {
    return (
      <div style={{ ...frame, display: "flex", flexDirection: "column", gap: 2.5 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 4, borderRadius: 1.5, background: cell }} />
        ))}
      </div>
    );
  }
  return (
    <div
      style={{
        ...frame,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 2.5,
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ borderRadius: 1.5, background: cell }} />
      ))}
    </div>
  );
}

export function ProjectDialog({
  open,
  project,
  initialPath = "",
  groups,
  onClose,
  onSave,
  onCreateGroup,
}: {
  open: boolean;
  project: Project | null;
  initialPath?: string;
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
    // Create-only onboarding fields (undefined when editing an existing project).
    savedAgent?: TaskAgent | null;
    rememberAgentSettings?: boolean;
    defaultGridView?: boolean;
    autoStart?: boolean;
    pinned?: boolean;
  }) => Promise<void> | void;
  onCreateGroup?: (name: string) => Promise<Group> | Group;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  // The inline folder browser live-syncs the name to the highlighted folder
  // only until the user types a name of their own (clearing it re-enables).
  const [nameTouched, setNameTouched] = useState(false);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  // Filter box gets focus when the browser is the opening step (create flow)
  // or was opened via Browse…; the edit flow keeps focus on the name field.
  const [folderBrowserAutoFocus, setFolderBrowserAutoFocus] = useState(false);
  // Committed path+name snapshot so Esc in the browser reverts the preview.
  const folderSnapshotRef = useRef<{ path: string; name: string } | null>(null);
  const [groupId, setGroupId] = useState<string>("");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupTypeaheadOpen, setGroupTypeaheadOpen] = useState(false);
  const [groupActiveIndex, setGroupActiveIndex] = useState(-1);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState<string>(ICON_COLORS[0]);
  const [worktreeSetupCommand, setWorktreeSetupCommand] = useState("");
  // Optional at create time: null means "just create the project", a selection
  // means "create it and start a session with that agent".
  const [agent, setAgent] = useState<TaskAgent | null>(null);
  const [gridView, setGridView] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<
    { sourcePath: string; extension: string; previewDataUrl: string } | null
  >(null);
  // Bumped on each in-dialog image replace so the app:// preview URL can't
  // serve a stale cached copy (the filename stays `<projectId>.<ext>`).
  const [imageVersion, setImageVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(true);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // Snapshot of the seeded form, captured on open, so an accidental Esc /
  // backdrop click on a create form the user has actually touched prompts
  // before discarding — while a pre-filled-but-untouched form closes freely.
  const formSeedRef = useRef<string>("");
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

  const cliAvailability = useCliAvailability();
  const { data: settings } = useSettings();
  // Order + visibility mirror the New-session picker (Settings → Providers), so
  // the agent chosen here reads as the same set the user launches with later.
  const launcherConfig = settings?.agentLauncherConfig ?? DEFAULT_AGENT_LAUNCHER_CONFIG;
  const agentOptions = useMemo(
    () =>
      visibleLauncherAgents(launcherConfig)
        .filter((id) => AGENT_REGISTRY[id].uiVisible)
        .map((id) => ({ id, ...AGENT_REGISTRY[id] })),
    [launcherConfig],
  );

  useEffect(() => {
    if (open) {
      const initialName = basename(initialPath);
      const seededName = project?.name || (!project ? initialName : "");
      const seededPath = project?.path || (!project ? initialPath : "");
      const seededGroupQuery = project?.groupId
        ? groups.find((group) => group.id === project.groupId)?.name ?? ""
        : "";
      const seededIcon = project?.icon || "";
      const seededIconColor = project?.iconColor || ICON_COLORS[0];
      const startInBrowser = !project && !!getElectron();
      // Create flow starts in the folder browser (picking the directory IS the
      // first step; the name auto-fills from it, and committing a folder moves
      // focus to the name field). Editing keeps the old focus-the-name start.
      if (!startInBrowser) {
        nameRef.current?.focus();
        nameRef.current?.select();
      }
      setName(seededName);
      setPath(seededPath);
      setGroupId(project?.groupId || "");
      setGroupQuery(seededGroupQuery);
      setGroupTypeaheadOpen(false);
      setGroupActiveIndex(-1);
      setCreatingGroup(false);
      setIcon(seededIcon);
      setIconColor(seededIconColor);
      setWorktreeSetupCommand(project?.worktreeSetupCommand || "");
      setGridView(project?.defaultGridView ?? false);
      setImagePath(project?.imagePath ?? null);
      setPendingImage(null);
      setColorMenuOpen(false);
      setAgent(null);
      setPinned(true);
      setConfirmingClose(false);
      setSubmitting(false);
      setError(null);
      // Seeded names track the path, so browsing may keep overwriting them;
      // an existing project's name is the user's and must never be touched.
      setNameTouched(!!project);
      // Create flow opens straight into the in-app browser (the whole point:
      // no OS dialog); editing keeps it collapsed behind Browse….
      setFolderBrowserOpen(startInBrowser);
      setFolderBrowserAutoFocus(startInBrowser);
      folderSnapshotRef.current = { path: seededPath, name: seededName };
      formSeedRef.current = JSON.stringify({
        name: seededName,
        path: seededPath,
        groupQuery: seededGroupQuery,
        icon: seededIcon,
        iconColor: seededIconColor,
        hasImage: !!project?.imagePath,
      });
    }
  }, [initialPath, open, project?.id]);

  // If the selected agent turns out to be unavailable (its CLI probe resolves
  // to missing after the pick), drop back to "no agent" rather than starting a
  // session that can't launch. Optional-by-default means null is a valid rest.
  useEffect(() => {
    if (!open || project) return;
    setAgent((current) =>
      current && agentCanLaunch(cliAvailability, current) ? current : null,
    );
  }, [open, project, cliAvailability]);

  // Surface save errors even when the form has scrolled: bring the error box
  // into view (FormErrorBox is role="alert", so it also announces to AT).
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

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
      setImageVersion((v) => v + 1);
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setImagePath(null);
    setPendingImage(null);
  };

  // In-app folder browsing replaces the OS dialog: the highlight live-previews
  // into the path field and (until the user types their own) the name field.
  const previewFolder = (p: string) => {
    setPath(p);
    if (!nameTouched) {
      const base = basename(p);
      if (base) setName(base);
    }
  };

  const commitFolder = (p: string) => {
    previewFolder(p);
    folderSnapshotRef.current = { path: p, name: nameTouched ? name : basename(p) };
    setFolderBrowserOpen(false);
    // Same directory grant an OS-dialog pick records; fire-and-forget.
    void getElectron()?.grantFolder(p);
    nameRef.current?.focus();
    nameRef.current?.select();
  };

  const cancelFolderBrowse = () => {
    const snapshot = folderSnapshotRef.current;
    if (snapshot) {
      setPath(snapshot.path);
      if (!nameTouched) setName(snapshot.name);
    }
    setFolderBrowserOpen(false);
  };

  const toggleFolderBrowser = () => {
    if (folderBrowserOpen) {
      cancelFolderBrowse();
      return;
    }
    folderSnapshotRef.current = { path, name };
    setFolderBrowserAutoFocus(true);
    setFolderBrowserOpen(true);
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

  // A picked agent is the opt-in to launch a session; no pick just creates the
  // project. Drives the primary button's label and the create payload alike.
  const willStartSession = !project && agent !== null;

  const submit = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // The final path may have been live-previewed (or hand-typed) without
      // passing through commitFolder — record its grant here so every saved
      // path is granted, not just explicitly committed picks. Idempotent.
      void getElectron()?.grantFolder(path.trim());
      const effectiveGroupId = await resolveGroupIdForSave();
      const effectiveName = name.trim() || basename(path.trim());
      await onSave({
        name: name.trim() || undefined,
        path,
        icon: icon || effectiveName.slice(0, 2).toUpperCase(),
        iconColor,
        groupId: effectiveGroupId,
        ...(project ? { imagePath } : { pendingImage }),
        ...(project
          ? { worktreeSetupCommand: worktreeSetupCommand.trim() || null }
          : {
              savedAgent: agent,
              rememberAgentSettings: agent !== null,
              defaultGridView: gridView,
              autoStart: willStartSession,
              pinned,
            }),
      });
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Enter / Cmd+Enter runs the primary action: Save when editing; for a new
  // project it honors the agent pick (willStartSession) and the same path gate
  // as the button, so the keyboard path can't bypass what the button enforces.
  useHotkey(
    "dialog.submit",
    () => {
      if (confirmingClose) return;
      if (project) {
        void submit();
        return;
      }
      if (!path.trim()) return;
      void submit();
    },
    { enabled: open },
  );

  // Live identity preview: exactly what the sidebar will render for this
  // project — auto initials from the name until the user overrides them.
  const derivedInitials =
    (name.trim() || basename(path.trim())).slice(0, 2).toUpperCase() || "AB";
  const currentFormKey = JSON.stringify({
    name,
    path,
    groupQuery,
    icon,
    iconColor,
    hasImage: !!pendingImage || !!imagePath,
  });
  const isDirty = !project && currentFormKey !== formSeedRef.current;
  // Esc / backdrop / Cancel route through here so a touched create form
  // confirms before discarding; a second Esc (or "Keep editing") backs out.
  const requestClose = () => {
    if (submitting) return;
    if (confirmingClose) {
      setConfirmingClose(false);
      return;
    }
    if (isDirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  };

  const hasImage = !!pendingImage || !!imagePath;
  const previewSrc =
    pendingImage?.previewDataUrl ??
    (imagePath
      ? `app://project-image/${imagePath}?v=${project?.updatedAt ?? 0}-${imageVersion}`
      : null);

  // One row of identity: the avatar tile IS the live sidebar preview and the
  // image-upload button in one. Initials + color are its no-image fallback and
  // only render while no image is set; name always sits at the end.
  const identityRow = (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
      <div style={{ position: "relative", flex: "0 0 auto" }}>
        <button
          type="button"
          onClick={chooseImage}
          disabled={uploading}
          aria-label={hasImage ? "Replace project image" : "Add project image"}
          title="PNG, JPG, WebP or GIF — up to 5MB"
          className="mc-avatar-tile"
          style={{
            position: "relative",
            width: 58,
            height: 58,
            borderRadius: 12,
            padding: 0,
            overflow: "hidden",
            border: `1px solid ${previewSrc ? "var(--border)" : `${iconColor}44`}`,
            background: previewSrc
              ? "var(--surface-0)"
              : `linear-gradient(135deg, ${iconColor}22, ${iconColor}08)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: uploading ? "wait" : "pointer",
          }}
        >
          {previewSrc ? (
            <img
              src={previewSrc}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span
              key={`${icon || derivedInitials}-${iconColor}`}
              className="mc-identity-pop"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 20,
                fontWeight: 600,
                color: iconColor,
                letterSpacing: "-0.02em",
              }}
            >
              {icon || derivedInitials}
            </span>
          )}
          <span aria-hidden className="mc-avatar-tile-overlay">
            <Icon name="camera" size={15} />
          </span>
        </button>
        {/* At rest the tile looks like a static preview — this always-visible
            corner badge is what says "click to add/replace an image". */}
        {!uploading && (
          <span aria-hidden className="mc-avatar-upload-badge">
            <Icon name="camera" size={10} />
          </span>
        )}
        {hasImage && !uploading && (
          <button
            type="button"
            onClick={removeImage}
            aria-label="Remove image"
            title="Remove image"
            className="mc-avatar-remove"
          >
            <Icon name="x" size={10} />
          </button>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TextField
          label="Name (optional)"
          value={name}
          onChange={(v) => {
            setName(v);
            // A typed name opts out of folder-name auto-sync; clearing the
            // field hands naming back to the browser highlight.
            setNameTouched(v.trim().length > 0);
          }}
          inputRef={nameRef}
          placeholder={basename(path.trim()) || "defaults to folder name"}
        />
      </div>
      {/* Initials and color only shape the tile when no image covers it, so
          an uploaded image collapses them away — removing the image (×) brings
          them back with whatever the user had set. */}
      {!hasImage && (
        <div
          className="mc-identity-fallback"
          style={{ display: "flex", gap: 10, alignItems: "flex-end", flex: "0 0 auto" }}
        >
          <div style={{ flex: "0 0 auto" }}>
            <FieldLabel>Initials</FieldLabel>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 2).toUpperCase())}
              maxLength={2}
              placeholder={project ? "AB" : derivedInitials}
              aria-label="Icon initials (used when no image is set)"
              className="mc-initials-input"
              style={{
                width: 52,
                height: 38,
                textAlign: "center",
                background: "var(--surface-0)",
                borderRadius: 7,
                color: "var(--text)",
                padding: "0 8px",
                fontFamily: "var(--mono)",
                fontSize: 14,
                fontWeight: 600,
              }}
            />
          </div>
          <div
            style={{ flex: "0 0 auto", position: "relative" }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && colorMenuOpen) {
                // Close the color menu without also dismissing the whole dialog.
                e.stopPropagation();
                setColorMenuOpen(false);
              }
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setColorMenuOpen(false);
            }}
          >
            <FieldLabel>Color</FieldLabel>
            <button
              type="button"
              onClick={() => setColorMenuOpen((o) => !o)}
              aria-label="Icon color"
              aria-haspopup="listbox"
              aria-expanded={colorMenuOpen}
              className="mc-color-trigger"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 38,
                padding: "0 8px 0 9px",
                background: "var(--surface-0)",
                border: `1px solid ${colorMenuOpen ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 7,
                cursor: "pointer",
                color: "var(--text-dim)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  background: iconColor,
                  flex: "0 0 auto",
                }}
              />
              <Icon name="chevron-down" size={12} />
            </button>
            {colorMenuOpen && (
              <div
                role="listbox"
                aria-label="Icon color"
                style={{
                  position: "absolute",
                  zIndex: 20,
                  top: "calc(100% + 6px)",
                  // Right-anchored: the trigger sits at the row's right edge,
                  // so the swatch strip opens leftward into the dialog instead
                  // of clipping against its edge.
                  right: 0,
                  display: "flex",
                  gap: 6,
                  padding: 8,
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 14px 36px rgba(0, 0, 0, 0.32)",
                }}
              >
                {ICON_COLORS.map((c) => {
                  const active = iconColor === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="option"
                      aria-selected={active}
                      aria-label={`Icon color ${c}`}
                      onClick={() => {
                        setIconColor(c);
                        setColorMenuOpen(false);
                      }}
                      className="mc-color-swatch"
                      style={{
                        width: 24,
                        height: 24,
                        flex: "0 0 auto",
                        borderRadius: 6,
                        background: c,
                        border: active ? "2px solid var(--text)" : "2px solid transparent",
                        boxShadow: active ? `0 0 0 2px ${c}` : "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        padding: 0,
                      }}
                    >
                      {active && (
                        <span
                          aria-hidden
                          style={{ display: "flex", filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45))" }}
                        >
                          <Icon name="check" size={12} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const dirField = (
    <div>
      <FieldLabel>
        Working directory <span style={{ color: "var(--accent)" }}>*</span>
      </FieldLabel>
      {/* While the browser is open it IS the working-directory control —
          breadcrumbs + highlight show the path, so the input row would just
          duplicate state (and invite edits the browser ignores). */}
      {!folderBrowserOpen && (
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <TextField
              mono
              required
              ariaLabel="Working directory (required)"
              value={path}
              onChange={setPath}
              placeholder="/Users/me/dev/my-project"
            />
          </div>
          {!!getElectron() && (
            <Btn variant="solid" icon="folder" onClick={toggleFolderBrowser}>
              Browse…
            </Btn>
          )}
        </div>
      )}
      {folderBrowserOpen && (
        <FolderBrowser
          initialPath={path.trim() || null}
          autoFocus={folderBrowserAutoFocus}
          onPreview={previewFolder}
          onCommit={commitFolder}
          onCancel={cancelFolderBrowse}
        />
      )}
    </div>
  );

  const startWithField = (
    <div>
      <FieldLabel>Start with</FieldLabel>
      <PickCardGroup
        // Accessible name starts with the visible label so "Start with" is
        // speakable (WCAG label-in-name).
        ariaLabel="Start with — coding agent for the first session (optional)"
        value={agent}
        onChange={setAgent}
        deselectable
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        options={agentOptions.map((a) => {
          const meta = AGENT_META[a.id];
          const availability = availabilityFor(cliAvailability, a.id);
          const cliMissing = availability.status === "missing";
          const cliOutdated = availability.status === "outdated";
          // In Electron an `unknown` status only exists for the beat before the
          // probe kicks off — treat it as still checking, never as broken.
          const cliChecking =
            !cliMissing &&
            !cliOutdated &&
            !!getElectron() &&
            (availability.status === "checking" || availability.status === "unknown");
          const disabled =
            submitting || (!cliOutdated && !agentCanLaunch(cliAvailability, a.id));
          // Reason lives in the name (not just `title`) so keyboard/AT users
          // hear why it's unavailable; `aria-disabled` keeps it focusable.
          const statusReason = cliMissing
            ? `${a.command} not found on PATH — install it to enable`
            : cliOutdated
              ? `${a.command} must be updated before launching`
              : cliChecking
                ? `checking ${a.command} availability…`
                : null;
          return {
            value: a.id,
            ariaLabel: disabled && statusReason ? `${a.label} — ${statusReason}` : a.label,
            title: statusReason ?? undefined,
            disabled,
            content: (selected: boolean) => (
              <>
                <div
                  key={selected ? "on" : "off"}
                  className={selected ? "mc-pick-pop" : undefined}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: `${meta.color}22`,
                    border: `1px solid ${meta.color}44`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: meta.color,
                    flex: "0 0 auto",
                  }}
                >
                  <AgentLogo agent={a.id} size={17} />
                </div>
                <span
                  style={{
                    minWidth: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.label}
                </span>
                {(cliMissing || cliOutdated || cliChecking) && (
                  <span
                    aria-hidden
                    className={cliChecking ? "mc-availability-checking" : undefined}
                    style={{
                      marginLeft: "auto",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      // Severity-tiered: missing = failed (can't launch at all),
                      // outdated = warning (launchable, but update needed),
                      // checking = faint pulse (probe still running).
                      background: cliChecking
                        ? "var(--text-faint)"
                        : cliMissing
                          ? "var(--status-failed)"
                          : "var(--status-warning, var(--accent))",
                      flex: "0 0 auto",
                    }}
                  />
                )}
              </>
            ),
          };
        })}
      />
    </div>
  );

  // Same card anatomy and spacing as the agent picker beside it — one row of
  // options in the whole section, one selection language. List sits on the
  // agents' first row, Grid on their second.
  const layoutField = (
    <div>
      <FieldLabel>Layout</FieldLabel>
      <PickCardGroup
        ariaLabel="Layout — default session layout"
        value={gridView ? "grid" : "list"}
        onChange={(v) => setGridView(v === "grid")}
        style={{ display: "grid", gap: 8 }}
        options={(
          [
            { label: "List", variant: "list" as const },
            { label: "Grid", variant: "grid" as const },
          ]
        ).map((opt) => ({
          value: opt.variant,
          ariaLabel: `${opt.label} layout`,
          disabled: submitting,
          content: (selected: boolean) => (
            <>
              <span
                key={selected ? "on" : "off"}
                className={selected ? "mc-pick-pop" : undefined}
                style={{ display: "inline-flex", flex: "0 0 auto" }}
              >
                <LayoutGlyph variant={opt.variant} active={selected} />
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                {opt.label}
              </span>
            </>
          ),
        }))}
      />
    </div>
  );

  // Flat, ordered descriptor for the combobox listbox so the keyboard handler
  // and the rendered options share one source of truth (ids + indices align).
  type GroupOption =
    | { id: string; kind: "ungrouped" }
    | { id: string; kind: "group"; group: Group }
    | { id: string; kind: "create" };
  const groupOptions: GroupOption[] = [
    { id: "grp-opt-ungrouped", kind: "ungrouped" },
    ...filteredGroups.map(
      (group): GroupOption => ({ id: `grp-opt-${group.id}`, kind: "group", group }),
    ),
    ...(canCreateGroup ? [{ id: "grp-opt-create", kind: "create" } as GroupOption] : []),
  ];
  const activeGroupOption =
    groupTypeaheadOpen && groupActiveIndex >= 0 ? groupOptions[groupActiveIndex] : undefined;
  const selectGroupOption = (opt: GroupOption) => {
    if (opt.kind === "ungrouped") clearGroup();
    else if (opt.kind === "group") selectGroup(opt.group);
    else void commitGroupQuery();
  };

  const groupField = (
    <div>
      <FieldLabel>Group</FieldLabel>
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
            // Exact (not min) so the inline color swatches beside it can
            // match this row's height 1:1.
            height: 38,
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
            onFocus={() => {
              setGroupTypeaheadOpen(true);
              setGroupActiveIndex(-1);
            }}
            onBlur={() => {
              window.setTimeout(() => setGroupTypeaheadOpen(false), 100);
            }}
            onChange={(e) => {
              const next = e.target.value;
              setGroupQuery(next);
              setGroupTypeaheadOpen(true);
              setGroupActiveIndex(-1);
              if (!next.trim()) setGroupId("");
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setGroupTypeaheadOpen(true);
                setGroupActiveIndex((i) => (i + 1 >= groupOptions.length ? 0 : i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setGroupTypeaheadOpen(true);
                setGroupActiveIndex((i) => (i <= 0 ? groupOptions.length - 1 : i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (activeGroupOption) selectGroupOption(activeGroupOption);
                else void commitGroupQuery();
              } else if (e.key === "Escape") {
                if (groupTypeaheadOpen) {
                  // Close the list without also dismissing the whole dialog.
                  e.stopPropagation();
                  setGroupTypeaheadOpen(false);
                  setGroupActiveIndex(-1);
                }
              }
            }}
            role="combobox"
            aria-expanded={groupTypeaheadOpen}
            aria-controls="project-group-options"
            aria-autocomplete="list"
            aria-activedescendant={activeGroupOption?.id}
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
        <span className="sr-only" role="status" aria-live="polite">
          {groupTypeaheadOpen
            ? `${filteredGroups.length} group${filteredGroups.length === 1 ? "" : "s"} available${
                canCreateGroup ? `. Press Enter to create "${groupQuery.trim()}".` : "."
              }`
            : ""}
        </span>
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
            {groupOptions.map((opt, index) => {
              const isActive = index === groupActiveIndex;
              const isChosen =
                opt.kind === "ungrouped"
                  ? groupId === ""
                  : opt.kind === "group"
                    ? groupId === opt.group.id
                    : false;
              const isCreate = opt.kind === "create";
              const label =
                opt.kind === "ungrouped"
                  ? "Ungrouped"
                  : opt.kind === "group"
                    ? opt.group.name
                    : creatingGroup
                      ? "Creating..."
                      : `Create "${groupQuery.trim()}"`;
              return (
                <button
                  key={opt.id}
                  id={opt.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={isCreate && creatingGroup}
                  className={isActive ? "mc-combo-option-active" : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setGroupActiveIndex(index)}
                  onClick={() => selectGroupOption(opt)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 32,
                    border: 0,
                    borderRadius: 6,
                    background: isChosen
                      ? "var(--accent-dim)"
                      : isActive
                        ? "var(--surface-2)"
                        : "transparent",
                    color:
                      isCreate || isChosen
                        ? "var(--accent-ink)"
                        : opt.kind === "ungrouped"
                          ? "var(--text-dim)"
                          : "var(--text)",
                    cursor: isCreate && creatingGroup ? "default" : "pointer",
                    opacity: isCreate && creatingGroup ? 0.65 : 1,
                    padding: "7px 9px",
                    textAlign: "left",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                  }}
                >
                  {opt.kind === "group" && (
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: opt.group.color,
                        flex: "0 0 auto",
                      }}
                    />
                  )}
                  {isCreate && <Icon name="plus" size={12} />}
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const worktreeField = project ? (
    <TextField
      mono
      label="New worktree setup command"
      value={worktreeSetupCommand}
      onChange={(value) => setWorktreeSetupCommand(value.slice(0, 500))}
      placeholder="pnpm i"
      hint="Optional. Runs once inside each newly created worktree."
    />
  ) : null;

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title={project ? "Edit project" : "Add project"}
      width={project ? 600 : 620}
      footer={
        project ? (
          <>
            <EscTooltip label="Cancel">
              <Btn variant="ghost" onClick={onClose}>
                Cancel
              </Btn>
            </EscTooltip>
            <HotkeyTooltip action="dialog.submit">
              <Btn variant="primary" onClick={() => void submit()} disabled={submitting}>
                Save
              </Btn>
            </HotkeyTooltip>
          </>
        ) : confirmingClose ? (
          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--text-dim)" }}>
              Discard this project? Your changes will be lost.
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" onClick={() => setConfirmingClose(false)}>
                Keep editing
              </Btn>
              <Btn variant="danger" onClick={onClose}>
                Discard
              </Btn>
            </div>
          </div>
        ) : (
          <>
            {!path.trim() ? (
              <span
                style={{
                  marginRight: "auto",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-faint)",
                }}
              >
                Add a working directory to create.
              </span>
            ) : (
              // Compact footer toggle: pinning is independent of whether a
              // session starts — that's driven by the agent pick above.
              <div
                style={{ marginRight: "auto", display: "flex", alignItems: "center", gap: 8 }}
                title="Keep this project pinned to the top of your sidebar."
              >
                <ToggleSwitch
                  checked={pinned}
                  onChange={setPinned}
                  label="Pin project"
                  labelledBy="project-pin-label"
                />
                <span
                  id="project-pin-label"
                  onClick={() => setPinned(!pinned)}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  Pin project
                </span>
              </div>
            )}
            <EscTooltip label="Cancel">
              <Btn variant="ghost" onClick={requestClose}>
                Cancel
              </Btn>
            </EscTooltip>
            <HotkeyTooltip action="dialog.submit">
              <Btn
                variant="primary"
                icon={willStartSession ? "terminal" : undefined}
                onClick={() => void submit()}
                disabled={submitting || !path.trim()}
              >
                {willStartSession ? "Create & start session" : "Create project"}
              </Btn>
            </HotkeyTooltip>
          </>
        )
      }
    >
      {project ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {identityRow}
          {dirField}
          {groupField}
          {worktreeField}
          <div ref={errorRef}>
            <FormErrorBox error={error} />
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <GroupCard title="Project">
            {identityRow}
            {dirField}
            {groupField}
          </GroupCard>
          <GroupCard title="Sessions">
            {/* Agent picker and layout side-by-side — layout is the lighter
                choice, so it sits as a slim column with a rule between them. */}
            <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
              <div style={{ flex: 1, minWidth: 0 }}>{startWithField}</div>
              <div aria-hidden style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />
              <div style={{ flex: "0 0 128px" }}>{layoutField}</div>
            </div>
          </GroupCard>
          <div ref={errorRef}>
            <FormErrorBox error={error} />
          </div>
        </div>
      )}
    </Modal>
  );
}
