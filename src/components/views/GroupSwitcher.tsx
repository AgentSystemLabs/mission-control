import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/DropdownMenuItem";
import {
  ACTIVE_GROUP_ALL,
  ACTIVE_GROUP_UNGROUPED,
  activeGroupLabel,
  useActiveGroup,
} from "~/lib/active-group";
import { useGroupsDialog } from "~/lib/groups-dialog-store";
import { useScopedProjects } from "~/queries";
import { useBinding } from "~/lib/keybindings/store";
import { formatBinding } from "~/lib/keybindings/format";
import { Z_INDEX } from "~/lib/z-index";
import type { ActiveProjectGroup } from "~/shared/ui-preferences";

function GroupDot({ color, size = 7 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 6px ${color}66`,
        flexShrink: 0,
      }}
    />
  );
}

const UNGROUPED_DOT = "rgba(232, 230, 223, 0.3)";

/**
 * Header switcher for the globally active project group — the workspace-like
 * context that scopes the dashboard, the left rail, and the project picker.
 * Leads the TopBar breadcrumb (Group › Project › Scope) as the broadest
 * context; hidden while no groups exist and on Settings/Usage screens.
 */
export function GroupSwitcher() {
  const { activeGroup, setActiveGroup, groups } = useActiveGroup();
  const { data: scopedProjects } = useScopedProjects();
  const groupsDialog = useGroupsDialog();
  const [open, setOpen] = useState(false);
  const nextGroupBinding = useBinding("group.next");
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLElement>(null);

  const updateMenuRect = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMenuRect({ top: rect.bottom + 6, left: rect.left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return;
    }
    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open, updateMenuRect]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // No groups yet — nothing to switch between, keep the header quiet.
  if (groups.length === 0) return null;

  const projects = scopedProjects ?? [];
  const ungroupedCount = projects.filter((p) => p.groupId == null).length;
  const label = activeGroupLabel(activeGroup, groups);
  const activeColor =
    activeGroup === ACTIVE_GROUP_ALL
      ? "var(--text-faint)"
      : activeGroup === ACTIVE_GROUP_UNGROUPED
        ? UNGROUPED_DOT
        : (groups.find((g) => g.id === activeGroup)?.color ?? "var(--text-faint)");

  const select = (next: ActiveProjectGroup) => {
    setOpen(false);
    setActiveGroup(next);
  };

  const entries: Array<{ key: ActiveProjectGroup; label: string; color: string; count: number }> = [
    { key: ACTIVE_GROUP_ALL, label: "All projects", color: "var(--text-faint)", count: projects.length },
    ...groups.map((g) => ({
      key: g.id,
      label: g.name,
      color: g.color,
      count: projects.filter((p) => p.groupId === g.id).length,
    })),
  ];
  if (ungroupedCount > 0 || activeGroup === ACTIVE_GROUP_UNGROUPED) {
    entries.push({
      key: ACTIVE_GROUP_UNGROUPED,
      label: "Ungrouped",
      color: UNGROUPED_DOT,
      count: ungroupedCount,
    });
  }

  return (
    <div ref={anchorRef} className="no-drag" style={{ position: "relative", display: "inline-flex" }}>
      <Btn
        type="button"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Active group: ${label}. Switch group`}
        title={`Active group: ${label} — cycle with ${formatBinding(nextGroupBinding)}`}
        onClick={() => setOpen((v) => !v)}
        style={{ paddingInline: 8 }}
      >
        <GroupDot color={activeColor} />
        <span
          style={{
            maxWidth: 140,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: activeGroup === ACTIVE_GROUP_ALL ? "var(--text-dim)" : "var(--text)",
          }}
        >
          {label}
        </span>
        <Icon
          name="chevron-down"
          size={11}
          style={{
            color: "var(--text-faint)",
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 120ms ease",
          }}
        />
      </Btn>
      {open &&
        menuRect &&
        createPortal(
          <CardFrame
            ref={menuRef}
            role="menu"
            aria-label="Switch active group"
            solid
            className="mc-project-actions-menu"
            style={{
              position: "fixed",
              top: menuRect.top,
              left: menuRect.left,
              minWidth: 210,
              boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              zIndex: Z_INDEX.popover,
            }}
          >
            {entries.map((entry) => {
              const selected = activeGroup === entry.key;
              return (
                <DropdownMenuItem
                  key={entry.key}
                  leading={<GroupDot color={entry.color} />}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => select(entry.key)}
                  style={
                    selected
                      ? { background: "color-mix(in srgb, var(--accent) 14%, transparent)" }
                      : undefined
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <span style={{ flex: 1 }}>{entry.label}</span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--text-dim)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {entry.count}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon="group"
              onClick={() => {
                setOpen(false);
                groupsDialog.open();
              }}
            >
              Manage groups…
            </DropdownMenuItem>
          </CardFrame>,
          document.body,
        )}
    </div>
  );
}
