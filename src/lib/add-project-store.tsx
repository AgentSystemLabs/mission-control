import { createContext, useCallback, useContext, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { LicenseEntryModal } from "~/components/views/LicenseEntryModal";
import { api, ApiError } from "~/lib/api";
import { useHotkey, isEditableTarget } from "~/lib/use-hotkey";
import {
  groupsQueryOptions,
  licenseQueryOptions,
  projectsQueryOptions,
  queryKeys,
  useGroups,
} from "~/queries";
import { isWebDaytonaRuntime } from "~/lib/runtime";
import { FREE_PROJECT_CAP, isProTier } from "~/shared/license";

type Ctx = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const AddProjectContext = createContext<Ctx | null>(null);

export function AddProjectProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: groups = [] } = useGroups();

  const open = useCallback(async () => {
    void queryClient.ensureQueryData(groupsQueryOptions());
    const latestProjects = await queryClient.ensureQueryData(projectsQueryOptions());
    if (isWebDaytonaRuntime()) {
      setIsOpen(true);
      return;
    }
    const latestLicense = await queryClient.ensureQueryData(licenseQueryOptions());
    if (!isProTier(latestLicense) && latestProjects.length >= FREE_PROJECT_CAP) {
      setPaywallOpen(true);
      return;
    }
    setIsOpen(true);
  }, [queryClient]);
  const close = useCallback(() => setIsOpen(false), []);
  const closePaywall = useCallback(() => setPaywallOpen(false), []);

  useHotkey(
    "project.add",
    (e) => {
      if (isEditableTarget(e.target)) return;
      void open();
    },
    { preventDefault: true },
  );

  return (
    <AddProjectContext.Provider value={{ open: () => void open(), close, isOpen }}>
      {children}
      <ProjectDialog
        open={isOpen}
        project={null}
        groups={groups}
        onClose={close}
        onSave={async (data) => {
          const { pendingImage, imagePath: _ignore, ...createBody } = data;
          try {
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
          } catch (e) {
            if (e instanceof ApiError && e.status === 402) {
              // Server caught a race: UI thought we were under cap but server
              // disagreed. Close the create dialog and surface the paywall.
              setIsOpen(false);
              setPaywallOpen(true);
              return;
            }
            throw e;
          }
        }}
      />
      <LicenseEntryModal
        open={paywallOpen}
        onClose={closePaywall}
        reason="paywall"
      />
    </AddProjectContext.Provider>
  );
}

export function useAddProject(): Ctx {
  const ctx = useContext(AddProjectContext);
  if (!ctx) throw new Error("useAddProject must be used within AddProjectProvider");
  return ctx;
}
