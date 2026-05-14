# Dead-Code Sweep Checklist (Phase 5)

Run through every category. For each, search the repo for surviving references to the *just-deleted* symbols, files, and strings. If a reference is found and points only to deleted code, it is an orphan — delete it, then loop.

Do not skip a category because it "obviously doesn't apply" — that judgment is wrong often enough that the few seconds of grep are worth it.

---

## 1. Imports & exports

- Unused imports in files you edited (lint with unused-imports rule, or grep imports of deleted modules).
- Re-exports in barrels (`index.ts`, `mod.rs`, `__init__.py`) that point to deleted files.
- `package.json` `"exports"` / `"main"` / `"bin"` entries pointing to deleted paths.
- TypeScript `paths` aliases in `tsconfig.json` that no longer resolve.

## 2. Types & interfaces

- Type aliases, interfaces, enums, generic constraints used only by deleted code.
- Union members referencing deleted variants (`type X = "a" | "b" | "deleted"`).
- Discriminated-union `case`/`switch` arms for the deleted variant (the compiler may not warn if exhaustiveness isn't enforced).
- Generated types (GraphQL codegen, OpenAPI codegen, Prisma) — regenerate after deletion.

## 3. Helpers, hooks, components

- Pure helper functions whose only callers were the deleted code.
- Custom hooks (React/Vue) used only by deleted components.
- Components used only by the deleted page/route.
- Storybook stories or visual-regression fixtures for deleted components.

## 4. Tests & fixtures

- Test files for deleted modules (often colocated as `*.test.ts` / `*.spec.ts`).
- Shared test fixtures, factories, mock data only referenced by deleted tests.
- E2E test specs for deleted user flows.
- Snapshot files (`__snapshots__/`) for deleted components.
- Mock service handlers (MSW, nock) for deleted endpoints.

## 5. Routes & navigation

- Route definitions (file-based router files, route arrays, route registries).
- Nav menu entries, sidebar items, breadcrumb maps, sitemap entries.
- Redirect rules in hosting config (`vercel.json`, `_redirects`, nginx, middleware).
- Route guards / permission rules tied to deleted routes.
- Deep-link handlers, URL-pattern matchers.

## 6. Strings (the silent killer)

- i18n / translation keys (`en.json`, `messages.ts`, etc.) — every locale, not just the default.
- Feature-flag keys in code AND in the flag service (LaunchDarkly, Unleash, custom flag table).
- Analytics event names (`track("feature_x_clicked")`), funnel definitions, dashboard queries.
- Log messages and error codes only emitted by deleted code (if other systems alert on them).
- CSS class names used only by deleted JSX/templates (if not using CSS modules / scoped styles).
- DOM IDs / `data-testid` referenced only by deleted tests.

## 7. Backend & API surface

- API route handlers, controller methods, gRPC service methods.
- OpenAPI / Swagger schema entries.
- GraphQL resolvers, schema types, federation entities.
- Background jobs, cron entries, queue consumers, scheduled tasks.
- Webhook handlers and webhook subscription registrations.

## 8. Persisted state (handle with care — see SKILL.md Phase 4)

- DB columns no longer written or read (defer the actual `DROP` to a follow-up migration with user approval).
- Indexes whose only purpose was the deleted feature's queries.
- Stored procedures, views, materialized views referencing deleted columns.
- Cached blob keys, Redis keys, S3 prefixes for the deleted feature's data.
- localStorage / sessionStorage / cookie names set only by deleted UI.

## 9. Config & environment

- Env vars in `.env.example`, deployment configs, secret managers, CI variable lists.
- Feature flags in flag service (delete the flag itself, not just the code reading it).
- Third-party service config (webhook URLs registered with Stripe, SendGrid templates, etc.).
- Permission/role definitions for deleted capabilities.
- Rate-limit rules, CORS allowlists, CSP entries scoped to deleted routes.

## 10. Documentation & operational artifacts

- README sections describing the removed feature.
- CHANGELOG — add a removal entry (do not silently delete; users need to know).
- ADRs / design docs — mark as superseded, do not delete history.
- Inline doc comments referencing deleted symbols.
- Runbooks, on-call docs, dashboard descriptions.
- Diagrams (architecture, ER, sequence) that show the removed feature.

## 11. Build & dev tooling

- `package.json` scripts that ran the deleted feature's tooling.
- Webpack/Vite/Rollup config entries (chunk names, alias paths, externals).
- Lint rule overrides scoped to deleted directories.
- CI workflow steps that built/tested/deployed only the deleted feature.
- Docker layers, build args, multi-stage stages dedicated to the feature.

---

## When to stop

Stop sweeping when one full pass through every category above finds zero references to deleted code. Two passes is typical; three is fine for large features. If you're on pass four and still finding orphans, you likely missed a class of reference in Phase 2 — go back and broaden the original map rather than chasing tail orphans one at a time.
