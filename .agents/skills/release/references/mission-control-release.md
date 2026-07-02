# Mission Control release pipeline

How desktop releases are built, published, and verified for this repo.

## Version sources (must stay aligned)

| Source | Used for |
|--------|----------|
| `package.json` `version` | electron-builder artifact names, `Info.plist` / `CFBundleShortVersionString`, Vite `__MC_VERSION__` baked into the app |
| Git tag `vX.Y.Z` | GitHub Actions `RELEASE_VERSION`, academy API release row, auto-update metadata |
| Academy API `releases[].version` | In-app update check (`isNewerSemver` vs installed `CURRENT_MC_VERSION`) |

**Critical:** `package.json` version and the git tag (without `v`) must be identical **before** you push the tag. If they diverge, users get a permanent “update available” loop: the API advertises `v0.47.1` while installed binaries report `0.47.0`.

### What went wrong in v0.47.1

- Tag `v0.47.1` was pushed while `package.json` still said `0.47.0`.
- CI registered the release as `v0.47.1` on academy but built `MissionControl-0.47.0-*.dmg` with bundle version `0.47.0`.
- Fixed in `v0.47.2` by bumping `package.json` first, then tagging.

## Release flow (happy path)

```
main (feature commits merged)
  → bump package.json (pnpm version X.Y.Z --no-git-tag-version)
  → commit: chore(release): vX.Y.Z
  → annotated tag: git tag -a vX.Y.Z -m "<notes>"
  → push: git push --follow-tags
  → GitHub Actions release.yml (triggered by tag push)
  → academy hosts DMG/EXE/AppImage + mac auto-update manifest
```

## GitHub Actions (`release.yml`)

Triggered on `push: tags: v*` or manual `workflow_dispatch` with an existing tag.

| Job | Purpose |
|-----|---------|
| `resolve` | Resolve tag ref + read annotated tag body as release notes |
| `release-gate` | Wait for `ci.yml` to pass on the tagged commit on `main` |
| `prepare` | `scripts/publish-release.mjs prepare` — create-or-get academy release row |
| `build` (matrix) | mac-arm64, mac-x64, win-x64, linux-x64 — electron-builder + upload |
| `finalize` | Compose `latest-mac.yml`, verify all platforms, mark release finalized |

Secrets required in GitHub: `MISSION_CONTROL_RELEASE_TOKEN`, `ACADEMY_BASE_URL`, mac signing (`MAC_CERTS`, `APPLE_*`).

Re-run a single failed matrix job from Actions UI; asset upsert is idempotent per platform.

## Local commands

```bash
# Preflight
git status --porcelain          # must be empty before version bump
git rev-parse --abbrev-ref HEAD # should be main
git describe --tags --abbrev=0  # last tag

# Bump (pnpm project)
pnpm version 0.48.0 --no-git-tag-version

# Verify alignment BEFORE tagging
node -e "const v=require('./package.json').version; console.log('package.json:', v)"
# NEXT: tag must be v${version}

# Commit + annotated tag
git add package.json
git commit -m "chore(release): v0.48.0"
git tag -a v0.48.0 -m "## v0.48.0\n\n- ..."

# Publish (triggers CI)
git push --follow-tags
```

## Post-release verification

After CI `finalize` succeeds:

```bash
# 1. Academy API latest matches tag
curl -sS -H 'Accept: application/json' \
  'https://agentsystem.dev/api/mission-control/releases?limit=1' \
  | jq '.releases[0].version'

# 2. Asset filenames include the new version (not an older one)
curl -sS -H 'Accept: application/json' \
  'https://agentsystem.dev/api/mission-control/releases?limit=1' \
  | jq '.releases[0].assets[].fileName'

# 3. Installed app matches (after downloading DMG)
/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' \
  '/Applications/MissionControl.app/Contents/Info.plist'
```

Installed version in **Settings → About** comes from `__MC_VERSION__` (build-time `package.json`). It must equal the academy `latestVersion` when up to date.

## In-app update behavior

- **Academy check:** `src/queries/mission-control-version.ts` fetches `/api/mission-control/releases?limit=1`, compares semver to `CURRENT_MC_VERSION`.
- **Electron auto-updater:** `app-update.yml` points at `https://agentsystem.dev/downloads/mission-control/auto-update` (mac `latest-mac.yml` composed at finalize).
- Update button shows when `isNewerSemver(remote, installed)` is true.

## When a tag already exists with wrong metadata

Do **not** force-move an existing remote tag. Instead:

1. Bump `package.json` to the next patch (e.g. `0.47.1` broken → ship `0.47.2`).
2. Commit, tag, push.
3. Let CI publish corrected artifacts.

Deleting/re-tagging `v0.47.1` on a shared remote breaks anyone who already pulled it and poisons academy caches.

## Manual re-publish

`workflow_dispatch` on `release.yml` with `tag: vX.Y.Z` re-runs build/publish for an **existing** tag (e.g. failed matrix job). Does not change `package.json`; only use when the tag already points at a commit with the correct version.
