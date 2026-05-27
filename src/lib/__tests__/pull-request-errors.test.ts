import { describe, expect, it } from "vitest";
import { ApiError } from "~/lib/api";
import { formatCreatePullRequestError } from "../pull-request-errors";

describe("formatCreatePullRequestError", () => {
  it("explains a missing API route instead of showing bare not found", () => {
    const error = new ApiError("not found", 404, { error: "not found" });
    expect(formatCreatePullRequestError(error)).toEqual({
      title: "Create pull request unavailable",
      message: expect.stringContaining("create-pull-request API"),
    });
  });

  it("surfaces server guidance about shipping first", () => {
    const error = new ApiError(
      'Branch "feature/x" has no commits ahead of main yet. Accept your changes in Review Changes, then use Ship to commit and push before opening a pull request.',
      400,
      {
        error:
          'Branch "feature/x" has no commits ahead of main yet. Accept your changes in Review Changes, then use Ship to commit and push before opening a pull request.',
      },
    );
    expect(formatCreatePullRequestError(error)).toEqual({
      title: "Commit before opening a pull request",
      message: error.message,
    });
  });

  it("maps gh no-commits-between errors to a push-first message", () => {
    const error = new ApiError("gh pr create failed", 400, {
      error: "gh pr create failed",
      stderr: "pull request create failed: No commits between main and feature/x",
    });
    expect(formatCreatePullRequestError(error)).toEqual({
      title: "Nothing to merge yet",
      message: expect.stringContaining("Ship"),
    });
  });

  it("maps missing remote branch errors to a push-first message", () => {
    const error = new ApiError("gh pr create failed", 400, {
      error: "gh pr create failed",
      stderr: "remote branch not found on origin",
    });
    expect(formatCreatePullRequestError(error)).toEqual({
      title: "Push your branch first",
      message: expect.stringContaining("Ship"),
    });
  });
});
