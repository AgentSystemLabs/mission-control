# Apply workflow changes for #43

The AgentSystemSwarm GitHub App cannot push `.github/workflows/*` until the
org installation accepts **Workflows: Read and write**.

Until then, apply these files from a token/user that has that permission:

```bash
cp .agents/patches/43-workflows/ci.yml .github/workflows/ci.yml
cp .agents/patches/43-workflows/release.yml .github/workflows/release.yml
git add .github/workflows/ci.yml .github/workflows/release.yml README.md
git commit -m "feat(ci): upload Linux AppImage artifacts and attach release installers"
```

Or apply the unified diffs:

```bash
git apply .agents/patches/43-ci.yml.diff .agents/patches/43-release.yml.diff
```

After the App installation accepts `workflows`, re-run the agent command and
it can push `feat/ci-build-artifacts-43` directly (commit already prepared locally).
