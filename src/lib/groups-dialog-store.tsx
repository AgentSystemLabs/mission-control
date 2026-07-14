import { createContext, useCallback, useContext, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GroupsDialog } from "~/components/views/GroupsDialog";
import { api } from "~/lib/api";
import { queryKeys, useGroups, useScopedProjects } from "~/queries";
import type { Group } from "~/db/schema";

type Ctx = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const GroupsDialogContext = createContext<Ctx | null>(null);

/**
 * Shell-level home for the Manage Groups dialog so it can be opened from
 * anywhere (dashboard toolbar, the header GroupSwitcher, …) — the wiring
 * previously lived inline in the dashboard route.
 */
export function GroupsDialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: groups = [] } = useGroups();
  const { data: projects = [] } = useScopedProjects();

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const invalidateGroups = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
    [queryClient],
  );
  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient],
  );

  return (
    <GroupsDialogContext.Provider value={{ open, close, isOpen }}>
      {children}
      <GroupsDialog
        open={isOpen}
        groups={groups}
        projects={projects}
        onClose={close}
        onAdd={async (name) => {
          const { group } = await api.createGroup({ name });
          queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
            current ? [...current, group] : [group],
          );
          await invalidateGroups();
        }}
        onRemove={async (id) => {
          await api.deleteGroup(id);
          await Promise.all([invalidateGroups(), invalidateProjects()]);
        }}
        onRename={async (id, name) => {
          await api.updateGroup(id, { name });
          await invalidateGroups();
        }}
        onRecolor={async (id, color) => {
          await api.updateGroup(id, { color });
          await invalidateGroups();
        }}
        onProjectGroupChange={async (projectId, groupId) => {
          await api.updateProject(projectId, { groupId });
          await Promise.all([
            invalidateProjects(),
            queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
          ]);
        }}
      />
    </GroupsDialogContext.Provider>
  );
}

export function useGroupsDialog(): Ctx {
  const ctx = useContext(GroupsDialogContext);
  if (!ctx) throw new Error("useGroupsDialog must be used within GroupsDialogProvider");
  return ctx;
}
