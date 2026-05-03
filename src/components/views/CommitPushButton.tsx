import { useCallback, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
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
  variant = "primary",
  size = "sm",
  onError,
  onNotice,
}: {
  projectId: string;
  variant?: "primary" | "ghost";
  size?: "sm" | "md";
  onError?: (msg: string) => void;
  onNotice?: (msg: string) => void;
}) {
  const commitM = useGitCommit(projectId);
  const pushM = useGitPush(projectId);
  const { data: status } = useGitStatus(projectId);
  const aheadCount = status?.aheadCount ?? null;

  const [modal, setModal] = useState<
    null | { title: string; message: string; tone: "info" | "error" }
  >(null);

  const onCommitAndPush = useCallback(async () => {
    let committedMessage: string | null = null;
    try {
      const c = await commitM.mutateAsync();
      if (c.kind === "committed") {
        committedMessage = c.message.split("\n")[0];
      }
      const p = await pushM.mutateAsync();
      if (c.kind === "nothing-to-commit" && p.kind === "nothing-to-push") {
        const m = {
          title: "Nothing to commit or push",
          message: "There are no changes to commit and nothing to push.",
        };
        if (onNotice) onNotice(m.message);
        else setModal({ ...m, tone: "info" });
        return;
      }
      const parts: string[] = [];
      if (committedMessage) parts.push(`Committed: ${committedMessage}`);
      if (p.kind === "pushed") {
        parts.push(p.setUpstream ? "pushed and set upstream" : "pushed");
      } else if (!committedMessage) {
        parts.push("nothing to push");
      }
      const msg = parts.join(" — ");
      if (onNotice) onNotice(msg);
      else setModal({ title: "Done", message: msg, tone: "info" });
    } catch (e: any) {
      const prefix = committedMessage ? `Committed: ${committedMessage}\n` : "";
      const msg = prefix + (e?.message || "Commit & push failed");
      if (onError) onError(msg);
      else setModal({ title: "Commit & push failed", message: msg, tone: "error" });
    }
  }, [commitM, pushM, onError, onNotice]);

  const committing = commitM.isPending;
  const pushing = pushM.isPending;
  const busy = committing || pushing;

  return (
    <>
      <Btn
        variant={variant}
        size={size}
        icon={undefined}
        onClick={onCommitAndPush}
        disabled={busy}
        title="Commit all changes, then push to remote"
      >
        {busy ? (
          <>
            <Spinner />
            {committing ? "Committing…" : "Pushing…"}
          </>
        ) : (
          <>
            Commit & Push
            {aheadCount != null && aheadCount > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  padding: "0 6px",
                  borderRadius: 999,
                  background: "var(--surface-2)",
                  color: "var(--text)",
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
        )}
      </Btn>
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.title ?? ""}
        footer={
          <Btn variant="primary" size="sm" onClick={() => setModal(null)}>
            OK
          </Btn>
        }
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: modal?.tone === "error" ? "var(--status-failed)" : "var(--text-dim)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {modal?.message}
        </div>
      </Modal>
    </>
  );
}
