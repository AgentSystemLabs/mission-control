import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { ICON_COLORS } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import type { Group, Project } from "~/db/schema";

export function ProjectDialog({
  open,
  project,
  groups,
  onClose,
  onSave,
  onDelete,
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
  }) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("#7ce58a");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(project?.name || "");
      setPath(project?.path || "");
      setGroupId(project?.groupId || "");
      setIcon(project?.icon || "");
      setIconColor(project?.iconColor || "#7ce58a");
      setError(null);
    }
  }, [open, project]);

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
        (path.trim().split(/[\\/]/).filter(Boolean).pop() ?? "");
      await onSave({
        name: name.trim() || undefined,
        path,
        icon: icon || effectiveName.slice(0, 2).toUpperCase(),
        iconColor,
        groupId: groupId || null,
      });
    } catch (e: any) {
      setError(e?.message || "Save failed");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Edit project" : "Add project"}
      width={520}
      footer={
        <>
          {project && onDelete && (
            <Btn
              variant="danger"
              icon="trash"
              onClick={async () => {
                await onDelete();
              }}
              style={{ marginRight: "auto" }}
            >
              Remove project
            </Btn>
          )}
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={submit}>
            {project ? "Save" : "Add project"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: 14,
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <ProjectIcon
            project={{
              icon: (icon || name.slice(0, 2) || "??").toUpperCase().slice(0, 2),
              iconColor,
            }}
            size={44}
          />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{name || "Project name"}</div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-faint)",
                marginTop: 2,
              }}
            >
              {path || "~/path/to/project"}
            </div>
          </div>
        </div>

        <TextField
          label="Name (optional — defaults to folder name)"
          value={name}
          onChange={setName}
          placeholder={
            path.trim().split(/[\\/]/).filter(Boolean).pop() || "my-project"
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
            Working directory
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <TextField mono value={path} onChange={setPath} placeholder="/Users/me/dev/my-project" />
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
            Icon
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
