import { describe, expect, it } from "vitest";
import { buildGithubCompareUrl, normalizeGithubRepoUrl } from "../github-pr";

describe("normalizeGithubRepoUrl", () => {
  it("strips .git suffix and trailing slash", () => {
    expect(normalizeGithubRepoUrl("https://github.com/acme/widget.git/")).toBe(
      "https://github.com/acme/widget",
    );
  });
});

describe("buildGithubCompareUrl", () => {
  it("builds a compare URL with expand=1", () => {
    expect(buildGithubCompareUrl("https://github.com/acme/widget.git", "main", "feature/foo")).toBe(
      "https://github.com/acme/widget/compare/main...feature%2Ffoo?expand=1",
    );
  });
});
