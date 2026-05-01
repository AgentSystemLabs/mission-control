import type { Group } from "~/db/schema";

export type GroupableProject = {
  groupId: string | null;
  pinned: boolean;
};

export type ProjectGroupSection<TProject extends GroupableProject> = {
  group: Group;
  projects: TProject[];
};

export type ProjectPickerSection<TProject extends GroupableProject> = {
  key: string;
  label: string | null;
  color: string | null;
  projects: TProject[];
};

export function groupProjects<TProject extends GroupableProject>(
  projects: readonly TProject[],
  groups: readonly Group[]
) {
  const groupedById = new Map<string, TProject[]>();
  for (const group of groups) {
    groupedById.set(group.id, []);
  }

  const pinned: TProject[] = [];
  const ungrouped: TProject[] = [];

  for (const project of projects) {
    if (project.pinned) {
      pinned.push(project);
      continue;
    }

    const grouped = project.groupId ? groupedById.get(project.groupId) : undefined;
    if (grouped) {
      grouped.push(project);
    } else {
      ungrouped.push(project);
    }
  }

  const byGroup: ProjectGroupSection<TProject>[] = groups
    .map((group) => ({
      group,
      projects: groupedById.get(group.id) ?? [],
    }))
    .filter((section) => section.projects.length > 0);

  return { pinned, byGroup, ungrouped };
}

export function projectPickerSections<TProject extends GroupableProject>(
  projects: readonly TProject[],
  groups: readonly Group[]
): ProjectPickerSection<TProject>[] {
  const { pinned, byGroup, ungrouped } = groupProjects(projects, groups);
  const sections: ProjectPickerSection<TProject>[] = [];

  if (pinned.length) {
    sections.push({
      key: "__pinned",
      label: "Pinned",
      color: null,
      projects: pinned,
    });
  }

  for (const { group, projects: groupProjects } of byGroup) {
    sections.push({
      key: group.id,
      label: group.name,
      color: group.color,
      projects: groupProjects,
    });
  }

  if (ungrouped.length) {
    sections.push({
      key: "__ungrouped",
      label: sections.length ? "Ungrouped" : null,
      color: null,
      projects: ungrouped,
    });
  }

  return sections;
}
