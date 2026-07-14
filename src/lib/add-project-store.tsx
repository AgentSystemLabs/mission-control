import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { api } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { isGroupIdActive, useActiveGroup } from "~/lib/active-group";
import { useHotkey, isEditableTarget } from "~/lib/use-hotkey";
import {
  groupsQueryOptions,
  queryKeys,
  useGroups,
} from "~/queries";
import type { Group } from "~/db/schema";

type Ctx = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const AddProjectContext = createContext<Ctx | null>(null);

export function AddProjectProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialPath, setInitialPath] = useState("");
  const browsingRef = useRef(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: groups = [] } = useGroups();
  const { activeGroup } = useActiveGroup();

  const open = useCallback(() => {
    if (browsingRef.current) return;
    const electron = getElectron();
    if (!electron) {
      setInitialPath("");
      void queryClient.ensureQueryData(groupsQueryOptions());
      setIsOpen(true);
      return;
    }

    browsingRef.current = true;
    void (async () => {
      try {
        const pickedPath = await electron.browseFolder();
        if (!pickedPath) return;
        void queryClient.ensureQueryData(groupsQueryOptions());
        setInitialPath(pickedPath);
        setIsOpen(true);
      } catch (error) {
        console.error("[projects] failed to browse for project folder:", error);
      } finally {
        browsingRef.current = false;
      }
    })();
  }, [queryClient]);
  const close = useCallback(() => {
    setIsOpen(false);
    setInitialPath("");
  }, []);
  const createGroupForSelection = useCallback(
    async (name: string) => {
      const { group } = await api.createGroup({ name });
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        current ? [...current, group] : [group],
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      return group;
    },
    [queryClient],
  );

  useHotkey(
    "project.add",
    (e) => {
      if (isEditableTarget(e.target)) return;
      open();
    },
    { preventDefault: true },
  );

  return (
    <AddProjectContext.Provider value={{ open, close, isOpen }}>
      {children}
      <ProjectDialog
        open={isOpen}
        project={null}
        initialPath={initialPath}
        // New projects land in the active group by default — the dialog's
        // Group field stays editable to override.
        initialGroupId={isGroupIdActive(activeGroup) ? activeGroup : null}
        groups={groups}
        onClose={close}
        onCreateGroup={createGroupForSelection}
        onSave={async (data) => {
          const { pendingImage, imagePath: _ignore, ...createBody } = data;
          const { project: created } = await api.createProject(createBody);
          if (pendingImage) {
            const electron = (await import("~/lib/electron")).getElectron();
            const result = await electron?.saveProjectImage({
              projectId: created.id,
              sourcePath: pendingImage.sourcePath,
              extension: pendingImage.extension,
            });
            if (result && "filename" in result) {
              await api.updateProject(created.id, { imagePath: result.filename });
            }
          }
          close();
          void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
          // If the user is already viewing a project detail page, switch to the
          // project they just opened so it becomes the selected/active one.
          if (router.state.location.pathname.startsWith("/projects/")) {
            void router.navigate({ to: "/projects/$id", params: { id: created.id } });
          }
        }}
      />
    </AddProjectContext.Provider>
  );
}

export function useAddProject(): Ctx {
  const ctx = useContext(AddProjectContext);
  if (!ctx) throw new Error("useAddProject must be used within AddProjectProvider");
  return ctx;
}
