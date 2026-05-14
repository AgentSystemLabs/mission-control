---
name: audit-analytics
description: Audit analytics event tracking across a route, feature, or the whole client surface — verifies that important user actions emit events, that event names match the project's existing taxonomy (snake_case vs camelCase, prefix conventions, verb tense), that property names are consistent across siblings, and that no PII (emails, raw user IDs in some setups, secrets) is being shipped in event properties. Detects the project's analytics SDK (PostHog, Amplitude, Segment, Mixpanel, GA4, custom wrapper) by import; uses the project's existing event catalog as the convention source if one exists. Reports gaps and inconsistencies; never invents events. Trigger phrases — "audit analytics", "check event tracking", "/audit-analytics", "are we tracking X", "missing events on this page", "event taxonomy", "are events consistent", "PII in analytics". Skip for — projects with no analytics SDK installed, server-only analytics (different concerns; out of scope here), and one-off internal admin pages explicitly excluded from tracking.
---

# Audit Analytics

The bug class this skill targets is silent under-tracking: a feature ships, looks fine, but the team can't tell whether anyone uses it because no events were wired. Second class: drift — `signup_completed` here, `SignupCompleted` there, `user_signed_up` somewhere else, all measuring the same thing.

---

## Phase 1 — Detect the SDK and Catalog

Detect the analytics SDK by imports:

| Import | SDK |
|---|---|
| `posthog-js`, `posthog-node` | PostHog |
| `@amplitude/analytics-browser` | Amplitude |
| `@segment/analytics-next` | Segment |
| `mixpanel-browser` | Mixpanel |
| `react-ga4`, `gtag` | GA4 |
| Project-local wrapper (e.g., `@/lib/analytics`) | Wrapped SDK — use the wrapper |

If none detected, stop: "No analytics SDK detected. Add tracking with one of [SDKs] before auditing."

Look for an event catalog — common locations:
- `src/lib/analytics/events.ts` exporting `EVENTS` const, enum, or schema
- `src/analytics/`, `analytics.config.ts`
- A typed wrapper: `track(event: 'signup_completed', props: ...)`

If a catalog exists, it is the convention source for naming. If not, infer the convention by sampling 5+ existing `track()` calls.

**Exit:** SDK and conventions are known; catalog (if any) is read.

---

## Phase 2 — Per-Surface: Find Tracked and Untracked Events

For the user's scope (one route / feature / module), enumerate user-facing actions and check each:

| Action class | Should emit? |
|---|---|
| Page view | Usually yes (often automatic with the SDK; verify it isn't disabled per-route) |
| Form submit (success) | Yes |
| Primary CTA click (signup, upgrade, "create X") | Yes |
| Destructive action (delete, cancel subscription) | Yes |
| Search / filter use | Often yes |
| Modal open (when carrying user intent, not e.g. a tooltip) | Often yes |
| Error encountered (after retries) | Often yes |
| Hover / mouse enter / scroll | Usually no |
| Internal navigation between sub-views | Sometimes |

For each found `track(...)` call, record event name and properties. For each user-action site without a `track()`, classify as:

- **MUST** — clearly should be tracked (signup, paid conversion, primary CTA).
- **SHOULD** — likely should be tracked given existing taxonomy (the user can decide).
- **OK to skip** — low-value or obviously excluded.

**Exit:** every action site is classified.

---

## Phase 3 — Check Existing Events for Drift

For each `track(...)` call in scope, validate against the taxonomy:

- **Naming case.** If the catalog uses `snake_case`, flag camelCase events.
- **Verb tense.** If the catalog uses past tense (`signup_completed`), flag present-tense (`signup_complete`) or imperative.
- **Prefix.** If the catalog uses `{noun}_{verb}` (`post_created`), flag inverted forms.
- **Property name consistency.** If existing events use `user_id`, flag `userId`/`uid`. If they use `entity_id`, flag `id`.
- **Property type consistency.** If `plan` is always a string enum, flag a numeric `plan: 1`.
- **Sibling drift.** If `post_created` has props `{post_id, author_id}`, then `comment_created` should follow the same shape — flag missing `parent_id`/`comment_id`.

For each drift, propose the corrected name/shape using the catalog's convention.

**Exit:** drift findings listed.

---

## Phase 4 — PII / Secrets Check

Scan property values for likely PII or secrets:

- **Email addresses** in event properties (often unintentional — `email: user.email`). Most setups should track a user *id*, not the email itself.
- **Raw passwords / tokens / API keys** (rare but catastrophic; check anyway).
- **Full names** if the project's privacy stance excludes them.
- **Device fingerprints, IPs** in setups that aren't explicitly designed to receive them.
- **Third-party PII** (Stripe customer email, OAuth provider sub) routed into the analytics call without redaction.

For each hit, report severity CRITICAL (secrets, passwords) or HIGH (emails, full names depending on policy).

**Exit:** PII findings listed.

---

## Phase 5 — Report

```
Analytics Audit — <scope>
─────────────────────────

Missing events
  MUST   src/routes/billing.tsx:88   Upgrade CTA click is not tracked
                                     Suggested: plan_upgraded { from, to }
  SHOULD src/routes/posts.new.tsx:42 New-post form submit success not tracked
                                     Suggested: post_created { post_id, author_id }
  OK     src/routes/marketing.tsx:14 Marketing tooltip hover (low value)

Drift
  src/components/Header.tsx:21       signupComplete → signup_completed
                                     (catalog uses snake_case past tense)
  src/fn/createPost.ts:33            { id }   → { post_id }
                                     (sibling events use post_id)

PII / secret findings
  CRITICAL src/routes/auth.tsx:56    track('login_attempt', { email: user.email, password: input.password })
                                     password is being shipped to PostHog. Remove immediately.
  HIGH     src/components/Profile.tsx:14  email property in profile_viewed event

Total: 6 findings (1 CRITICAL, 1 HIGH MUST-track, 2 SHOULD-track, 2 drift).
```

The report does not auto-fix events. Adding or renaming events is a product decision (taxonomy stability across dashboards depends on names *not* changing silently).

---

## Phase 6 — Optional Apply

Only on explicit user request and one finding at a time:

- **CRITICAL PII findings:** offer to remove the offending property immediately (low risk; high value).
- **MUST-track gaps:** propose the `track()` call with the suggested name and properties; user approves before insert.
- **Drift renames:** **stop.** Renaming an existing event is a multi-system change (dashboards, funnels, alerts in the analytics tool break). Only do this with explicit user direction and ideally a deprecation period — out of scope for this audit.

---

## NEVER

- **NEVER auto-rename existing events.**
  **Instead:** report drift; let the user decide (renames break dashboards, funnels, retention reports downstream).
  **Why:** an event name is a contract with the analytics tool. Silently renaming `signup_complete` → `signup_completed` breaks every saved dashboard and alert that referenced the old name. The fix has to be coordinated with the data team — the audit's job ends at flagging.

- **NEVER invent events the user didn't ask for.**
  **Instead:** report missing-event gaps with severity and a *suggested* name; do not insert.
  **Why:** event creation is a product decision — adding a tracked event commits the team to maintaining it, paying per-event SDK costs, and answering "what does this measure" forever. The user owns that.

- **NEVER allow PII in event properties without an explicit project policy that permits it.**
  **Instead:** flag CRITICAL on passwords/secrets, HIGH on emails/full names, and propose redaction (`user_id` instead of `email`).
  **Why:** PII in analytics tools means GDPR/CCPA scope, breach-blast-radius increase, and analytics-tool data retention you can't easily revoke. Treating it as default-bad keeps the project out of trouble.

- **NEVER conflate "automatic page view tracking" with "page views are tracked".**
  **Instead:** verify the SDK's autocapture is enabled and not blocked by route-level `noTrack` / consent gates that haven't been satisfied.
  **Why:** many SDKs ship with autocapture but have it disabled in the project's init call, or gated behind a consent banner that's failing silently. Assuming page views work is the most common silent gap.

- **NEVER scan the whole repo by default.**
  **Instead:** narrow to one route, feature, or module per audit run.
  **Why:** a whole-repo audit produces hundreds of findings dominated by low-value drift. The signal is in the surfaces with active product investment.

- **NEVER infer the project's PII policy.**
  **Instead:** flag email/name properties as HIGH; let the user confirm whether their policy allows them.
  **Why:** some projects intentionally track email (small B2B with explicit user consent), some don't. The audit's job is to surface the question, not to decide.
