import { useCallback } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { useGitCommit, useGitPush, useGitStatus } from "~/queries/git";

export function CommitPushButton({
  projectId,
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
  const commitM = useGitCommit(projectId);
  const pushM = useGitPush(projectId);
  const { data: status } = useGitStatus(projectId);
  const aheadCount = status?.aheadCount ?? null;

  const retryPushOnly = useCallback(async () => {
    try {
      const p = await pushM.mutateAsync();
      if (p.kind === "pushed") {
        onNotice?.(p.setUpstream ? "Pushed and set upstream." : "Pushed.");
      } else {
        onNotice?.("Nothing to push.");
      }
    } catch (e: any) {
      const msg = e?.message || "Push failed";
      toast.error(`Push failed: ${msg}`, {
        action: {
          label: "Retry push",
          onClick: () => void retryPushOnly(),
        },
      });
    }
  }, [pushM, onNotice]);

  const onCommitAndPush = useCallback(async () => {
    let committedMessage: string | null = null;
    try {
      const c = await commitM.mutateAsync({ autoStage });
      if (c.kind === "committed") {
        committedMessage = c.message.split("\n")[0];
      }
      let p;
      try {
        p = await pushM.mutateAsync();
      } catch (pushErr: any) {
        // Partial failure: commit landed but push failed. Surface as a toast
        // with a Retry-push action so the user has to acknowledge before the
        // button silently re-enables and they double-commit on top.
        const msg = pushErr?.message || "Push failed";
        const prefix = committedMessage ? `Committed: ${committedMessage}. ` : "";
        toast.error(`${prefix}Push failed: ${msg}`, {
          action: {
            label: "Retry push",
            onClick: () => void retryPushOnly(),
          },
        });
        onError?.(`${prefix}Push failed: ${msg}`);
        return;
      }
      if (c.kind === "nothing-to-commit" && p.kind === "nothing-to-push") {
        onNotice?.(
          autoStage
            ? "There are no changes to commit and nothing to push."
            : "There are no accepted changes to ship.",
        );
        return;
      }
      const parts: string[] = [];
      if (committedMessage) parts.push(`Committed: ${committedMessage}`);
      if (p.kind === "pushed") {
        parts.push(p.setUpstream ? "pushed and set upstream" : "pushed");
      } else if (!committedMessage) {
        parts.push("nothing to push");
      }
      onNotice?.(parts.join(" — "));
    } catch (e: any) {
      const prefix = committedMessage ? `Committed: ${committedMessage}\n` : "";
      onError?.(prefix + (e?.message || "Commit & push failed"));
    }
  }, [autoStage, commitM, pushM, onError, onNotice, retryPushOnly]);

  const committing = commitM.isPending;
  const pushing = pushM.isPending;
  const busy = committing || pushing;

  const labelBusy = <>{committing ? "Committing…" : "Pushing…"}</>;
  const labelIdle = (
    <>
      {label}
      {showAheadBadge && aheadCount != null && aheadCount > 0 && (
        <span
          style={{
            marginLeft: 6,
            padding: "0 6px",
            borderRadius: 999,
            background: splitTrailing ? "rgba(10,11,13,0.12)" : "var(--surface-2)",
            color: splitTrailing ? "#0a0b0d" : "var(--text)",
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
      className="mc-btn-attached-left"
      onClick={() => void onCommitAndPush()}
      disabled={busy}
      title={title ?? label}
      aria-label={title ?? label}
      style={{ fontFamily: "var(--mono)" }}
    >
      {busy ? labelBusy : labelIdle}
    </Btn>
  ) : (
    <Btn
      variant={variant}
      size={size}
      icon={undefined}
      onClick={onCommitAndPush}
      disabled={busy}
      title={title ?? label}
    >
      {busy ? labelBusy : labelIdle}
    </Btn>
  );

  return primaryButton;
}
