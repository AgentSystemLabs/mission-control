import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  ProjectSandboxDialog,
  type ProjectSandboxCreateInput,
} from "~/components/views/ProjectSandboxDialog";
import { LicenseEntryModal, type PaywallContext } from "~/components/views/LicenseEntryModal";
import { getElectron } from "~/lib/electron";
import { createProjectSandbox } from "~/lib/project-sandbox-create";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { licenseQueryOptions, sandboxesQueryOptions } from "~/queries";
import { FREE_SANDBOX_CAP, isProTier } from "~/shared/license";
import type { Project } from "~/db/schema";

export function useProjectSandboxFlow(project: Project | null) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { createTerminal } = useUserTerminals();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallContext, setPaywallContext] = useState<PaywallContext>("sandboxes");

  const canCreate = !!project && !!getElectron()?.remoteVm;

  const openDialog = useCallback(async () => {
    if (!project || checking) return;
    const electron = getElectron();
    if (!electron?.remoteVm) {
      toast.error("Project sandboxes require the desktop app with AWS remote VM support.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const [latestLicense, latestSandboxes] = await Promise.all([
        queryClient.ensureQueryData(licenseQueryOptions()),
        queryClient.ensureQueryData(sandboxesQueryOptions()),
      ]);
      if (!isProTier(latestLicense) && latestSandboxes.sandboxes.length >= FREE_SANDBOX_CAP) {
        setPaywallContext("sandboxes");
        setPaywallOpen(true);
        return;
      }
      const detected = await electron.sandbox.detectRemote(project.path).catch(() => null);
      setRemote(detected);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to check sandbox access.");
    } finally {
      setChecking(false);
    }
  }, [checking, project, queryClient]);

  const onCreate = useCallback(
    async (input: ProjectSandboxCreateInput) => {
      if (!project) return;
      const electron = getElectron();
      if (!electron?.remoteVm) {
        setError("Project sandboxes require the desktop app with AWS remote VM support.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await createProjectSandbox({
          project,
          input,
          remote,
          electron,
          queryClient,
          router,
          createTerminal,
          onPaywall: (context) => {
            setPaywallContext(context);
            setPaywallOpen(true);
          },
          onError: setError,
          onStarted: () => {
            setOpen(false);
            setBusy(false);
          },
        });
      } finally {
        setBusy(false);
      }
    },
    [createTerminal, project, queryClient, remote, router],
  );

  const dialogs = canCreate ? (
    <>
      <ProjectSandboxDialog
        open={open}
        project={project}
        remote={remote}
        busy={busy}
        error={error}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        onCreate={onCreate}
      />
      <LicenseEntryModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="paywall"
        paywallContext={paywallContext}
      />
    </>
  ) : null;

  return { canCreate, checking, openDialog, dialogs };
}
