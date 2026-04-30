import { createContext, useCallback, useContext, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { api } from "~/lib/api";
import { useHotkey, isEditableTarget } from "~/lib/use-hotkey";
import { groupsQueryOptions, queryKeys, useGroups } from "~/queries";

type Ctx = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const AddProjectContext = createContext<Ctx | null>(null);

export function AddProjectProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: groups = [] } = useGroups();

  const open = useCallback(() => {
    void queryClient.ensureQueryData(groupsQueryOptions());
    setIsOpen(true);
  }, [queryClient]);
  const close = useCallback(() => setIsOpen(false), []);

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
        groups={groups}
        onClose={close}
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
          setIsOpen(false);
          await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
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
