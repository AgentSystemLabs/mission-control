# Worktree Implementation Plan

Status: implemented through focused automated checks; manual QA remains.

## Product Requirements

- [x] Add one icon-only "create worktree" button immediately to the right of the project run/play button in the top project header.
- [x] Create every worktree under the selected project's `.worktree/` directory.
- [x] Generate worktree names in three lowercase token parts, for example `solar-river-fox`.
- [x] Show a persistent toggle for `main` plus one toggle per created worktree in the top header.
- [x] Let the user switch between `main` and any worktree from those toggle buttons.
- [x] Scope agent sessions, user terminals, git status, git diff, ship/commit/push, file commands, and launch/run commands to the currently selected worktree.
- [x] Keep sessions separated by project and worktree, so `main`, `alpha-beta-gamma`, and `delta-echo-foxtrot` can each have their own visible and hidden sessions.
- [x] Show a running dot above each worktree toggle when that worktree has an active run/launch process.
- [x] Prevent starting a run/launch process in a second worktree while another worktree is already running.
- [x] When another worktree is running, require the user to switch to that worktree and stop it before starting the selected one.
- [x] Always keep the `main` toggle available so users can return to the primary project directory.
- [x] When a non-main worktree is selected, show a delete worktree button to the right of the search button.
- [x] Require confirmation before deleting a worktree.
- [x] Delete the selected worktree directory after confirmation.
- [x] Add a project-level setup command that runs the first time each new worktree is created, such as `pnpm i`.
- [x] Ensure the existing run/play command starts in the selected worktree directory, not always the main project directory.

## Working Decisions

- [x] Treat `main` as a built-in worktree scope with key `main` and path `project.path`.
- [x] Treat created worktrees as project children, not standalone projects, so the sidebar/project list remains unchanged.
- [x] Use `.worktree/<name>` as the on-disk path relative to the project root.
- [x] Create each worktree from the current main worktree `HEAD` with a matching branch name unless the implementation finds an existing branch conflict.
- [x] Leave the branch behind when deleting a worktree unless a later UX explicitly asks to prune branches; deleting a directory should not silently delete git history.
- [x] Define "running worktree" as a worktree with an active project launch/setup terminal. Agent sessions remain scoped but should not block switching worktrees.
- [x] Run the setup command in a visible user terminal scoped to the new worktree so failures and install output are visible.

## Phase 1: Data Model

- [x] Add a `worktrees` table with `id`, `projectId`, `name`, `path`, `branch`, `createdAt`, and `updatedAt`.
- [x] Add a unique index on `(projectId, name)`.
- [x] Add a `worktreeId` nullable column to `tasks`.
- [x] Add a `worktreeId` nullable column to `user_terminals`.
- [x] Add indexes for `tasks(projectId, worktreeId)` and `user_terminals(projectId, worktreeId)`.
- [x] Interpret `null` or `main` worktree IDs as the main project worktree during migration and reads.
- [x] Add a project-level `worktreeSetupCommand` nullable column, or store it in existing app/project settings if a project settings migration is preferred.
- [x] Update Drizzle schema types in `src/db/schema.ts`.
- [x] Add/update database migrations and test fixtures for the new fields.

## Phase 2: Server Worktree Service

- [x] Create `src/server/services/worktrees.ts`.
- [x] Implement `listWorktrees(projectId)` and always include synthetic `main`.
- [x] Implement `createWorktree(projectId)` using a random three-token name.
- [x] Validate generated names with a strict slug regex, for example `/^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/`.
- [x] Ensure `.worktree/` exists inside the project root before creation.
- [x] Resolve the final worktree path with `path.resolve(project.path, ".worktree", name)`.
- [x] Reject any resolved path that escapes the project root.
- [x] Run `git worktree add` with a timeout and clear stderr reporting.
- [x] Insert the worktree row only after `git worktree add` succeeds.
- [x] If the setup command is configured, return it in the create response so the client can start a scoped setup terminal.
- [x] Implement `deleteWorktree(projectId, worktreeId)` with path validation.
- [x] Refuse deletion of `main`.
- [x] Refuse deletion while the worktree has an active launch/setup terminal.
- [x] Before deletion, check `git status --porcelain` in the worktree and either refuse dirty worktrees or require an explicit `force` flag from the confirmation dialog.
- [x] Delete via `git worktree remove <path>` first.
- [x] After successful git removal, remove leftover directory contents with `fs.rm(path, { recursive: true, force: true })`.
- [x] Emit `worktree:created`, `worktree:deleted`, and `project:updated` events.

## Phase 3: API Contracts

- [x] Add controller file `src/server/controllers/worktrees.controller.ts`.
- [x] Add routes in `src/server/api-router.ts`:
  - [x] `GET /api/projects/:id/worktrees`
  - [x] `POST /api/projects/:id/worktrees`
  - [x] `DELETE /api/projects/:id/worktrees/:worktreeId`
- [x] Add auth coverage for the new routes in `api-router.ts`.
- [x] Add client API methods in `src/lib/api.ts`.
- [x] Add `worktreeId` to `createTaskInternal` request/response handling.
- [x] Add `worktreeId` to `createUserTerminal` request/response handling.
- [x] Add a shared `Worktree` type under `src/shared/` if the DB type is not enough for client contracts.
- [x] Add query hooks and keys for worktree list/create/delete.

## Phase 4: CWD Resolution

- [x] Create a shared server helper that resolves `{ projectId, worktreeId }` into an effective cwd.
- [x] Return `project.path` for `main`.
- [x] Return the stored `.worktree/<name>` path for created worktrees.
- [x] Validate that every resolved worktree path exists before running commands.
- [x] Update `src/server/services/git.ts` so status, diff, stage, unstage, commit, push, and file delete use the selected worktree cwd.
- [x] Update git API endpoints to accept `worktreeId`, preferably as a query/body value instead of overloading project IDs.
- [x] Update `src/queries/git.ts` query keys to include `worktreeId`.
- [x] Update `CommitPushButton` to accept `worktreeId` and key in-flight ship operations by `projectId:worktreeId`.
- [x] Update `GitDiffView` and changed-file actions to pass the selected worktree.
- [x] Audit other command/file surfaces for project path assumptions and thread the selected cwd through them.

## Phase 5: Client Worktree State

- [x] Add a `WorktreeProvider` or project-page local state that tracks selected worktree per project.
- [x] Persist selected worktree per project in local storage.
- [x] Default to `main` when a project has no selected worktree or the stored selected worktree was deleted.
- [x] Expose `selectedWorktree`, `selectedWorktreeId`, and `selectedWorktreePath`.
- [x] Make `main` and created worktrees available to header components.
- [x] Invalidate git, task, terminal, and project queries when the selected worktree changes.

## Phase 6: Scoped Sessions

- [x] Update task repository reads to support `listTasksForProject(projectId, worktreeId)`.
- [x] Update task creation to store `worktreeId`.
- [x] Update task events to include `worktreeId` where useful.
- [x] Update `useTasks(projectId)` or add `useTasks(projectId, worktreeId)`.
- [x] Update `TerminalProvider` session keys from `projectId` to `projectId:worktreeId`.
- [x] Store active task IDs by `projectId:worktreeId`.
- [x] Set `OpenTerminal.cwd` to the selected worktree path.
- [x] Ensure rehydration only materializes tasks for the selected worktree.
- [x] Update status counts so project-wide counts remain useful while the page task list is worktree-scoped.
- [x] Decide whether the project sidebar running badge is aggregated across all worktrees or only main; prefer aggregated.

## Phase 7: Scoped User Terminals And Run Command

- [x] Update user terminal repository reads to support `listUserTerminals(projectId, worktreeId)`.
- [x] Store `worktreeId` on user terminals.
- [x] Update `UserTerminalProvider` buckets from `projectId` to `projectId:worktreeId`.
- [x] Update `createTerminal` to send the selected `worktreeId` and selected cwd.
- [x] Update `UserTerminalPane` props only if it needs extra labels; cwd should already come from terminal/session state.
- [x] Update project launch command execution in `src/routes/projects.$id.tsx` so `runLaunch` uses the selected worktree.
- [x] Update launch stop logic to stop only launch terminals in the selected worktree.
- [x] Track launch/setup running state by `projectId:worktreeId`.
- [x] Enforce the "only one running worktree" rule before `runLaunch` creates terminals.
- [x] If another worktree is running, show a toast or inline notice naming that worktree and do not start the selected one.
- [x] Put the setup command terminal in the new worktree after creation.

## Phase 8: Header UI

- [x] Locate the top project header action row in `src/routes/projects.$id.tsx`.
- [x] Add the create worktree icon button immediately to the right of `ProjectRunButton`.
- [x] Use an existing icon if possible, such as `git-branch`, `copy`, or a new small worktree icon in `src/components/ui/Icon.tsx`.
- [x] Add a compact worktree toggle group near the project title/header actions.
- [x] Include `main` as the first toggle.
- [x] Render each worktree name as a toggle button.
- [x] Show selected state clearly.
- [x] Show a small dot above the worktree name when that worktree has an active launch/setup terminal.
- [x] On dot/running toggle click, switch to that worktree and expose the stop control.
- [x] Ensure toggles wrap or horizontally scroll on narrow widths.
- [x] Add accessible labels such as `Switch to worktree main` and `Create worktree`.

## Phase 9: Delete Worktree UI

- [x] Add delete worktree button to the right of the file search button when selected worktree is not `main`.
- [x] Use existing `ConfirmDialog`.
- [x] Confirmation copy must include the worktree name and path.
- [x] If the worktree is dirty, show a stronger warning before allowing forced deletion, or block deletion until clean.
- [x] On confirm, call delete API.
- [ ] Kill scoped user terminals for that worktree before deleting if the user has confirmed force deletion.
- [x] Remove scoped task/user-terminal UI state after deletion.
- [x] Switch selection back to `main`.
- [x] Invalidate worktree, git, task, terminal, and project queries.

## Phase 10: Setup Command Configuration

- [x] Add a field to project settings/edit UI for "New worktree setup command".
- [x] Placeholder example: `pnpm i`.
- [x] Save the command on the project record or app settings.
- [x] Validate maximum length and trim whitespace.
- [x] Allow empty command to mean "do nothing".
- [x] Show helper text that the command runs once, inside the newly created worktree.
- [x] On worktree create success, start a user terminal named `Setup: <worktree-name>` with that command.
- [x] If another worktree is running, create the worktree but ask the user to stop the running worktree before starting setup, or block creation until the running worktree is stopped.

## Phase 11: Safety And Security

- [x] Reuse existing path security patterns for project-root containment.
- [x] Never accept arbitrary worktree paths from the client.
- [x] Never delete outside `.worktree/<name>`.
- [x] Enforce slug-only names server-side even though the client generates them.
- [x] Put timeouts on all git commands.
- [x] Treat git stderr as user-visible error detail but avoid echoing full user command input where not needed.
- [x] Add tests for path traversal attempts.
- [ ] Add tests for deleting `main`.
- [ ] Add tests for dirty worktree deletion behavior.

## Phase 12: Tests

- [x] Unit-test three-token name generation.
- [x] Unit-test worktree path resolution and root containment.
- [ ] Unit-test git service cwd resolution for main vs created worktree.
- [ ] Unit-test API validation for create/delete routes.
- [ ] Unit-test task scoping by worktree.
- [ ] Unit-test user terminal scoping by worktree.
- [x] Unit-test git query keys include `worktreeId`.
- [ ] Component-test or integration-test the project header toggle behavior.
- [ ] Component-test delete confirmation visibility only for non-main worktrees.
- [ ] Regression-test that run/play uses selected worktree cwd.
- [ ] Regression-test that ship/commit/push uses selected worktree cwd.
- [ ] Regression-test that starting a second worktree run is blocked while another is running.

## Phase 13: Manual QA

- [ ] Open a project and confirm the create worktree button appears to the right of the play button.
- [ ] Create a worktree and confirm a `.worktree/<three-token-name>` directory appears.
- [ ] Confirm the new worktree toggle appears next to `main`.
- [ ] Switch between `main` and the created worktree.
- [ ] Create two agent sessions in one worktree and one in another; verify they do not appear in the wrong scope.
- [ ] Run git diff/status in main and the worktree; verify changed files differ correctly.
- [ ] Run Ship in the worktree and verify it commits/pushes from that worktree.
- [ ] Configure setup command `pnpm i`, create another worktree, and verify the command runs in that worktree.
- [ ] Run the project launch command in a worktree and verify the terminal cwd is the worktree path.
- [ ] Try to run launch in another worktree while the first is running and verify it is blocked.
- [ ] Verify the running dot appears above the running worktree toggle.
- [ ] Stop the running worktree and verify another worktree can run.
- [ ] Select a non-main worktree and verify the delete button appears to the right of search.
- [ ] Delete a clean worktree and verify the directory is removed and selection returns to main.
- [ ] Verify `main` cannot be deleted.

## Implementation Order

- [x] Land data model and service tests first.
- [x] Land API routes and client API wrappers.
- [x] Thread selected worktree through git/status/diff/ship.
- [x] Thread selected worktree through tasks and agent sessions.
- [x] Thread selected worktree through user terminals and run/play.
- [x] Add header create/toggle/delete UI.
- [x] Add setup command configuration.
- [x] Add exclusivity guard and running indicators.
- [ ] Run typecheck, unit tests, and focused manual QA.
