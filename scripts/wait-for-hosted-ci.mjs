#!/usr/bin/env node
// Poll until ci.yml completes successfully for a given main-branch push SHA.
// Used by release.yml (release-gate) and auto-tag-release.yml.
//
// Env:
//   GITHUB_TOKEN          required
//   GITHUB_REPOSITORY     owner/repo
//   RELEASE_SHA           commit SHA that should have a green Hosted CI push run
//   FALLBACK_SHA          optional — if no CI run ever appears for RELEASE_SHA
//                         (common for bot chore(release) commits pushed with
//                         GITHUB_TOKEN, which do not re-trigger workflows),
//                         wait for this SHA instead after FALLBACK_AFTER_ATTEMPTS
//   FALLBACK_AFTER_ATTEMPTS  default 3
//   CI_GATE_MAX_ATTEMPTS  default 120
//   CI_GATE_POLL_SECONDS  default 30

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const releaseSha = process.env.RELEASE_SHA;
const fallbackSha = process.env.FALLBACK_SHA || "";
const workflowFile = process.env.CI_WORKFLOW_FILE || "ci.yml";
const maxAttempts = Number(process.env.CI_GATE_MAX_ATTEMPTS || "120");
const pollSeconds = Number(process.env.CI_GATE_POLL_SECONDS || "30");
const fallbackAfterAttempts = Number(process.env.FALLBACK_AFTER_ATTEMPTS || "3");

if (!token) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}
if (!repository) {
  console.error("GITHUB_REPOSITORY is required");
  process.exit(1);
}
if (!releaseSha) {
  console.error("RELEASE_SHA is required");
  process.exit(1);
}

const [owner, repo] = repository.split("/");

async function main() {
  let activeSha = releaseSha;
  let switchedToFallback = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (
      !switchedToFallback &&
      fallbackSha &&
      fallbackSha !== releaseSha &&
      attempt > fallbackAfterAttempts
    ) {
      const primaryRun = await findHostedCiRun(releaseSha);
      if (!primaryRun) {
        console.log(
          `No Hosted CI run for ${releaseSha} after ${fallbackAfterAttempts} attempts; falling back to ${fallbackSha}.`,
        );
        activeSha = fallbackSha;
        switchedToFallback = true;
      }
    }

    const run = await findHostedCiRun(activeSha);
    if (!run) {
      await waitForNextAttempt(
        `No Hosted CI push run on main found yet for ${activeSha}`,
        attempt,
      );
      continue;
    }

    const conclusion = run.conclusion ?? "pending";
    console.log(
      `Hosted CI run ${run.html_url} is ${run.status}/${conclusion} for ${activeSha}.`,
    );

    if (run.status === "completed") {
      if (run.conclusion === "success") {
        console.log("Hosted CI passed.");
        return;
      }

      throw new Error(
        `Hosted CI must pass before continuing. Run ${run.html_url} completed with conclusion ${run.conclusion}.`,
      );
    }

    await waitForNextAttempt("Hosted CI is still running", attempt);
  }

  throw new Error(
    `Timed out waiting for Hosted CI to pass for ${activeSha} after ${maxAttempts} attempts.`,
  );
}

async function findHostedCiRun(sha) {
  const params = new URLSearchParams({
    branch: "main",
    event: "push",
    head_sha: sha,
    per_page: "10",
  });
  const path = `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
    workflowFile,
  )}/runs?${params}`;
  const data = await githubApi(path);
  const runs = data.workflow_runs ?? [];
  return runs.find(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === "main" &&
      run.event === "push",
  );
}

async function waitForNextAttempt(reason, attempt) {
  if (attempt >= maxAttempts) {
    return;
  }
  console.log(
    `${reason}; checking again in ${pollSeconds}s (${attempt}/${maxAttempts}).`,
  );
  await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
}

async function githubApi(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "mission-control-wait-for-hosted-ci",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed (${response.status} ${response.statusText}): ${body}`,
    );
  }

  return response.json();
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
