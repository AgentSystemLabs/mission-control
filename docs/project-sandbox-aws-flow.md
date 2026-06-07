# Project Sandbox AWS Flow — Summary

Work done to fix the **Create sandbox** flow on project pages: it was incorrectly provisioning Docker sandboxes, leaving the modal open during long deploys, and treating sandboxes as separate project scopes instead of project-owned runtimes.

## Problems

### 1. Docker instead of AWS

`createProjectSandbox` called `api.createSandbox({ kind: "local-docker" })` and then `electron.sandbox.up()`, which runs `docker compose up`. That caused errors like:

> docker compose up failed (exit 1). See logs.

Project sandboxes should use the same **AWS EC2 remote VM** path as the rest of the desktop app.

### 2. Modal stayed open during deploy

The create dialog only closed in `onSuccess`, which ran after the full pipeline finished (deploy → connect → clone → setup terminal). AWS deploy alone can take several minutes, so the modal appeared stuck on "Creating…".

### 3. Sandbox modeled as its own project scope

The earlier project-sandbox flow created a second project row with `sandboxId`, then relied on filtering project lists by the active sandbox scope. That made each sandbox look like it owned a separate set of projects.

The intended model is different:

- The original project remains the project.
- A project sandbox is linked to the project that created it with `projectId`.
- Switching Local/sandbox changes the active runtime for that project, not the project list.

## Solution

### AWS deploy instead of Docker

**File:** `src/lib/project-sandbox-create.ts`

- Start deploy via `electron.remoteVm.startDeploy({ provider: "aws", ... })`
- Wait for the deploy job with `waitForRemoteVmDeployJob` (`src/lib/remote-vm-deploy.ts`)
- Connect with `waitForSandboxConnected` (remote agent, not Docker)
- Defaults: `us-east-1`, `t3.medium`, SSH keys copied, 30 min idle timeout
- **Boot command** → AWS `setupScript` (runs on VM during provisioning)
- **Init command** → setup terminal after clone (git checkout + `npm i`, etc.)

### Optimistic UI — close modal immediately

**Files:** `src/lib/project-sandbox-create.ts`, `src/lib/use-project-sandbox-flow.tsx`

- Added `onStarted` callback, fired after optimistic cache updates and deploy job start
- Modal closes immediately; progress continues via toasts
- Validation errors before deploy still show in the modal

### Dropdown visibility

**Files:** multiple (see below)

1. **`projectId`** — The owning project id is stamped on the sandbox at create time (optimistic cache + persisted in remote config via deploy CLI).
2. **`scopedSandboxesForProject`** — Includes only sandboxes whose `projectId` matches the current project.
3. **No project copy** — The flow no longer calls `api.createProject({ sandboxId })`; setup terminals attach to the original project with the sandbox runtime selected.
4. **`mergeServerSandboxesPreservingPending`** — Preserves client `activeScopeId` when the selected sandbox is already on the server (not only while deploy is "pending").
5. **Smarter rollback** — If deploy succeeded but later steps fail, the sandbox stays in cache/DB instead of being fully rolled back.

**Scope dropdown:** Shows **Provisioning…** subtitle for sandboxes with `remoteStatus === "provisioning"`.

## Files changed

| File | Change |
|------|--------|
| `src/lib/project-sandbox-create.ts` | AWS deploy flow, optimistic updates, project-owned sandbox link, rollback logic |
| `src/lib/use-project-sandbox-flow.tsx` | Close modal on `onStarted` |
| `src/lib/remote-vm-deploy.ts` | `waitForRemoteVmDeployJob` helper |
| `src/lib/project-scoped-sandboxes.ts` | Filter by sandbox `projectId` |
| `src/lib/optimistic-sandbox.ts` | `projectId` on optimistic rows; preserve active scope on server merge |
| `src/shared/sandbox.ts` | `projectId` on sandbox types |
| `src/server/services/sandboxes.ts` | Expose `projectId` from remote config |
| `src/components/views/ScopeDropdown.tsx` | Provisioning subtitle |
| `electron/main.ts` | `--project-id` deploy arg |
| `electron/preload.ts` | Type for `projectId` |
| `src/shared/electron-contract.ts` | Type for `projectId` |
| `scripts/remote-vm.mjs` | Persist `projectId` in remote config |
| Tests | `project-scoped-sandboxes.test.ts`, `optimistic-sandbox.test.ts` |

## Expected behavior (after fix)

1. User clicks **Create sandbox** on a project page.
2. Modal closes quickly after validation.
3. New sandbox appears in the header scope dropdown with **Provisioning…**.
4. Toasts report deploy → connect → clone → ready.
5. User stays on the original project with the sandbox selected as the active runtime.

## Note on sandboxes created before this fix

Sandboxes provisioned before the `projectId` link may have no owning project. They can exist in AWS/SQLite but still not appear in a project dropdown. Those may need to be torn down and recreated, or manually linked in a follow-up repair flow.
