import { useCallback } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { useGitCommit, useGitPush, useGitStatus } from "~/queries/git";

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

  const onCommitAndPush = useCallback(async () => {
    let committedMessage: string | null = null;
    try {
      const c = await commitM.mutateAsync({ autoStage });
      if (c.kind === "committed") {
        committedMessage = c.message.split("\n")[0];
      }
      const p = await pushM.mutateAsync();
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
  }, [autoStage, commitM, pushM, onError, onNotice]);

  const committing = commitM.isPending;
  const pushing = pushM.isPending;
  const busy = committing || pushing;

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
    <button
      type="button"
      onClick={() => void onCommitAndPush()}
      disabled={busy}
      title={title ?? label}
      aria-label={title ?? label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: "100%",
        margin: 0,
        border: "none",
        borderTopRightRadius: 999,
        borderBottomRightRadius: 999,
        padding: "0 12px",
        background: "var(--accent)",
        color: "#0a0b0d",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.75 : 1,
        transition: "background 0.12s, opacity 0.12s",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (busy) return;
        e.currentTarget.style.background = "var(--accent-hover)";
      }}
      onMouseLeave={(e) => {
        if (busy) return;
        e.currentTarget.style.background = "var(--accent)";
      }}
    >
      {busy ? labelBusy : labelIdle}
    </button>
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
