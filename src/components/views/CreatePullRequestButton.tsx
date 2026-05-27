import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Modal } from "~/components/ui/Modal";
import { Icon } from "~/components/ui/Icon";
import { formatCreatePullRequestError } from "~/lib/pull-request-errors";
import { getElectron } from "~/lib/electron";
import { DEFAULT_BRANCH } from "~/shared/domain";
import { useGitCreatePullRequest } from "~/queries/git";

export type CreatePullRequestDialogState =
  | {
      kind: "gh-missing";
      compareUrl: string;
      branch: string;
      baseBranch: string;
    }
  | {
      kind: "issue";
      title: string;
      message: string;
    };

function openExternal(url: string) {
  const electron = getElectron();
  if (electron?.openExternal) {
    void electron.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noreferrer");
}

function Spinner() {
  return (
    <span style={{ display: "inline-flex", animation: "spin 0.8s linear infinite" }}>
      <Icon name="refresh" size={11} />
    </span>
  );
}

export function useCreatePullRequestAction({
  projectId,
  worktreeId,
  branch,
  projectPathUsable = true,
}: {
  projectId: string;
  worktreeId?: string | null;
  branch?: string | null;
  projectPathUsable?: boolean;
}) {
  const createPr = useGitCreatePullRequest(projectId, worktreeId);
  const [dialog, setDialog] = useState<CreatePullRequestDialogState | null>(null);

  const onCreate = useCallback(async () => {
    if (createPr.isPending) return;

    if (!projectPathUsable) {
      setDialog({
        kind: "issue",
        title: "Project folder unavailable",
        message:
          "Mission Control cannot access this project's folder. Fix or reveal the project path, then try again.",
      });
      return;
    }

    if (!branch?.trim()) {
      setDialog({
        kind: "issue",
        title: "Branch unavailable",
        message:
          "Mission Control could not determine the current branch yet. Wait for git status to finish loading, then try again.",
      });
      return;
    }

    if (branch === DEFAULT_BRANCH) {
      setDialog({
        kind: "issue",
        title: "Switch to a feature branch",
        message: `You're on ${DEFAULT_BRANCH}. Check out a feature branch for this worktree before opening a pull request into origin/${DEFAULT_BRANCH}.`,
      });
      return;
    }

    try {
      const result = await createPr.mutateAsync();
      if (result.kind === "gh-missing") {
        setDialog({
          kind: "gh-missing",
          compareUrl: result.compareUrl,
          branch: result.branch,
          baseBranch: result.baseBranch,
        });
        return;
      }
      openExternal(result.url);
      toast.success(
        result.kind === "exists" ? "Opened existing pull request" : "Pull request created",
      );
    } catch (error) {
      const { title, message } = formatCreatePullRequestError(error);
      setDialog({
        kind: "issue",
        title,
        message,
      });
    }
  }, [branch, createPr, projectPathUsable]);

  return {
    onCreate,
    busy: createPr.isPending,
    dialog,
    closeDialog: () => setDialog(null),
  };
}

export function CreatePullRequestDialog({
  state,
  onClose,
}: {
  state: CreatePullRequestDialogState | null;
  onClose: () => void;
}) {
  const ghMissing = state?.kind === "gh-missing" ? state : null;

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={
        state?.kind === "gh-missing"
          ? "GitHub CLI not installed"
          : (state?.title ?? "Create pull request")
      }
      width={520}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Close
          </Btn>
          {ghMissing && (
            <Btn
              variant="primary"
              icon="external-link"
              onClick={() => {
                openExternal(ghMissing.compareUrl);
                onClose();
              }}
            >
              Open pull request on GitHub
            </Btn>
          )}
        </>
      }
    >
      {state?.kind === "issue" && (
        <p style={{ margin: 0, color: "var(--text-dim)", fontSize: 13, whiteSpace: "pre-wrap" }}>
          {state.message}
        </p>
      )}
      {ghMissing && (
        <div style={{ display: "grid", gap: 12, color: "var(--text-dim)", fontSize: 13 }}>
          <p style={{ margin: 0 }}>
            Install the{" "}
            <a
              href="https://cli.github.com/"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)" }}
            >
              GitHub CLI
            </a>{" "}
            to create pull requests from Mission Control, or open the compare page for branch{" "}
            <code style={{ color: "var(--text)" }}>{ghMissing.branch}</code> into{" "}
            <code style={{ color: "var(--text)" }}>{ghMissing.baseBranch}</code>.
          </p>
          <a
            href={ghMissing.compareUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              color: "var(--accent)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              wordBreak: "break-all",
            }}
          >
            {ghMissing.compareUrl}
          </a>
        </div>
      )}
    </Modal>
  );
}

export function CreatePullRequestMenuItem({
  onSelect,
  busy,
}: {
  onSelect: () => void;
  busy?: boolean;
}) {
  return (
    <Btn
      variant="ghost"
      icon={busy ? undefined : "github"}
      onClick={onSelect}
      disabled={busy}
      style={{ justifyContent: "flex-start" }}
      title={`Create pull request to origin/${DEFAULT_BRANCH}`}
    >
      {busy ? (
        <>
          <Spinner />
          Creating pull request…
        </>
      ) : (
        "Create pull request"
      )}
    </Btn>
  );
}
