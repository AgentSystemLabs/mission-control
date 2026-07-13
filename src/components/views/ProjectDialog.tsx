import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Modal } from "~/components/ui/Modal";
import { FormErrorBox } from "~/components/ui/FormErrorBox";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { AgentLogo } from "~/components/ui/AgentLogo";
import { ToggleRow } from "~/components/views/SettingsParts";
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
  return <label style={fieldLabelStyle}>{children}</label>;
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
  description: string;
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
        <div
          style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 3 }}
        >
          {description}
        </div>
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
    height: 24,
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
          <div key={i} style={{ height: 4, borderRadius: 1.5, background: cell, opacity: active ? 1 : 0.6 }} />
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
        <div key={i} style={{ borderRadius: 1.5, background: cell, opacity: active ? 1 : 0.6 }} />
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
  }) => Promise<void> | void;
  onCreateGroup?: (name: string) => Promise<Group> | Group;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupTypeaheadOpen, setGroupTypeaheadOpen] = useState(false);
  const [groupActiveIndex, setGroupActiveIndex] = useState(-1);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("#ff5a1f");
  const [worktreeSetupCommand, setWorktreeSetupCommand] = useState("");
  const [agent, setAgent] = useState<TaskAgent>("claude-code");
  const [gridView, setGridView] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<
    { sourcePath: string; extension: string; previewDataUrl: string } | null
  >(null);
  // Bumped on each in-dialog image replace so the app:// preview URL can't
  // serve a stale cached copy (the filename stays `<projectId>.<ext>`).
  const [imageVersion, setImageVersion] = useState(0);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(true);
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
      const seededIconColor = project?.iconColor || "#ff5a1f";
      nameRef.current?.focus();
      nameRef.current?.select();
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
      setAutoStart(true);
      setConfirmingClose(false);
      setSubmitting(false);
      setError(null);
      formSeedRef.current = JSON.stringify({
        name: seededName,
        path: seededPath,
        groupQuery: seededGroupQuery,
        icon: seededIcon,
        iconColor: seededIconColor,
        hasImage: !!project?.imagePath,
      });
    }
    // Agent is seeded in the effect below once agentOptions has settled.
  }, [initialPath, open, project?.id]);

  // Seed the agent selection to the first launchable option when the dialog
  // opens, and re-home it if the current pick turns out to be unavailable.
  useEffect(() => {
    if (!open || project) return;
    const firstLaunchable =
      agentOptions.find((a) => agentCanLaunch(cliAvailability, a.id))?.id ??
      agentOptions[0]?.id ??
      "claude-code";
    setAgent((current) =>
      agentOptions.some((a) => a.id === current) && agentCanLaunch(cliAvailability, current)
        ? current
        : firstLaunchable,
    );
  }, [open, project, agentOptions, cliAvailability]);

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

  const browse = async () => {
    const electron = getElectron();
    if (!electron) return;
    const result = await electron.browseFolder();
    if (result) {
      setPath(result);
      if (!name.trim()) {
        const base = basename(result);
        if (base) setName(base);
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

  const submit = async (autoStart: boolean) => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
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
              rememberAgentSettings: true,
              defaultGridView: gridView,
              autoStart,
            }),
      });
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Enter / Cmd+Enter runs the primary action: Save when editing; for a new
  // project it honors the "Start a session now" toggle and the same path gate
  // as the button, so the keyboard path can't bypass what the button enforces.
  useHotkey(
    "dialog.submit",
    () => {
      if (confirmingClose) return;
      if (project) {
        void submit(false);
        return;
      }
      if (!path.trim()) return;
      void submit(autoStart);
    },
    { enabled: open },
  );

  // Live identity preview: exactly what the sidebar will render for this
  // project — auto initials from the name until the user overrides them.
  const derivedInitials =
    (name.trim() || basename(path.trim())).slice(0, 2).toUpperCase() || "AB";
  const selectedAgentLabel = AGENT_REGISTRY[agent]?.label ?? "your coding agent";
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
  // image-upload button in one — initials, color, and name sit beside it, so
  // every input that shapes the tile is within reach of it.
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
            textAlign: "center",
            background: "var(--surface-0)",
            borderRadius: 7,
            color: "var(--text)",
            padding: "9px 8px",
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
              left: 0,
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <TextField
          label="Name (optional)"
          value={name}
          onChange={setName}
          inputRef={nameRef}
          placeholder={basename(path.trim()) || "defaults to folder name"}
        />
      </div>
    </div>
  );

  const dirField = (
    <div>
      <FieldLabel>
        Working directory <span style={{ color: "var(--accent)" }}>*</span>
      </FieldLabel>
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
        <Btn variant="solid" icon="folder" onClick={browse}>
          Browse…
        </Btn>
      </div>
    </div>
  );

  const startWithField = (
    <div>
      <FieldLabel>Start with</FieldLabel>
      <div
        role="radiogroup"
        aria-label="Default coding agent"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
      >
        {agentOptions.map((a) => {
          const meta = AGENT_META[a.id];
          const selected = agent === a.id;
          const availability = availabilityFor(cliAvailability, a.id);
          const cliMissing = availability.status === "missing";
          const cliOutdated = availability.status === "outdated";
          const disabled = !cliOutdated && !agentCanLaunch(cliAvailability, a.id);
          const statusReason = cliMissing
            ? `${a.command} was not found on PATH`
            : cliOutdated
              ? `${a.command} must be updated before launching`
              : null;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={selected}
              // Reason lives in the name (not just `title`) so keyboard/AT users
              // hear why it's unavailable; `aria-disabled` keeps it focusable.
              aria-label={disabled && statusReason ? `${a.label} — ${statusReason}` : a.label}
              aria-disabled={disabled || undefined}
              onClick={() => !disabled && setAgent(a.id)}
              className="mc-pick-card"
              title={statusReason ?? undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                textAlign: "left",
                padding: "9px 10px",
                background: selected ? "var(--surface-2)" : "var(--surface-0)",
                border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 7,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
              }}
            >
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
                <AgentLogo agent={a.id} size={17} title={a.label} />
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
              {(cliMissing || cliOutdated) && (
                <span
                  aria-hidden
                  title={cliMissing ? "CLI not found on PATH" : "Update required"}
                  style={{
                    marginLeft: "auto",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--status-failed)",
                    flex: "0 0 auto",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--text-faint)",
          marginTop: 7,
          lineHeight: 1.4,
        }}
      >
        The default for new sessions — switch agents anytime.
      </div>
    </div>
  );

  // A compact segmented control, not a second card grid: layout is a trivial,
  // reversible per-session choice, so it should read lighter than the agent
  // picker above it. The glyph still shows what each option does.
  const layoutField = (
    <div>
      <FieldLabel>Layout</FieldLabel>
      <div
        role="radiogroup"
        aria-label="Default layout"
        style={{
          display: "flex",
          gap: 4,
          padding: 3,
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 7,
        }}
      >
        {(
          [
            { value: false, label: "List", variant: "list" as const },
            { value: true, label: "Grid", variant: "grid" as const },
          ]
        ).map((opt) => {
          const selected = gridView === opt.value;
          return (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${opt.label} layout`}
              onClick={() => setGridView(opt.value)}
              className="mc-segment"
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                padding: "8px 10px",
                border: 0,
                borderRadius: 5,
                background: selected ? "var(--surface-2)" : "transparent",
                // Single accent edge = selected, the same signal the agent
                // cards use — one selection language, and a non-color cue so
                // it doesn't rely on the glyph hue alone.
                boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
                color: selected ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer",
              }}
            >
              <span
                key={selected ? "on" : "off"}
                className={selected ? "mc-pick-pop" : undefined}
                style={{ display: "inline-flex", flex: "0 0 auto" }}
              >
                <LayoutGlyph variant={opt.variant} active={selected} />
              </span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{opt.label}</span>
            </button>
          );
        })}
      </div>
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
      width={project ? 520 : 540}
      footer={
        project ? (
          <>
            <EscTooltip label="Cancel">
              <Btn variant="ghost" onClick={onClose}>
                Cancel
              </Btn>
            </EscTooltip>
            <HotkeyTooltip action="dialog.submit">
              <Btn variant="primary" onClick={() => void submit(false)} disabled={submitting}>
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
            {!path.trim() && (
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
            )}
            <EscTooltip label="Cancel">
              <Btn variant="ghost" onClick={requestClose}>
                Cancel
              </Btn>
            </EscTooltip>
            <HotkeyTooltip action="dialog.submit">
              <Btn
                variant="primary"
                icon={autoStart ? "terminal" : undefined}
                onClick={() => void submit(autoStart)}
                disabled={submitting || !path.trim()}
              >
                {autoStart ? "Create & start session" : "Create project"}
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
          <GroupCard
            title="Project"
            description="Where it lives on disk and how it shows up in your sidebar."
          >
            {identityRow}
            {dirField}
            {groupField}
          </GroupCard>
          <GroupCard
            title="Sessions"
            description="Defaults for the coding agents you'll run in this project."
          >
            {startWithField}
            {layoutField}
            <ToggleRow
              title="Start a session now"
              description={`Launches ${selectedAgentLabel} in this project as soon as it's created.`}
              checked={autoStart}
              onChange={setAutoStart}
              label="Start a session now"
            />
          </GroupCard>
          <div ref={errorRef}>
            <FormErrorBox error={error} />
          </div>
        </div>
      )}
    </Modal>
  );
}
