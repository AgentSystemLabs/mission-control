import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Btn } from "~/components/ui/Btn";
import { VOICE_SHIP_EVENT } from "~/lib/voice-events";
import { mcToastResultCard } from "~/lib/mc-toast";
import { Spinner } from "~/components/ui/Spinner";
import { ApiError } from "~/lib/api";
import { useGitCommit, useGitPush, useGitStatus } from "~/queries/git";
import { isCommitCli, type CommitCli } from "~/shared/commit-cli";
import {
  beginShipOperation,
  endShipOperation,
  getProjectShipPhase,
  isProjectShipping,
  setShipPhase,
  subscribeShipOperations,
} from "~/lib/ship-operations";
import {
  ShipFailedDialog,
  SHIP_FAILED_INITIAL,
  type ShipFailedDialogState,
} from "./ShipFailedDialog";

function useProjectShipping(projectId: string, worktreeId?: string | null) {
  return useSyncExternalStore(
    subscribeShipOperations,
    () => isProjectShipping(projectId, worktreeId),
    () => false,
  );
}

function useProjectShipPhase(projectId: string, worktreeId?: string | null) {
  return useSyncExternalStore(
    subscribeShipOperations,
    () => getProjectShipPhase(projectId, worktreeId),
    () => null,
  );
}

type CommitCliFailure = {
  cli: CommitCli | null;
  message: string;
  stderr?: string;
  kind: "commit-generation-failed" | "no-commit-cli";
};

/** Pull the typed commit-failure payload out of an ApiError body, if present.
 * Returns null when the error isn't an AI-generation failure so the caller
 * falls back to the existing toast/banner path. */
function readCommitCliFailure(error: unknown): CommitCliFailure | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (!body || typeof body !== "object") return null;
  const kind = (body as { kind?: unknown }).kind;
  if (kind !== "commit-generation-failed" && kind !== "no-commit-cli") return null;
  const rawCli = (body as { cli?: unknown }).cli;
  const stderrRaw = (body as { stderr?: unknown }).stderr;
  const messageRaw = (body as { error?: unknown }).error;
  return {
    cli: isCommitCli(rawCli) ? rawCli : null,
    message: typeof messageRaw === "string" ? messageRaw : error.message,
    stderr: typeof stderrRaw === "string" ? stderrRaw : undefined,
    kind,
  };
}

/** Used when a parent didn't pass `onError` — surfaces failures through the
 * same sonner channel as the success path so the user never sees a Ship
 * spinner stop with no follow-up. */
function showShipErrorToast(title: string, detail: string) {
  mcToastResultCard({ tone: "error", title, detail }, { duration: 8000 });
}

function showShipToast(title: string, detail: string) {
  mcToastResultCard({ tone: "success", title, detail }, { duration: 5000 });
}

export function CommitPushButton({
  projectId,
  worktreeId,
  label = "Ship",
  title,
  autoStage = true,
  showAheadBadge = true,
  variant = "primary",
  size = "sm",
  splitTrailing = false,
  enabled = true,
  onError,
  onNotice,
}: {
  projectId: string;
  worktreeId?: string | null;
  label?: string;
  title?: string;
  autoStage?: boolean;
  showAheadBadge?: boolean;
  variant?: "primary" | "ghost" | "gray-frame";
  size?: "sm" | "md";
  /** Right segment of a pill-style split next to the Git status control (toolbar). */
  splitTrailing?: boolean;
  enabled?: boolean;
  onError?: (msg: string) => void;
  onNotice?: (msg: string) => void;
}) {
  const commitM = useGitCommit(projectId, worktreeId);
  const pushM = useGitPush(projectId, worktreeId);
  const { data: status } = useGitStatus(projectId, worktreeId, { enabled });
  const projectShipping = useProjectShipping(projectId, worktreeId);
  const shipPhase = useProjectShipPhase(projectId, worktreeId);
  const aheadCount = status?.aheadCount ?? null;
  const [shipFailed, setShipFailed] = useState<ShipFailedDialogState>(
    SHIP_FAILED_INITIAL,
  );

  /**
   * Run commit (with optional manual message) then push, share toasts.
   * Returns true on success, false when the commit step threw — the caller
   * decides whether that translates into the dialog opening or a toast.
   */
  const runShip = useCallback(
    async (manualMessage?: string): Promise<{ ok: boolean; error?: unknown }> => {
      let committedMessage: string | null = null;
      try {
        const c = await commitM.mutateAsync(
          manualMessage ? { autoStage, message: manualMessage } : { autoStage },
        );
        if (c.kind === "committed") {
          committedMessage = c.message.split("\n")[0];
        }
        setShipPhase(projectId, worktreeId, "pushing");
        const p = await pushM.mutateAsync();
        if (c.kind === "nothing-to-commit" && p.kind === "nothing-to-push") {
          const detail = autoStage
            ? "There are no changes to commit and nothing to push."
            : "There are no accepted changes to ship.";
          showShipToast("Nothing to ship", detail);
          onNotice?.(detail);
          return { ok: true };
        }
        const parts: string[] = [];
        if (committedMessage) parts.push(`Committed: ${committedMessage}`);
        if (p.kind === "pushed") {
          parts.push(p.setUpstream ? "pushed and set upstream" : "pushed");
        } else if (!committedMessage) {
          parts.push("nothing to push");
        }
        const detail = parts.join(" — ");
        showShipToast("Ship complete", detail);
        onNotice?.(detail);
        return { ok: true };
      } catch (e: unknown) {
        const prefix = committedMessage ? `Committed: ${committedMessage}\n` : "";
        // Bubble enough info for the caller to either open the dialog
        // (commit-generation-failed) or fall back to the toast/banner path.
        return { ok: false, error: { raw: e, prefix } };
      }
    },
    [autoStage, commitM, onNotice, projectId, pushM, worktreeId],
  );

  const surfaceShipError = useCallback(
    (message: string) => {
      // Prefer the parent's banner when they wired one (git diff view does);
      // fall back to a sonner error card so the project route never goes silent
      // after a failed Ship — see audit finding #1.
      if (onError) onError(message);
      else showShipErrorToast("Ship failed", message);
    },
    [onError],
  );

  const onCommitAndPush = useCallback(async () => {
    if (!enabled) return;
    if (isProjectShipping(projectId, worktreeId)) return;

    beginShipOperation(projectId, worktreeId);
    try {
      const result = await runShip();
      if (result.ok) return;
      const { raw, prefix } = result.error as { raw: unknown; prefix: string };
      const ciFailure = readCommitCliFailure(raw);
      if (ciFailure && !prefix) {
        // Commit step failed before anything landed — the dialog owns recovery.
        setShipFailed({
          open: true,
          cli: ciFailure.cli,
          message: ciFailure.message,
          stderr: ciFailure.stderr,
          kind: ciFailure.kind,
        });
        return;
      }
      const message = raw instanceof Error ? raw.message : "Commit & push failed";
      surfaceShipError(prefix + message);
    } finally {
      endShipOperation(projectId, worktreeId);
    }
  }, [enabled, projectId, worktreeId, runShip, surfaceShipError]);

  const onManualCommit = useCallback(
    async (message: string) => {
      if (isProjectShipping(projectId, worktreeId)) return;
      beginShipOperation(projectId, worktreeId);
      try {
        const result = await runShip(message);
        if (result.ok) {
          setShipFailed(SHIP_FAILED_INITIAL);
          return;
        }
        const { raw, prefix } = result.error as { raw: unknown; prefix: string };
        const tail = raw instanceof Error ? raw.message : "Commit failed";
        if (prefix) {
          // Manual commit succeeded; push failed. The dialog is no longer the
          // right surface — close it and surface the push failure to the page.
          setShipFailed(SHIP_FAILED_INITIAL);
          surfaceShipError(prefix + tail);
          return;
        }
        // Re-keep the dialog open and explicitly set `open: true` so the user
        // can edit + retry without losing the textarea content. Spreading
        // `prev` alone won't flip `open` back from SHIP_FAILED_INITIAL.
        setShipFailed((prev) => ({
          ...prev,
          open: true,
          message: tail,
          kind: "other",
        }));
      } finally {
        endShipOperation(projectId, worktreeId);
      }
    },
    [projectId, worktreeId, runShip, surfaceShipError],
  );

  // Voice control: "ship it" / "commit & push" triggers the same primary action.
  // onCommitAndPush already guards on `enabled` and an in-flight ship.
  useEffect(() => {
    const onVoiceShip = () => void onCommitAndPush();
    window.addEventListener(VOICE_SHIP_EVENT, onVoiceShip);
    return () => window.removeEventListener(VOICE_SHIP_EVENT, onVoiceShip);
  }, [onCommitAndPush]);

  const busy = projectShipping;
  const tooltip = enabled
    ? title ?? "commit & push"
    : "Ship unavailable until the project folder is valid";

  const labelBusy = (
    <>
      <Spinner size={11} />
      {shipPhase === "pushing" ? "Pushing…" : "Committing…"}
    </>
  );
  const labelIdle = (
    <>
      {label}
      {showAheadBadge && aheadCount != null && aheadCount > 0 && (
        <span
          style={{
            marginLeft: 6,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            padding: "0 5px",
            height: 16,
            minWidth: 16,
            borderRadius: 999,
            background: splitTrailing ? "rgba(0,0,0,0.35)" : "var(--surface-2)",
            color: splitTrailing ? "#ffffff" : "var(--text)",
            fontFamily: "var(--mono)",
            fontSize: 10,
            lineHeight: 1,
          }}
        >
          {aheadCount}
        </span>
      )}
    </>
  );

  const primaryButton = splitTrailing ? (
    <Btn
      variant={variant}
      size={size}
      icon={busy ? undefined : "upload"}
      className="mc-btn-attached-left"
      onClick={() => void onCommitAndPush()}
      disabled={busy || !enabled}
      title={tooltip}
      aria-label={tooltip}
      style={{ fontFamily: "var(--mono)" }}
    >
      {busy ? labelBusy : labelIdle}
    </Btn>
  ) : (
    <Btn
      variant={variant}
      size={size}
      icon={busy ? undefined : "upload"}
      onClick={onCommitAndPush}
      disabled={busy || !enabled}
      title={tooltip}
    >
      {busy ? labelBusy : labelIdle}
    </Btn>
  );

  return (
    <>
      {primaryButton}
      <ShipFailedDialog
        state={shipFailed}
        onClose={() => setShipFailed(SHIP_FAILED_INITIAL)}
        onManualCommit={onManualCommit}
        busy={projectShipping}
        shipPhase={shipPhase}
      />
    </>
  );
}
