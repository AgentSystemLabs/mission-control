import { useMemo, useState } from "react";
import type { Group } from "~/db/schema";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { ProjectStatusBadge } from "~/components/ui/ProjectStatusBadge";
import { StatusPill } from "~/components/ui/StatusDot";
import { TASK_STATUSES } from "~/shared/domain";
import { formatRelativeTime } from "~/lib/format-relative-time";
import {
  DEFAULT_PROJECT_SORT,
  sortProjects,
  toggleProjectSort,
  type ProjectSortColumn,
  type ProjectSortState,
} from "~/lib/sort-projects";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  getProjectActivity,
  isProjectActive,
  type ProjectWithCounts,
} from "~/shared/projects";

const COLUMN_LABELS: Record<ProjectSortColumn, string> = {
  name: "Name",
  group: "Category",
  status: "Status",
  running: "Running",
  createdAt: "Created",
  updatedAt: "Last edit",
  pinned: "Pin",
};

export function ProjectsTable({
  projects,
  groups,
  onOpen,
  onTogglePin,
}: {
  projects: readonly ProjectWithCounts[];
  groups: readonly Group[];
  onOpen: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const { hasRunningLaunchForProject } = useUserTerminals();
  const [sort, setSort] = useState<ProjectSortState>(DEFAULT_PROJECT_SORT);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const launchRunningProjectIds = useMemo(
    () =>
      new Set(
        projects
          .filter((project) => hasRunningLaunchForProject(project.id, project.launchCommands))
          .map((project) => project.id),
      ),
    [projects, hasRunningLaunchForProject],
  );
  const sortedProjects = useMemo(
    () => sortProjects(projects, groups, sort, launchRunningProjectIds),
    [projects, groups, sort, launchRunningProjectIds],
  );

  const handleSort = (column: ProjectSortColumn) => {
    setSort((current) => toggleProjectSort(current, column));
  };

  return (
    <CardFrame className="mc-projects-table" style={{ width: "100%" }}>
      <div className="mc-projects-table-scroll">
        <table className="mc-projects-table-grid">
          <thead>
            <tr>
              {(
                [
                  "name",
                  "group",
                  "status",
                  "running",
                  "createdAt",
                  "updatedAt",
                  "pinned",
                ] as const
              ).map((column) => (
                <SortHeader
                  key={column}
                  label={COLUMN_LABELS[column]}
                  column={column}
                  sort={sort}
                  onSort={handleSort}
                  className={column === "pinned" ? "mc-projects-table-pin-head" : undefined}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedProjects.map((project) => {
              const activity = getProjectActivity(project, launchRunningProjectIds);
              const active = isProjectActive(activity);
              const group = project.groupId ? groupById.get(project.groupId) : null;
              const totalShown = TASK_STATUSES.reduce(
                (sum, status) => sum + project.taskCounts[status],
                0,
              );

              return (
                <tr
                  key={project.id}
                  className="mc-projects-table-row"
                  data-active={active ? "true" : undefined}
                >
                  <td className="mc-projects-table-cell mc-projects-table-name">
                    <button
                      type="button"
                      onClick={() => onOpen(project.id)}
                      aria-label={`Open project ${project.name}`}
                      className="mc-projects-table-name-btn"
                    >
                      <ProjectIcon project={project} size={28} />
                      <span className="mc-projects-table-name-text">{project.name}</span>
                    </button>
                  </td>
                  <td className="mc-projects-table-cell mc-projects-table-group">
                    {group ? (
                      <span className="mc-projects-table-group-label">
                        <span
                          aria-hidden
                          className="mc-projects-table-group-dot"
                          style={{
                            background: group.color,
                            boxShadow: `0 0 8px ${group.color}66`,
                          }}
                        />
                        {group.name}
                      </span>
                    ) : (
                      <span className="mc-projects-table-muted">Ungrouped</span>
                    )}
                  </td>
                  <td className="mc-projects-table-cell">
                    <ProjectStatusBadge activity={activity} />
                  </td>
                  <td className="mc-projects-table-cell">
                    <div className="mc-projects-table-pills">
                      {TASK_STATUSES.map(
                        (status) =>
                          project.taskCounts[status] > 0 && (
                            <StatusPill
                              key={status}
                              status={status}
                              count={project.taskCounts[status]}
                            />
                          ),
                      )}
                      {totalShown === 0 && (
                        <span className="mc-projects-table-muted">—</span>
                      )}
                    </div>
                  </td>
                  <td className="mc-projects-table-cell mc-projects-table-date">
                    {formatDate(project.createdAt)}
                  </td>
                  <td className="mc-projects-table-cell mc-projects-table-date">
                    {formatRelativeTime(project.updatedAt)}
                  </td>
                  <td className="mc-projects-table-cell mc-projects-table-pin">
                    <Btn
                      size="sm"
                      variant={project.pinned ? "primary" : "ghost"}
                      icon={project.pinned ? "pin-fill" : "pin"}
                      onClick={() => onTogglePin(project.id)}
                      aria-label={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
                      aria-pressed={project.pinned}
                      title={project.pinned ? "Unpin" : "Pin"}
                      style={{ width: 30, minWidth: 30, padding: 0, paddingInline: 0 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CardFrame>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: ProjectSortColumn;
  sort: ProjectSortState;
  onSort: (column: ProjectSortColumn) => void;
  className?: string;
}) {
  const active = sort.column === column;
  return (
    <th scope="col" className={className ?? "mc-projects-table-head"}>
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={`Sort by ${label}${active ? `, ${sort.direction === "asc" ? "ascending" : "descending"}` : ""}`}
        className="mc-projects-table-sort"
        data-active={active ? "true" : undefined}
      >
        <span>{label}</span>
        <Icon
          name={active ? (sort.direction === "asc" ? "chevron-up" : "chevron-down") : "chevron-down"}
          size={11}
          style={{ opacity: active ? 1 : 0.4 }}
        />
      </button>
    </th>
  );
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
