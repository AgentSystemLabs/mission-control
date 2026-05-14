import { createContext, useCallback, useContext, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import type { ProjectWithCounts } from "~/shared/projects";
import { TASK_STATUSES } from "~/shared/domain";
import { FREE_PROJECT_CAP, isProTier } from "~/shared/license";
import { getErrorMessage } from "~/shared/errors";

type Ctx = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
  // True while open() is awaiting prereq queries (projects + license). Lets
  // triggers show a spinner / aria-busy while the gate resolves.
  opening: boolean;
};

const AddProjectContext = createContext<Ctx | null>(null);

function withEmptyProjectCounts(project: ProjectWithCounts): ProjectWithCounts {
  return {
    ...project,
    taskCounts: {
      ...Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])),
      total: 0,
      activeNonDone: 0,
    } as ProjectWithCounts["taskCounts"],
    preview: null,
    githubUrl: project.githubUrl ?? null,
  };
}

export function AddProjectProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: groups = [] } = useGroups();

  const open = useCallback(async () => {
    setOpening(true);
    try {
      void queryClient.ensureQueryData(groupsQueryOptions()).catch((e: unknown) => {
        toast.error("Failed to load project groups", {
          description: getErrorMessage(e) || "Try again.",
        });
      });
      const [latestProjects, latestLicense] = await Promise.all([
        queryClient.ensureQueryData(projectsQueryOptions()),
        queryClient.ensureQueryData(licenseQueryOptions()),
      ]);
      if (!isProTier(latestLicense) && latestProjects.length >= FREE_PROJECT_CAP) {
        setPaywallOpen(true);
        return;
      }
      setIsOpen(true);
    } catch (e: unknown) {
      toast.error("Failed to open Add Project", {
        description: getErrorMessage(e) || "Try again.",
      });
    } finally {
      setOpening(false);
    }
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
    <AddProjectContext.Provider value={{ open: () => void open(), close, isOpen, opening }}>
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
            queryClient.setQueryData<ProjectWithCounts[]>(queryKeys.projects, (current) => {
              if (!current || current.some((project) => project.id === created.id)) return current;
              return [...current, withEmptyProjectCounts(created as ProjectWithCounts)];
            });
            let imageFailure: string | null = null;
            if (pendingImage) {
              try {
                const electron = (await import("~/lib/runtime")).getRuntime();
                const result = await electron?.saveProjectImage({
                  projectId: created.id,
                  sourcePath: pendingImage.sourcePath,
                  extension: pendingImage.extension,
                });
                if (result && "filename" in result) {
                  await api.updateProject(created.id, { imagePath: result.filename });
                } else if (result && "error" in result) {
                  imageFailure = result.error;
                } else {
                  imageFailure = "Image upload is unavailable";
                }
              } catch (e: unknown) {
                imageFailure = getErrorMessage(e) || "Image upload failed";
              }
            }
            setIsOpen(false);
            await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
            if (imageFailure) {
              toast.error("Project created, but image upload failed", {
                description: imageFailure,
              });
            }
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
