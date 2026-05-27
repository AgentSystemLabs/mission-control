import { ApiError } from "~/lib/api";

export type CreatePullRequestErrorView = {
  title: string;
  message: string;
};

export function formatCreatePullRequestError(error: unknown): CreatePullRequestErrorView {
  if (error instanceof ApiError) {
    const body =
      error.body && typeof error.body === "object"
        ? (error.body as { error?: unknown; stderr?: unknown })
        : null;
    const serverMessage = typeof body?.error === "string" ? body.error : error.message;
    const stderr = typeof body?.stderr === "string" ? body.stderr.trim() : "";

    if (error.status === 404 || serverMessage.trim().toLowerCase() === "not found") {
      return {
        title: "Create pull request unavailable",
        message:
          "Mission Control could not reach the create-pull-request API. Restart the app after updating, or open GitHub and create the pull request manually.",
      };
    }

    if (serverMessage.includes("Ship") || serverMessage.includes("Review Changes")) {
      return {
        title: "Commit before opening a pull request",
        message: serverMessage,
      };
    }

    const classified = classifyGhGitPrError(serverMessage, stderr);
    if (classified) return classified;

    const detail = stderr && stderr !== serverMessage ? `\n\n${stderr}` : "";
    return {
      title: "Could not create pull request",
      message: `${serverMessage}${detail}`.trim(),
    };
  }

  if (error instanceof Error && error.message.trim()) {
    return { title: "Could not create pull request", message: error.message };
  }

  return {
    title: "Could not create pull request",
    message:
      "Something went wrong. Commit and push your branch with Ship, then try again.",
  };
}

function classifyGhGitPrError(
  message: string,
  stderr: string,
): CreatePullRequestErrorView | null {
  const text = `${message}\n${stderr}`.toLowerCase();

  if (/no commits between/.test(text)) {
    return {
      title: "Nothing to merge yet",
      message:
        "This branch has no commits ahead of the base branch. Use Review Changes to accept your edits, then Ship to commit and push before opening a pull request.",
    };
  }

  if (
    /branch.*not found/.test(text) ||
    /could not resolve/.test(text) ||
    /invalid head/.test(text) ||
    /head ref must be a branch/.test(text)
  ) {
    return {
      title: "Push your branch first",
      message:
        "Your branch is not on GitHub yet (or GitHub cannot see it). Use Ship to commit and push, then try creating the pull request again.",
    };
  }

  if (/no upstream branch/.test(text) || /set upstream/.test(text) || /set-upstream/.test(text)) {
    return {
      title: "Push your branch first",
      message:
        "This branch has not been pushed to origin yet. Use Ship to commit and push, then try again.",
    };
  }

  if (/git push failed/.test(text)) {
    return {
      title: "Push failed",
      message: stderr.trim() || message,
    };
  }

  if (/authentication failed/.test(text) || /permission denied/.test(text) || /401/.test(text)) {
    return {
      title: "GitHub authentication required",
      message: stderr.trim() || message,
    };
  }

  return null;
}
