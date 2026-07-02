---
name: release
description: Cut a Mission Control desktop release — bump package.json (must match the git tag), commit, create an annotated v-tag, push to trigger release.yml CI, and verify academy artifacts align with bundle version. Use when the user says "cut a release", "release mission control", "tag a release", "bump version", "publish a new version", or "/release". Accepts bump type major|minor|patch (default patch for hotfixes). Read references/mission-control-release.md for the full CI pipeline, version alignment rules, and post-release checks.
---

# Mission Control release

Phased workflow for this Electron desktop app. **Read [`references/mission-control-release.md`](references/mission-control-release.md)** for CI jobs, academy publishing, and the v0.47.1 version-mismatch incident.

**Bump type from args:** `major` | `minor` | `patch`. Default **`patch`** for this repo (desktop app ships frequently).

**Quality mode:** `mode=fast|balanced|production`. Default `production` when cutting a public release.

---

## Mission Control rules (non-negotiable)

1. **Bump `package.json` before creating the git tag.** The tag version (without `v`) and `package.json` `version` must be identical on the commit you tag.
2. **Use `pnpm version X.Y.Z --no-git-tag-version`** — never `git tag` first and bump later.
3. **Never reuse or force-move a remote tag.** If a bad tag shipped, bump to the next patch and release again.
4. **Pushing the tag triggers `release.yml`** — CI builds electron-builder artifacts and publishes to agentsystem.dev. There is no separate manual upload step on the happy path.
5. **Verify after CI:** academy `latestVersion`, artifact filenames, and `CFBundleShortVersionString` must all match.

### Version alignment check (run before tagging)

```bash
PKG=$(node -p "require('./package.json').version")
echo "package.json: $PKG — tag will be v$PKG"
git rev-parse "v$PKG" 2>/dev/null && echo "ERROR: tag v$PKG already exists" && exit 1
```

---

## Phase 1 — Preflight

Exit condition: clean tree on `main`, last tag known.

```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
git describe --tags --abbrev=0 2>/dev/null || echo "NO_PRIOR_TAG"
git remote -v
node -p "require('./package.json').version"
```

- Dirty tree → STOP.
- Not on `main` → confirm with user.
- Manifest: `package.json` only (not `publish/package.json`).

---

## Phase 1.5 — Quality gate

Release range: `<last-tag>..HEAD` (or full history if no tag).

- `mode=production` → run typecheck + lint + tests (`pnpm typecheck`, `pnpm lint`, `pnpm test`) on changed scope.
- `mode=fast` → residue sweep on release-range diff.

Stop on failure unless user explicitly bypasses (record `Bypassed-gates:` in tag body).

---

## Phase 2 — Compute next version

From current `package.json` version, apply semver bump. Verify tag does not exist:

```bash
git rev-parse v$NEXT_VERSION 2>/dev/null && echo "TAG_EXISTS — pick next patch or delete stale tag deliberately"
```

---

## Phase 3 — Write manifest

```bash
pnpm version $NEXT_VERSION --no-git-tag-version
```

Show diff. Only `package.json` should change (no lockfile version field in pnpm for the root package).

---

## Phase 4 — Release notes

Range: `LAST_TAG..HEAD` (exclude the upcoming `chore(release)` commit if notes are generated before bump).

Use conventional-commit grouping when ≥50% of subjects match `feat:` / `fix:` / `chore:` etc.

Example annotation:

```
## v0.48.0 (2026-07-02)

### Features
- feat: add foo (abc1234)

### Fixes
- fix: bar (def5678)
```

---

## Phase 5 — Commit, tag, push

```bash
git add package.json
git commit -m "chore(release): v$NEXT_VERSION"
git tag -a "v$NEXT_VERSION" -m "<release notes>"
git push --follow-tags
```

When the user explicitly requests push in the same turn, push immediately after local tag creation.

Monitor: GitHub Actions → `Release` workflow for the new tag. Wait for `finalize` to succeed, then run post-release checks from [`references/mission-control-release.md`](references/mission-control-release.md).

---

## NEVER

- **NEVER tag before bumping `package.json`** — causes permanent in-app update loops (see v0.47.1).
- **NEVER push a tag whose commit still has the old `package.json` version.**
- **NEVER force-push or delete a published tag** without explicit user request and understanding of academy/CI impact.
- **NEVER use lightweight tags** — always `git tag -a`.
- **NEVER release from a dirty working tree.**
- **NEVER skip post-release verification** — confirm API version, artifact names, and bundle version match.
