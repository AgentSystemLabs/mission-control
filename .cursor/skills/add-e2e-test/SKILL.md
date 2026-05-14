---
name: add-e2e-test
description: Add a Playwright end-to-end test for a user-facing flow — sign-in, form submit, multi-step wizard, payment, navigation, etc. Detects existing Playwright setup and inherits its config (baseURL, projects, fixtures, auth state); installs Playwright via the official `npm init playwright@latest` flow only with explicit user approval. Wires one smoke test that hits the real running dev server before generating the full flow. Prefers role-based selectors (`getByRole`, `getByLabel`) over CSS/test-ids; uses `expect`-with-auto-retry assertions; adds an auth-state fixture for tests that need a logged-in user. Trigger phrases — "add an e2e test", "playwright test", "browser test for X", "test the signup flow", "/add-e2e-test", "end-to-end test". Skip for — pure unit-testable logic (use write-tests), API-only flows (use write-tests with supertest/fetch), and projects where the user explicitly does not want a browser harness.
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Add E2E Test

Browser tests are expensive — slow, flaky-prone, and dependent on a live server. They earn their cost only when they exercise the real user path. Anything that can be tested at the unit or integration layer should be tested there instead.

---

## Phase 1 — Confirm Scope

Confirm the flow with the user in one sentence: which page does the user start on, what action do they take, what observable outcome proves it worked? If any of those three are vague, ask before writing the test.

If the flow is essentially a function call dressed up as a UI interaction (e.g., "test that this util returns the right value"), redirect: that's a unit test, not an e2e test.

**Exit:** start URL, user action, observable outcome are written down.

---

## Phase 2 — Detect Playwright

Check, in order:

1. `@playwright/test` in `package.json` devDependencies → installed.
2. `playwright.config.ts` / `.js` / `.mts` at repo root → configured.
3. `tests/` or `e2e/` directory with existing `*.spec.ts` files → conventions to inherit.

If Playwright is not installed:

```
Playwright not detected.
Proposed setup: npm init playwright@latest
This will:
  - install @playwright/test
  - create playwright.config.ts
  - create example tests in tests/
  - download browser binaries (~170MB)
Approve? (y/n)
```

Wait for `y`. Do not auto-install. If the user declines, stop.

**Exit:** Playwright is installed and configured; the test directory is identified.

---

## Phase 3 — Inherit Conventions

Read 1–2 existing spec files. Extract:

- Where tests live (`tests/`, `e2e/`, colocated)
- File naming (`<flow>.spec.ts`, `<flow>.e2e.ts`)
- Fixture / setup pattern (`test.beforeEach`, `auth.setup.ts`, `playwright/fixtures.ts`)
- Auth strategy (`storageState` from a setup project, login-per-test, cookies set in fixtures)
- baseURL handling (env var, hardcoded, project-specific)

If no existing tests, defaults:
- Tests live in `tests/` (or `e2e/` if `tests/` is unit tests).
- File: `<flow>.spec.ts`.
- Auth: if the flow needs a logged-in user, create `tests/auth.setup.ts` that logs in once and saves `storageState`, referenced from `playwright.config.ts`.

**Exit:** convention notes recorded.

---

## Phase 4 — Smoke Test (HARD GATE)

Before writing the real flow, write **one** trivial Playwright test:

```ts
test('app loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/.+/)
})
```

Start the dev server (or rely on `webServer` config), run the smoke test:

```bash
npx playwright test <path-to-smoke> --reporter=list
```

It must pass. If it fails: stop. Debug the baseURL, the dev server start, the webServer config — do not write more tests against a broken harness.

**Exit:** one smoke test passes against the running app.

---

## Phase 5 — Write the Flow

Build the test from the user's three sentences:

```ts
test('<observable outcome>', async ({ page }) => {
  await page.goto('<start url>')

  // user actions — prefer role-based selectors
  await page.getByLabel('Email').fill('test@example.com')
  await page.getByLabel('Password').fill('correct-horse')
  await page.getByRole('button', { name: 'Sign in' }).click()

  // observable outcome
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})
```

Selector preference, in order:
1. `getByRole(...)` (with accessible name)
2. `getByLabel(...)` for form inputs
3. `getByText(...)` for non-interactive content
4. `getByTestId(...)` only when the others fail
5. Raw CSS/XPath — last resort

For assertions, always use Playwright's `expect` (auto-retries until timeout). Do not use Node's `assert` or `chai` — those don't retry and produce flaky tests for normal async UI updates.

If the flow needs a logged-in user, use the `storageState` fixture from Phase 3, not an in-test login (slow, flaky, and you already test login separately).

**Exit:** the test is written and passes when run against the dev server.

---

## Phase 6 — Verify Stability

Run the test 3 times in a row:

```bash
npx playwright test <path> --repeat-each 3
```

If any run fails: the test is flaky as-is. Common causes:
- Missing `await` on a network-dependent assertion → use `expect(...).toBeVisible()` (auto-retries) instead of `expect(await locator.isVisible()).toBe(true)`.
- Hard-coded `waitForTimeout` instead of waiting on a condition.
- Race between navigation and assertion → `await page.waitForURL(...)` before asserting on the new page.

Fix and re-run until 3-of-3 pass.

**Exit:** 3 consecutive runs green.

---

## Phase 7 — Report

```
E2E test added: <path>
  Flow:    <one-line description>
  Run:     npx playwright test <path>
  Stable:  3/3 runs passed

Note: this test starts the dev server; CI will need to run it the same way (or
against a deployed preview).
```

---

## NEVER

- **NEVER use `page.waitForTimeout(<ms>)` to wait for UI to update.**
  **Instead:** use `expect(...).toBeVisible()` / `toHaveText()` / `waitForURL()` / `waitForResponse()` — Playwright auto-retries until the timeout.
  **Why:** fixed timeouts are the #1 source of e2e flake. They pass on a fast machine, fail on a slow one, and produce noise that erodes trust in the suite. Auto-retrying assertions describe what you're actually waiting for.

- **NEVER assert against `await locator.isVisible()` (returns a boolean once).**
  **Instead:** `await expect(locator).toBeVisible()` (retries the locator until visible or timeout).
  **Why:** the boolean form runs once at the moment you call it — if the element appears 50ms later, your test fails for no reason. The expect-with-locator form is the whole point of Playwright's API.

- **NEVER select by CSS class or implementation detail (`.btn-primary`, `[data-react-id="..."]`).**
  **Instead:** use `getByRole`/`getByLabel`/`getByText`/`getByTestId` in that order of preference.
  **Why:** CSS selectors break on every visual refactor that changes class names; the test fails not because behavior regressed but because the selector did. Role-based selectors track what the user actually perceives.

- **NEVER auto-install Playwright.**
  **Instead:** propose `npm init playwright@latest` and wait for `y`.
  **Why:** Playwright downloads ~170MB of browser binaries and adds a non-trivial CI surface. The user owns that decision.

- **NEVER write an e2e test for logic that has no UI surface.**
  **Instead:** redirect to `write-tests` for an integration test that hits the function/API directly.
  **Why:** e2e tests are 10–100× slower and more flaky than equivalent integration tests. Using them for non-UI logic burns CI time and adds flake without any of the e2e-specific value (real browser, real user input).

- **NEVER skip the smoke test gate.**
  **Instead:** write one trivial passing test, run it, and only then write the real flow.
  **Why:** if the harness, baseURL, or dev server is misconfigured, every subsequent test fails for the same root cause — wasted effort. One green smoke test proves the loop closes.

- **NEVER share auth state by performing login inside each test.**
  **Instead:** use a `storageState` setup project that logs in once and saves cookies; reference it from each test that needs a logged-in user.
  **Why:** in-test login multiplies the test runtime by N (slow), races on shared user state, and conflates "is login broken" with "is the flow under test broken" when something fails.

- **NEVER bundle multiple unrelated flows into one test.**
  **Instead:** one test per flow. If two flows share setup, share the setup via a fixture.
  **Why:** a 200-line test that signs up, then creates a project, then invites a teammate fails opaquely — when it goes red, no one can tell which step broke. Shorter tests fail fast and point at the regression.
