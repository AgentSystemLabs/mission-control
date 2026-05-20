import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { useGitCommit, useGitPush, useGitStatus } from "~/queries/git";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";

const activeShipOperations = new Map<string, number>();
const shipOperationListeners = new Set<() => void>();

function shipKey(projectId: string, worktreeId?: string | null) {
  return `${projectId}:${worktreeId || MAIN_WORKTREE_ID}`;
}

function isProjectShipping(projectId: string, worktreeId?: string | null) {
  return (activeShipOperations.get(shipKey(projectId, worktreeId)) ?? 0) > 0;
}

function notifyShipOperationListeners() {
  for (const listener of shipOperationListeners) listener();
}

function beginShipOperation(projectId: string, worktreeId?: string | null) {
  const key = shipKey(projectId, worktreeId);
  activeShipOperations.set(key, (activeShipOperations.get(key) ?? 0) + 1);
  notifyShipOperationListeners();
}

function endShipOperation(projectId: string, worktreeId?: string | null) {
  const key = shipKey(projectId, worktreeId);
  const next = Math.max(0, (activeShipOperations.get(key) ?? 0) - 1);
  if (next === 0) activeShipOperations.delete(key);
  else activeShipOperations.set(key, next);
  notifyShipOperationListeners();
}

function subscribeShipOperations(listener: () => void) {
  shipOperationListeners.add(listener);
  return () => {
    shipOperationListeners.delete(listener);
  };
}

function useProjectShipping(projectId: string, worktreeId?: string | null) {
  return useSyncExternalStore(
    subscribeShipOperations,
    () => isProjectShipping(projectId, worktreeId),
    () => false,
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-flex",
        animation: "spin 0.8s linear infinite",
      }}
    >
      <Icon name="refresh" size={11} />
    </span>
  );
}

function showShipToast(title: string, detail: string) {
  toast.custom(
    () => (
      <CardFrame
        solid
        style={{
          minWidth: 320,
          maxWidth: 460,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "color-mix(in srgb, var(--accent) 22%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 50%, transparent)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="check" size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 13 }}>
            {title}
          </div>
          <div
            title={detail}
            style={{
              color: "var(--text-faint)",
              fontSize: 12,
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {detail}
          </div>
        </div>
      </CardFrame>
    ),
    { duration: 5000 },
  );
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
  onError,
  onNotice,
}: {
  projectId: string;
  worktreeId?: string | null;
  label?: string;
  title?: string;
  autoStage?: boolean;
  showAheadBadge?: boolean;
  variant?: "primary" | "ghost";
  size?: "sm" | "md";
  /** Right segment of a pill-style split next to the Git status control (toolbar). */
  splitTrailing?: boolean;
  onError?: (msg: string) => void;
  onNotice?: (msg: string) => void;
}) {
  const commitM = useGitCommit(projectId, worktreeId);
  const pushM = useGitPush(projectId, worktreeId);
  const { data: status } = useGitStatus(projectId, worktreeId);
  const projectShipping = useProjectShipping(projectId, worktreeId);
  const aheadCount = status?.aheadCount ?? null;

  const onCommitAndPush = useCallback(async () => {
    if (isProjectShipping(projectId, worktreeId)) return;

    let committedMessage: string | null = null;
    beginShipOperation(projectId, worktreeId);
    try {
      const c = await commitM.mutateAsync({ autoStage });
      if (c.kind === "committed") {
        committedMessage = c.message.split("\n")[0];
      }
      const p = await pushM.mutateAsync();
      if (c.kind === "nothing-to-commit" && p.kind === "nothing-to-push") {
        const detail =
          autoStage
            ? "There are no changes to commit and nothing to push."
            : "There are no accepted changes to ship.";
        showShipToast("Nothing to ship", detail);
        onNotice?.(detail);
        return;
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
    } catch (e: any) {
      const prefix = committedMessage ? `Committed: ${committedMessage}\n` : "";
      onError?.(prefix + (e?.message || "Commit & push failed"));
    } finally {
      endShipOperation(projectId, worktreeId);
    }
  }, [autoStage, commitM, projectId, worktreeId, pushM, onError, onNotice]);

  const committing = commitM.isPending;
  const pushing = pushM.isPending;
  const localBusy = committing || pushing;
  const busy = localBusy || projectShipping;
  const tooltip = title ?? "commit & push";

  const labelBusy = (
    <>
      <Spinner />
      {committing ? "Committing…" : "Pushing…"}
    </>
  );
  const labelIdle = (
    <>
      {label}
      {showAheadBadge && aheadCount != null && aheadCount > 0 && (
        <span
          style={{
            marginLeft: 6,
            padding: "0 6px",
            borderRadius: 999,
            background: splitTrailing ? "rgba(0,0,0,0.35)" : "var(--surface-2)",
            color: splitTrailing ? "#ffffff" : "var(--text)",
            fontFamily: "var(--mono)",
            fontSize: 10,
            lineHeight: "16px",
            minWidth: 16,
            textAlign: "center",
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
      icon={localBusy ? undefined : "upload"}
      className="mc-btn-attached-left"
      onClick={() => void onCommitAndPush()}
      disabled={busy}
      title={tooltip}
      aria-label={tooltip}
      style={{ fontFamily: "var(--mono)" }}
    >
      {localBusy ? labelBusy : labelIdle}
    </Btn>
  ) : (
    <Btn
      variant={variant}
      size={size}
      icon={localBusy ? undefined : "upload"}
      onClick={onCommitAndPush}
      disabled={busy}
      title={tooltip}
    >
      {localBusy ? labelBusy : labelIdle}
    </Btn>
  );

  return primaryButton;
}
