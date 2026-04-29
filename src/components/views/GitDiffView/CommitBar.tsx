import { useCallback, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { useGitCommit, useGitPush } from "~/queries/git";

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

export function CommitBar({ projectId }: { projectId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emptyModal, setEmptyModal] = useState<
    null | { title: string; message: string }
  >(null);

  const commitM = useGitCommit(projectId);
  const pushM = useGitPush(projectId);

  const onCommit = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const r = await commitM.mutateAsync();
      if (r.kind === "nothing-to-commit") {
        setEmptyModal({
          title: "Nothing to commit",
          message: "There are no changes to commit.",
        });
        return;
      }
      setNotice(`Committed: ${r.message.split("\n")[0]}`);
    } catch (e: any) {
      setError(e?.message || "Commit failed");
    }
  }, [commitM]);

  const onPush = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const r = await pushM.mutateAsync();
      if (r.kind === "nothing-to-push") {
        setEmptyModal({
          title: "Nothing to push",
          message: "There are no changes to push.",
        });
        return;
      }
      setNotice(r.setUpstream ? "Pushed and set upstream." : "Pushed.");
    } catch (e: any) {
      setError(e?.message || "Push failed");
    }
  }, [pushM]);

  const committing = commitM.isPending;
  const pushing = pushM.isPending;

  return (
    <>
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: 12,
          background: "var(--surface-1)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {error && (
          <div
            style={{
              color: "var(--status-failed)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {error}
          </div>
        )}
        {notice && !error && (
          <div
            style={{
              color: "var(--text-dim)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {notice}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }} />
          <Btn
            variant="ghost"
            size="sm"
            icon={pushing ? undefined : "upload"}
            onClick={onPush}
            disabled={pushing}
            title="Push current branch"
          >
            {pushing ? (
              <>
                <Spinner />
                Pushing…
              </>
            ) : (
              "Push"
            )}
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon={undefined}
            onClick={onCommit}
            disabled={committing}
            title="Generate a commit message and commit all changes"
          >
            {committing ? (
              <>
                <Spinner />
                Committing…
              </>
            ) : (
              "Commit"
            )}
          </Btn>
        </div>
      </div>
      <Modal
        open={!!emptyModal}
        onClose={() => setEmptyModal(null)}
        title={emptyModal?.title ?? ""}
        footer={
          <Btn variant="primary" size="sm" onClick={() => setEmptyModal(null)}>
            OK
          </Btn>
        }
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          {emptyModal?.message}
        </div>
      </Modal>
    </>
  );
}
