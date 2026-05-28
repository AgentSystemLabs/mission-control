# TODO

Product backlog for Mission Control — personal + work use cases.

---

## Metrics & token usage

The Cursor status line shows live session token usage, but Mission Control still lacks easy at-a-glance totals per project and per session, plus cost/time KPIs for repeatable work.

**Current state:** Backend + `UsagePanel` exist (`/api/usage`, per-project / per-session / per-day breakdowns from Claude Code JSONL logs). The panel is not wired into navigation yet, and metrics are not surfaced on project cards or session rows.

- [ ] **Wire up Token Usage panel** — add nav entry (settings sidebar, top bar, or keybinding) that opens `UsagePanel` (`setActivePanel("usage")` in `__root.tsx` is never called today)
- [ ] **Per-project token totals on Mission Control grid** — show cumulative usage on each `ProjectCard` (badge or subtitle), drill-down to project-scoped usage
- [ ] **Per-session token totals in project detail** — show token count on each finished/running session row, not only in the global usage table
- [ ] **Estimated cost column** — convert tokens → USD using configurable model pricing (Sonnet / Opus / Haiku rates in settings)
- [ ] **Session duration & time KPIs** — track wall-clock time per session (created → finished) and surface averages for repeatable task types
- [ ] **Repeatable-task KPI dashboard** — optional view to compare token usage, cost, and duration across similar sessions (e.g. by title prefix, skill, or tag)
- [ ] **Multi-agent usage ingestion** — extend beyond Claude Code JSONL to Codex and Cursor CLI usage logs where available
- [ ] **Live / incremental sync** — refresh usage on session finish (SSE hook) instead of only on manual panel open
- [ ] **Export usage data** — CSV or JSON export for personal/work reporting

---

## Workflow pipelines (exploratory)

Idea: n8n-style visual task flows for repeatable agent workflows — define, visualize, and run consistently. May overlap with GitHub/GitLab/Codeberg/Forgejo CI; evaluate whether the overhead is worth it vs. delegating to existing CI.

**Example flow:**

```
Run task → Refactor code → Unit test → Generate SBOM & upload → Code runner → Security scan → Push
```

- [ ] **Spike: feasibility & scope** — document what MC can orchestrate (PTY steps, API calls, file triggers) vs. what belongs in external CI
- [ ] **Workflow data model** — nodes (step type, command/skill, inputs) + edges (success/failure paths) + run history
- [ ] **Visual flow editor** — drag-and-drop or list-based builder (Mermaid preview already exists via diagram skill; reuse patterns)
- [ ] **Step types (MVP)** — shell command, agent prompt, wait-for-status, conditional branch
- [ ] **Run orchestrator** — execute a saved workflow against a project/worktree with progress UI and per-step logs
- [ ] **Workflow templates** — ship 1–2 built-in examples (e.g. “refactor → test → scan → push”) users can clone
- [ ] **Integration hooks** — optional triggers: session finished, git push, manual “Run workflow” button
- [ ] **Decision gate** — after spike, either commit to v1 scope or document “use CI instead” and close

---

## Session archive

Finished sessions pile up; deleting loses history, but the active list gets noisy. Archive should hide sessions from the main columns while keeping them recoverable.

**Current state:** `POST /api/tasks/:id/archive` and `restoreTask` exist in the API. Project detail only offers **Clear finished** (permanent delete). No archive view route (`archive.tsx` is in README layout but not implemented).

- [ ] **Archive action on finished sessions** — per-session “Archive” on finished rows (context menu or row action)
- [ ] **Archive all finished** — bulk archive with confirmation (alternative to “Clear all” delete)
- [ ] **Archived sessions view** — dedicated route or filter to browse, search, and restore archived sessions
- [ ] **Restore from archive** — wire `restoreTask` in UI; return session to Finished column
- [ ] **Archive vs delete copy** — make destructive “Clear” vs non-destructive “Archive” distinction obvious in dialogs
- [ ] **Optional: auto-archive** — setting to archive sessions N days after finishing

---

## Bugs & platform fixes

### Windows: copy/paste in Claude terminal

On Windows, copying a row in Claude (terminal selection / context copy) does not copy to clipboard; paste also fails.

- [ ] **Reproduce on Windows** — confirm in MC Electron PTY + plain Claude Code outside MC
- [ ] **xterm.js selection → clipboard** — ensure `TerminalPane` copy action and Ctrl+C/Ctrl+V bridge to Electron clipboard on win32
- [ ] **Electron clipboard permissions** — verify `clipboard-read` / write paths for renderer vs preload (`notification-permissions` currently denies clipboard-read)
- [ ] **Regression test** — manual QA checklist item for Windows copy/paste in agent terminals

---

## Existing backlog

- [ ] **Finished section: clear-all button** — add “Clear all” on Finished column with confirmation dialog (partially present; verify UX polish)
- [ ] **Light mode for terminals** — xterm theme tokens that match light `styles.css` palette
- [ ] **Placeholder** — remove or replace “another todo item” when scoped

---

## Notes

| Area | Key files |
|------|-----------|
| Token usage API | `src/server/services/token-usage.ts`, `src/shared/token-usage.ts` |
| Usage UI | `src/components/views/UsagePanel.tsx`, `UsageView.tsx` |
| Task archive API | `src/server/services/tasks.ts` (`archiveTask`, `restoreTask`) |
| Project sessions UI | `src/routes/projects.$id.tsx` |
| Terminal / clipboard | `src/components/views/TerminalPane.tsx`, `electron/main.ts`, `electron/preload.ts` |
