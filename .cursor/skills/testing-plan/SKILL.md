---
name: testing-plan
description: Generate a markdown QA test plan a human tester can execute against the current branch — for a new feature, bug fix, or refactor. Produces testing-plans/<slug>.md with required sections (Summary, Scope, Test Users, Preconditions, Environment, Step-by-step Checklist, Edge Cases, Regression Checks, Sign-off). Each step names the exact route/UI surface, which user to log in as, the action, and the expected result. Trigger phrases — "testing plan", "QA plan", "manual test plan", "/testing-plan", "write a test plan", "give this to QA", "QA checklist", "verify this branch", "manual verification steps", "hand off to QA". Skip for: automated test authoring (use write-tests), production smoke tests independent of a branch, and PR-comment-driven verification (use address-pr-comments).
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Testing Plan

Generate `testing-plans/<slug>.md` so a non-author QA tester can verify the current branch end-to-end without asking follow-up questions.

The plan is for a **human** in front of a browser/desktop app. Every step must name the route, the actor, the action, and the expected result. Vague steps ("verify it works") are the failure mode this skill exists to prevent.

---

## Step 1 — Gather change context

Read the branch name, the commits on this branch, and the diff vs `main` — focusing on routes, server functions, components, schema, and auth changes. Skim the rest.

If the branch is `main` or has no diverged commits, ask the user which range to plan against (last commit, last N commits, or a feature folder).

## Step 2 — Identify user-visible surfaces

From the diff, list:

- **Routes added/changed** (e.g. files under `src/routes/` or framework equivalent)
- **UI components** that render on those routes
- **Server functions / endpoints** the UI calls
- **Schema/migration changes** that affect persisted data
- **Auth/permission changes** that gate access
- **Background jobs / webhooks** triggered by user actions

If a change is purely internal (refactor with no user-visible delta), the plan still needs **regression checks** for the surfaces that consume the refactored code — find them via grep on the renamed/moved symbols.

## Step 3 — Determine test users

Read project auth setup to find seeded/known accounts. Common locations:

- `seed.ts`, `seed.sql`, `prisma/seed.*`, `drizzle/seed.*`
- `.env.example` for `TEST_USER_*` or `ADMIN_*` vars
- `CLAUDE.md` / `AGENTS.md` for QA account conventions
- Auth config (roles, permissions tables)

For each role the change touches, name the actor concretely: email + how to log in (password from seed, magic link, OAuth dev mode, impersonation route). If you cannot find a concrete account, **stop and ask the user** — do not invent credentials.

## Step 4 — Determine preconditions

List everything QA must have set up before step 1 of the checklist:

- Required env vars (read `.env.example`, list any new ones from the diff)
- Services that must be running (DB, redis, mail catcher, S3 mock, third-party stubs)
- Seed data / migrations (commands to run)
- Feature flags that must be enabled
- Third-party state (a Stripe test customer, a Slack workspace, etc.)
- Build/dev-server command for this project

If any precondition cannot be inferred from the repo, ask the user once before writing the file.

## Step 5 — Write the plan file

> **Before writing, ask:** could a tester who has never touched this code execute every step without asking the author a question? If no, fix the gap before saving.


Path: `testing-plans/<slug>.md`. Create the `testing-plans/` directory if missing. If the file exists, append a new dated section rather than overwriting.

**Slug derivation:** start from the branch name; strip leading `feature/`, `fix/`, `bug/`, `chore/`, `refactor/` prefixes; lowercase; replace `_` and spaces with `-`; collapse repeated hyphens. If the branch is `main` or generic, derive the slug from the feature name the user provided.

Use the template below verbatim. Every section is required. If a section legitimately doesn't apply, keep the heading and write `_N/A — <one-line reason>_` so the QA tester knows it was considered, not forgotten.

---

## Template

````markdown
# Testing Plan: <Feature / Bug / Refactor Title>

**Branch:** `<branch-name>`
**Type:** Feature | Bug fix | Refactor | Chore
**Author:** <git user>
**Date:** <YYYY-MM-DD>
**Related:** <issue/PR links if known>

## Summary

<2–3 sentences. What changed from the user's perspective. For a refactor: what changed internally and which surfaces are affected.>

## Scope

**In scope:**
- <surface 1 — route, screen, or flow>
- <surface 2>

**Out of scope:**
- <explicit non-goals so QA doesn't chase them>

## Test Users

| Role | Email | How to log in | Notes |
|------|-------|---------------|-------|
| <role> | <email from seed> | <password / magic-link / impersonation route> | <permissions or data this user has> |

## Preconditions

- [ ] On branch `<branch-name>`, latest pulled
- [ ] Dependencies installed: `<install command>`
- [ ] Migrations applied: `<migrate command>`
- [ ] Seed data loaded: `<seed command>`
- [ ] Required env vars set: `<VAR_1>`, `<VAR_2>` (see `.env.example`)
- [ ] Services running: `<list>`
- [ ] Feature flag(s): `<flag> = on`
- [ ] Third-party state: <e.g. "a Stripe test customer with card 4242…">

## Environment

- App URL: `http://localhost:<port>`
- Start command: `<command>`
- Logs to watch: `<file or terminal>`

## Step-by-step Checklist — Golden Path

> Log in as **<primary user email>** unless a step says otherwise.

1. [ ] Navigate to `<route>` — <screen name>
   - **Action:** <click / type / submit>
   - **Expected:** <visible result, URL change, toast, network call>
2. [ ] …
3. [ ] …

## Edge Cases

- [ ] <empty input / boundary value> at `<route>` → <expected handling>
- [ ] <permission denied — log in as <other user>> at `<route>` → <expected redirect or 403>
- [ ] <network failure / slow response> → <expected loading + error state>
- [ ] <duplicate submission / double-click> → <expected idempotency>
- [ ] <browser back/forward after action> → <expected state>

## Regression Checks

Adjacent surfaces that share code paths with the change. Verify these still work:

- [ ] <surface 1> at `<route>` — <one-line spot-check>
- [ ] <surface 2> at `<route>` — <one-line spot-check>

## Sign-off

- Tester: ____________________
- Date: ____________________
- Result: ☐ Pass  ☐ Pass with notes  ☐ Fail
- Notes:
````

---

## NEVER

- **NEVER write vague steps like "verify the feature works" or "test the UI"**
  **Instead:** Each step names a route, an actor, an action, and an observable expected result.
  **Why:** A QA tester who isn't the author cannot infer "works" — without an expected result, a passing step proves nothing.

- **NEVER invent test user credentials**
  **Instead:** Read seed files / `.env.example` / auth config; if no concrete account exists, stop and ask the user before writing the file.
  **Why:** A plan with fake creds wastes the tester's time and silently undermines trust in every other step.

- **NEVER skip the Regression Checks section, even for a "small" change**
  **Instead:** Grep for callers of changed symbols / consumers of changed routes; list the top 2–5 adjacent surfaces.
  **Why:** Refactors and bug fixes break neighboring features more often than the changed surface itself.

- **NEVER plan steps for code that wasn't actually changed in the diff**
  **Instead:** Ground every checklist item in a file from `git diff main...HEAD` (or the user-specified range).
  **Why:** Untethered plans test phantom features and miss the real risk surface.

- **NEVER overwrite an existing `testing-plans/<slug>.md`**
  **Instead:** Append a new dated section under the existing file, or write to `<slug>-<date>.md`.
  **Why:** Prior QA runs are evidence; destroying them loses the audit trail across re-tests.

- **NEVER include automated-test instructions (jest, playwright, vitest commands) in this file**
  **Instead:** This plan is for a human in a browser. Automated coverage belongs in `write-tests`.
  **Why:** Mixing the two confuses QA about which steps they own and dilutes both artifacts.
