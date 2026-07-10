# Mission Control release pipeline

How desktop releases are built, published, and verified for this repo.

## Version sources (must stay aligned)

| Source | Used for |
|--------|----------|
| `package.json` `version` | electron-builder artifact names, `Info.plist` / `CFBundleShortVersionString`, Vite `__MC_VERSION__` baked into the app |
| Git tag `vX.Y.Z` | GitHub Actions `RELEASE_VERSION`, academy API release row, auto-update metadata |
| Academy API finalized `releases[].version` | In-app update check (`isNewerSemver` vs installed `CURRENT_MC_VERSION`) |

**Critical:** `package.json` version and the git tag (without `v`) must be identical **before** you push the tag. If they diverge, users get a permanent “update available” loop: the API advertises `v0.47.1` while installed binaries report `0.47.0`.

### What went wrong in v0.47.1

- Tag `v0.47.1` was pushed while `package.json` still said `0.47.0`.
- CI registered the release as `v0.47.1` on academy but built `MissionControl-0.47.0-*.dmg` with bundle version `0.47.0`.
- Fixed in `v0.47.2` by bumping `package.json` first, then tagging.

## Happy path (automated)

```
merge to main (feature commits)
  → ci.yml green on that push
  → auto-tag-release.yml patch-bumps package.json, commits chore(release): vX.Y.Z, pushes annotated tag
  → release.yml (triggered by tag)
      → prepare + per-platform publish → academy draft/versioned assets
      → finalize-academy (compose latest-mac.yml + finalize) → Draft clears, Approve unlocks
      → attach installers to GitHub Release (manual download)
  → you Approve on agentsystem.dev
      → activate auto-update feed / public downloads
      → Electron updater / in-app Update UI advance
```

Admin UI **Waiting** = draft (`finalizedAt` null). CI finalize flips that to **Awaiting approval**; Approve is a separate human step.

Skip automation for a main push: include `[skip release]` in the merge commit message.

Manual major/minor (or hotfix without waiting for a merge): use the `/release` skill — it still bumps, tags, and relies on the same `release.yml` + academy approval gate.

## GitHub Actions

### `auto-tag-release.yml`

Triggered on `push` to `main` (skips `chore(release): v*` and `[skip release]`).

| Step | Purpose |
|------|---------|
| Wait for Hosted CI | Same gate as release — `scripts/wait-for-hosted-ci.mjs` |
| Patch bump | `npm version patch --no-git-tag-version` |
| Commit + annotated tag | `chore(release): vX.Y.Z` then `git tag -a` |
| Push + dispatch | Commit to `main`, push tag, then `gh workflow run release.yml -f tag=vX.Y.Z` |

**Why dispatch:** pushes authenticated with `GITHUB_TOKEN` do not trigger other workflows (GitHub recursion guard). Auto-tag therefore starts `release.yml` via `workflow_dispatch` after pushing the tag.

Permissions: `contents: write`, `actions: write`. Branch protection must allow `github-actions[bot]` to push release commits (or use a fine-grained PAT in the workflow).

### `release.yml`

Triggered on `push: tags: v*` (manual tags / `--follow-tags`) or `workflow_dispatch` with an existing tag (auto-tag path).

| Job | Purpose |
|-----|---------|
| `resolve` | Resolve tag ref + read annotated tag body as release notes |
| `release-gate` | Wait for `ci.yml` on the tagged commit, or its parent when the tip is `chore(release): v*` (bot bump has no CI run) |
| `prepare` | `scripts/publish-release.mjs prepare` — create-or-get academy release row (draft) |
| `build` (matrix) | mac-arm64, mac-x64, win-x64, linux-x64 — electron-builder + academy `publish` |
| `finalize-academy` | Compose `latest-mac.yml`, publish it, then `finalize` — unlocks Approve (only if all matrix legs succeeded) |
| `publish-github` | Attach `.dmg` / `.exe` / `.AppImage` to the GitHub Release (`GH_REPO` set; no checkout) |

**Not done by CI:** agentsystem.dev **Approve**. That alone advances public downloads / Electron auto-update feeds.

Secrets required in GitHub: `MISSION_CONTROL_RELEASE_TOKEN`, `ACADEMY_BASE_URL`, mac signing (`MAC_CERTS`, `APPLE_*`).

Re-run a single failed matrix job from Actions UI; asset upsert is idempotent per platform.

### `ci.yml` packaging

`package-linux` (unsigned AppImage artifact) runs on **pull_request** only — for PR smoke downloads. Main releases come from `release.yml`.

## Local / manual `/release` commands

Still valid for major/minor or when automation is skipped:

```bash
# Preflight
git status --porcelain          # must be empty before version bump
git rev-parse --abbrev-ref HEAD # should be main
git describe --tags --abbrev=0  # last tag

# Bump (pnpm project)
pnpm version 0.49.0 --no-git-tag-version

# Verify alignment BEFORE tagging
node -e "const v=require('./package.json').version; console.log('package.json:', v)"
# NEXT: tag must be v${version}

# Commit + annotated tag
git add package.json
git commit -m "chore(release): v0.49.0"
git tag -a v0.49.0 -m "## v0.49.0\n\n- ..."

# Publish (triggers release.yml)
git push --follow-tags
```

## Post-release verification

After `finalize-academy` + `publish-github` succeed:

```bash
# 1. GitHub Release has installers (manual download)
gh release view vX.Y.Z --json assets --jq '.assets[].name'

# 2. Public list still shows the previous *approved* version until you Approve
#    (admin UI should show Awaiting approval, not Draft/Waiting)
curl -sS -H 'Accept: application/json' \
  'https://agentsystem.dev/api/mission-control/releases?limit=1' \
  | jq '.releases[0].version'
```

After **Approving on agentsystem.dev**:

```bash
# Latest finalized+approved matches the new tag
curl -sS -H 'Accept: application/json' \
  'https://agentsystem.dev/api/mission-control/releases?limit=1' \
  | jq '.releases[0].version'

# Asset filenames include the new version
curl -sS -H 'Accept: application/json' \
  'https://agentsystem.dev/api/mission-control/releases?limit=1' \
  | jq '.releases[0].assets[].fileName'

# Installed app matches (after downloading DMG)
/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' \
  '/Applications/MissionControl.app/Contents/Info.plist'
```

Installed version in **Settings → About** comes from `__MC_VERSION__` (build-time `package.json`). It must equal the academy `latestVersion` when up to date.

## In-app update behavior

- **Academy check:** `src/queries/mission-control-version.ts` fetches `/api/mission-control/releases?limit=1`, compares semver to `CURRENT_MC_VERSION`. Only **finalized/approved** releases appear.
- **Electron auto-updater:** `package.json` `publish.url` points at `https://agentsystem.dev/downloads/mission-control/auto-update` (mac `latest-mac.yml` activated on academy approval).
- Update button shows when `isNewerSemver(remote, installed)` is true.
- **GitHub Releases** never advance the updater — they are for manual install only.

## When a tag already exists with wrong metadata

Do **not** force-move an existing remote tag. Instead:

1. Bump `package.json` to the next patch (e.g. `0.47.1` broken → ship `0.47.2`).
2. Commit, tag, push (or merge another change to main and let auto-tag run).
3. Let CI publish corrected artifacts; approve on academy when ready.

Deleting/re-tagging `v0.47.1` on a shared remote breaks anyone who already pulled it and poisons academy caches.

## Manual re-publish

`workflow_dispatch` on `release.yml` with `tag: vX.Y.Z` re-runs build/publish for an **existing** tag (e.g. failed matrix job). Does not change `package.json`; only use when the tag already points at a commit with the correct version.
