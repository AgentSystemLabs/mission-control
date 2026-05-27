/** Normalize a GitHub repo URL to https://github.com/owner/repo (no .git). */
export function normalizeGithubRepoUrl(githubUrl: string): string {
  return githubUrl.trim().replace(/\/$/, "").replace(/\.git$/, "");
}

/** Build a GitHub compare URL that opens the "Open a pull request" form. */
export function buildGithubCompareUrl(
  githubUrl: string,
  baseBranch: string,
  headBranch: string,
): string {
  const repo = normalizeGithubRepoUrl(githubUrl);
  const base = encodeURIComponent(baseBranch.trim());
  const head = encodeURIComponent(headBranch.trim());
  return `${repo}/compare/${base}...${head}?expand=1`;
}
