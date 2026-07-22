import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  ConnectSandboxDialog,
  type ConnectSandboxInput,
} from "~/components/views/ConnectSandboxDialog";
import { activateSandboxScope } from "~/lib/activate-sandbox-scope";
import { api } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { waitForSandboxConnected } from "~/lib/project-sandbox-create";
import { queryKeys } from "~/queries";

// The agent is expected to already be running when the user connects, so a
// failure surfaces fast (auth/DNS/TLS/refused all fail the state machine) —
// no need for the 3-minute provisioning budget the AWS create flow uses.
const MANUAL_CONNECT_TIMEOUT_MS = 30_000;

/** Register an externally-provisioned remote sandbox and connect to it. */
export function useConnectSandboxFlow() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = useCallback(() => {
    setError(null);
    setOpen(true);
  }, []);

  const onConnect = useCallback(
    async (input: ConnectSandboxInput) => {
      const electron = getElectron();
      if (!electron) {
        setError("Connecting a sandbox requires the desktop app.");
        return;
      }
      setBusy(true);
      setError(null);
      let registeredId: string | null = null;
      try {
        const { sandbox } = await api.connectSandbox(input);
        registeredId = sandbox.id;
        await queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes });
        const connected = await electron.sandbox.connect(sandbox.id);
        if (!connected.ok) throw new Error(connected.error);
        await waitForSandboxConnected(electron, sandbox.id, MANUAL_CONNECT_TIMEOUT_MS);
        // activateSandboxScope toasts its own failure and returns false — it
        // never throws, so success must not be assumed past this point.
        const activated = await activateSandboxScope(queryClient, sandbox.id);
        if (!activated) {
          setError(
            "Connected and saved, but couldn't switch to it — pick it in the scope switcher.",
          );
          return;
        }
        toast.success(`Connected to ${sandbox.name}`);
        setOpen(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect to the sandbox.";
        // A row that registered but failed to connect is kept: the user can fix
        // the agent and retry from the scope switcher, or delete it in its
        // settings — silently rolling back would hide what happened.
        setError(
          registeredId
            ? `${message} The sandbox was saved — pick it in the scope switcher to retry, or delete it from its settings.`
            : message,
        );
      } finally {
        setBusy(false);
      }
    },
    [queryClient],
  );

  const dialogs = (
    <ConnectSandboxDialog
      open={open}
      busy={busy}
      error={error}
      onClose={() => {
        if (!busy) setOpen(false);
      }}
      onConnect={onConnect}
    />
  );

  return { openDialog, dialogs };
}
