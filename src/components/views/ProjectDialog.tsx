import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Modal } from "~/components/ui/Modal";
import { FormErrorBox } from "~/components/ui/FormErrorBox";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { AgentLogo } from "~/components/ui/AgentLogo";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
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
    { sourcePath: string; extension: string } | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
      const initialName = initialPath.split(/[\\/]/).filter(Boolean).pop() || "";
      nameRef.current?.focus();
      nameRef.current?.select();
      setName(project?.name || (!project ? initialName : ""));
      setPath(project?.path || (!project ? initialPath : ""));
      setGroupId(project?.groupId || "");
      setGroupQuery(
        project?.groupId
          ? groups.find((group) => group.id === project.groupId)?.name ?? ""
          : "",
      );
      setGroupTypeaheadOpen(false);
      setGroupActiveIndex(-1);
      setCreatingGroup(false);
      setIcon(project?.icon || "");
      setIconColor(project?.iconColor || "#ff5a1f");
      setWorktreeSetupCommand(project?.worktreeSetupCommand || "");
      setGridView(project?.defaultGridView ?? false);
      setImagePath(project?.imagePath ?? null);
      setPendingImage(null);
      setAppearanceOpen(false);
      setSubmitting(false);
      setError(null);
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

  const submit = async (autoStart: boolean) => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
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

  // Enter / Cmd+Enter runs the primary action: "Create & start" for a new
  // project, "Save" when editing (autoStart is ignored on the edit path).
  useHotkey("dialog.submit", () => void submit(!project), { enabled: open });

  // Live identity preview: exactly what the sidebar will render for this
  // project — auto initials from the name until the user overrides them.
  const derivedInitials =
    (name.trim() || path.trim().split(/[\\/]/).filter(Boolean).pop() || "")
      .slice(0, 2)
      .toUpperCase() || "AB";
  const previewInitials = icon || derivedInitials;
  const appearanceSummary = pendingImage
    ? pendingImage.sourcePath.split(/[\\/]/).pop() ?? "custom image"
    : icon
      ? `Initials ${icon}`
      : `Auto initials · ${derivedInitials}`;

  const nameField = (
    <TextField
      label="Name (optional)"
      value={name}
      onChange={setName}
      inputRef={nameRef}
      placeholder={path.trim().split(/[\\/]/).filter(Boolean).pop() || "defaults to folder name"}
    />
  );

  const dirField = (
    <div>
      <FieldLabel>Working directory</FieldLabel>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <TextField
            mono
            ariaLabel="Working directory"
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
                borderRadius: 8,
                boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
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
        Launches your sessions — change anytime.
      </div>
    </div>
  );

  const layoutField = (
    <div>
      <FieldLabel>Layout</FieldLabel>
      <div
        role="radiogroup"
        aria-label="Default layout"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
      >
        {(
          [
            { value: false, label: "List", desc: "One at a time", variant: "list" as const },
            { value: true, label: "Grid", desc: "All at once", variant: "grid" as const },
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
              className="mc-pick-card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
                padding: "9px 10px",
                background: selected ? "var(--surface-2)" : "var(--surface-0)",
                border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 8,
                boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
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
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  {opt.label}
                </div>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: "var(--text-dim)",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {opt.desc}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const imageField = (
    <div>
      <FieldLabel>Custom image</FieldLabel>
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
            style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)" }}
          >
            {pendingImage.sourcePath.split(/[\\/]/).pop()} — uploads on save
          </span>
        )}
        <span
          style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)" }}
        >
          PNG / JPG / WebP / GIF, ≤ 5MB
        </span>
      </div>
    </div>
  );

  const iconField = (
    <div>
      <FieldLabel>{project ? "Icon (fallback)" : "Initials & color"}</FieldLabel>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value.slice(0, 2).toUpperCase())}
          maxLength={2}
          placeholder={project ? "AB" : derivedInitials}
          aria-label="Icon initials"
          className="mc-initials-input"
          style={{
            width: 56,
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
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ICON_COLORS.map((c) => {
            const active = iconColor === c;
            return (
              <button
                key={c}
                type="button"
                aria-label={`Icon color ${c}`}
                aria-pressed={active}
                onClick={() => setIconColor(c)}
                className="mc-color-swatch"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: c,
                  border: active ? "2px solid var(--text)" : "2px solid transparent",
                  boxShadow: active ? `0 0 0 2px ${c}` : "none",
                  cursor: "pointer",
                }}
              >
                <span
                  key={active ? "on" : "off"}
                  aria-hidden
                  className={active ? "mc-pick-pop" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: "100%",
                    opacity: active ? 1 : 0,
                    color: "#fff",
                    filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45))",
                  }}
                >
                  <Icon name="check" size={13} />
                </span>
              </button>
            );
          })}
        </div>
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

  const appearanceSection = (
    <div>
      <button
        type="button"
        aria-expanded={appearanceOpen}
        aria-controls="project-appearance-fields"
        onClick={() => setAppearanceOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          textAlign: "left",
          padding: "8px 10px",
          background: appearanceOpen ? "var(--surface-2)" : "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          cursor: "pointer",
          transition: "background 150ms ease",
        }}
      >
        {pendingImage ? (
          <div
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: `1px solid ${iconColor}44`,
              background: `${iconColor}18`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: iconColor,
              flex: "0 0 auto",
            }}
          >
            <Icon name="camera" size={14} />
          </div>
        ) : (
          <span
            key={`${previewInitials}-${iconColor}`}
            className="mc-identity-pop"
            style={{ display: "inline-flex", flex: "0 0 auto" }}
          >
            <ProjectIcon
              project={{ icon: previewInitials, iconColor, imagePath: null }}
              size={28}
            />
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
          Appearance
        </span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--text-dim)",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {appearanceSummary}
        </span>
        <Icon
          name={appearanceOpen ? "chevron-up" : "chevron-down"}
          size={13}
          style={{ marginLeft: "auto", color: "var(--text-faint)" }}
        />
      </button>
      {appearanceOpen && (
        <div
          id="project-appearance-fields"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "14px 10px 4px",
          }}
        >
          {iconField}
          {imageField}
        </div>
      )}
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
      onClose={onClose}
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
        ) : (
          <>
            <EscTooltip label="Cancel">
              <Btn variant="ghost" onClick={onClose}>
                Cancel
              </Btn>
            </EscTooltip>
            <Btn variant="solid" onClick={() => void submit(false)} disabled={submitting}>
              Create only
            </Btn>
            <HotkeyTooltip action="dialog.submit">
              <Btn
                variant="primary"
                icon="terminal"
                onClick={() => void submit(true)}
                disabled={submitting || !path.trim()}
              >
                Create &amp; start session
              </Btn>
            </HotkeyTooltip>
          </>
        )
      }
    >
      {project ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {nameField}
          {dirField}
          {imageField}
          {iconField}
          {groupField}
          {worktreeField}
          <FormErrorBox error={error} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {nameField}
          {dirField}
          {startWithField}
          {layoutField}
          {groupField}
          {appearanceSection}
          <FormErrorBox error={error} />
        </div>
      )}
    </Modal>
  );
}
