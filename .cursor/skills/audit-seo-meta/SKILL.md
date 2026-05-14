---
name: audit-seo-meta
description: Per-route SEO and social-share metadata audit — checks `<title>`, meta description, canonical URL, Open Graph tags (og:title, og:description, og:image, og:url, og:type), Twitter card tags, viewport, robots directives, and the presence of a sitemap and robots.txt. For TanStack Start, reads route `head()` exports; for Next.js, reads `metadata` / `generateMetadata`; for plain HTML, reads `<head>`. Reports per-route findings with severity, plus repo-level findings (missing sitemap, no robots.txt, missing default OG image asset). Auto-fixes only the trivial defaults (boilerplate viewport meta, repo-level sitemap stub) with explicit user approval; route-specific copy is reported, never invented. Trigger phrases — "seo audit", "audit meta tags", "check og tags", "social share preview", "/audit-seo-meta", "missing meta description", "fix sharing preview", "twitter card", "canonical url". Skip for — apps that are intentionally non-public (auth-walled SaaS dashboards), purely internal tools, and pages explicitly marked `noindex`.
---

# Audit SEO Meta

The audit ranks findings by what users see (broken share previews, no description in search results) above what crawlers theoretically prefer. A perfect score on heuristics that don't move SERP placement is wasted attention.

---

## Phase 1 — Determine Scope

Default scope: every public route. The user may narrow to one route ("audit /pricing") or the marketing surfaces only.

For a TanStack Start project: list `src/routes/**/*.tsx` and exclude:
- Routes under `/_protected/`, `/admin/`, `/dashboard/` (auth-walled by convention)
- API routes (`/api/`)
- Catch-all error routes
- Any route where `head()` explicitly sets `meta: [{ name: 'robots', content: 'noindex' }]`

For Next.js: same but with the `app/` or `pages/` convention.

If the user can't tell which routes are public, ask before scanning the whole repo.

**Exit:** the route list is fixed.

---

## Phase 2 — Per-Route Checks

For each route, read its head/metadata source and check:

| Tag / field | Required | Notes |
|---|---|---|
| `<title>` | YES | 30–65 chars; not the literal site name on every page |
| `<meta name="description">` | YES | 50–160 chars; specific to the page |
| `<link rel="canonical">` | YES on duplicate-prone pages | Required if the page has variants (query params, alt URLs); default to self-canonical |
| `<meta property="og:title">` | YES | Often same as `<title>`; required for share preview |
| `<meta property="og:description">` | YES | Often same as description |
| `<meta property="og:image">` | YES | 1200×630 recommended; absolute URL |
| `<meta property="og:url">` | YES | Absolute URL of this page |
| `<meta property="og:type">` | OPTIONAL | `website` default, `article` for posts |
| `<meta name="twitter:card">` | YES | `summary_large_image` for most pages |
| `<meta name="twitter:image">` | YES if og:image absent | Otherwise inherits from og |
| `<meta name="viewport">` | YES (any HTML page) | Set in root layout, not per-route |
| `<meta name="robots">` | If non-default | `index, follow` is implicit; only set when overriding |

For each missing tag, classify severity:

- **CRITICAL** — title, description, og:image. Visible in SERP and social previews.
- **HIGH** — og:title, og:description, og:url, twitter:card. Affects share appearance.
- **MEDIUM** — canonical, og:type. Affects deduplication and rich preview shape.
- **LOW** — keywords (mostly ignored), other niceties.

Also flag:

- Title is the site name only (no page-specific copy).
- Description is missing or is the same as the homepage's.
- og:image points to a relative path (must be absolute).
- og:image asset doesn't exist on disk.
- Title or description is a placeholder ("TODO", "Lorem ipsum", "Page title").

**Exit:** per-route findings listed.

---

## Phase 3 — Repo-Level Checks

Check the repository:

- `public/robots.txt` exists, is reachable from the server, and isn't accidentally blocking the whole site (`Disallow: /`).
- A sitemap is generated or served at `/sitemap.xml`. For TanStack Start: a server route returning XML; for Next: `app/sitemap.ts` / `pages/sitemap.xml.ts`.
- Default OG image asset exists in `public/` (typically `og.png` or `og-default.png`) and is the right dimensions (1200×630).
- A favicon is present and referenced in the root head.
- `lang` attribute is set on `<html>`.

Each missing item is a HIGH or MEDIUM repo-level finding.

**Exit:** repo-level findings listed.

---

## Phase 4 — Report

```
SEO/Meta Audit — <scope>
─────────────────────────

Per-route findings
  /                    CRITICAL — meta description missing
                       HIGH     — og:image absent
                       LOW      — title is "Acme — Acme" (redundant)
  /pricing             OK
  /blog/$slug          HIGH     — og:image is a relative path
                       MEDIUM   — canonical missing (URL has tracking params)
  /about               CRITICAL — title is "Page title" (placeholder)

Repo-level findings
  HIGH     — public/robots.txt missing
  HIGH     — /sitemap.xml not served (no sitemap route or static file)
  MEDIUM   — default OG image (public/og.png) absent

Total: 7 findings (3 CRITICAL, 4 HIGH, 2 MEDIUM, 1 LOW).
```

---

## Phase 5 — Optional Auto-Fixes

For repo-level boilerplate only, with explicit user approval:

- Generate `public/robots.txt` with sensible defaults.
- Generate a sitemap stub (TanStack Start route or Next sitemap.ts) listing the discovered public routes — user must complete with the actual canonical URLs.
- Add `<meta name="viewport" content="width=device-width, initial-scale=1">` to root layout if missing.

For per-route copy (titles, descriptions, og text), **do not invent**. The audit reports the gap; the user (or a copywriter) provides the copy. Generic AI-written titles hurt SEO and brand voice — the gap matters less than wrong copy.

**Exit:** approved boilerplate is generated; route copy gaps remain reported.

---

## NEVER

- **NEVER invent route-specific titles or descriptions.**
  **Instead:** report each gap with the route path and the user (or content team) supplies the copy.
  **Why:** auto-generated titles are generic and obvious — they hurt the page's SERP appearance more than a missing tag does. Copy is the user's job; the audit's job is to surface where it's missing.

- **NEVER set `noindex` to "fix" a missing description.**
  **Instead:** report the missing description; the user adds copy.
  **Why:** noindex removes the page from search entirely. That's a dramatic action with downstream consequences (lost organic traffic) — never the right fix for a missing meta tag.

- **NEVER recommend keyword stuffing or `<meta name="keywords">`.**
  **Instead:** focus on title, description, headings, and content quality.
  **Why:** the keywords meta tag has been ignored by every major search engine for over a decade. Recommending it makes the audit look out of date and wastes the user's attention.

- **NEVER blanket-add canonical URLs without reading the route.**
  **Instead:** add canonicals where they're needed (variants, query-param URLs, paginated lists). Self-canonicals on a unique route add nothing.
  **Why:** noisy canonicals make audits feel completionist for completionism's sake. Crawlers handle the implicit canonical fine for unique URLs.

- **NEVER auto-fix `robots.txt` to include `Disallow: /` or `Allow: /` blanket rules without confirming with the user.**
  **Instead:** propose the file content, show it, and require `y`.
  **Why:** a wrong robots.txt either hides the whole site from search (Disallow: /) or fails to block private surfaces. Either is a real outage in SEO terms; the user must see what's being written.

- **NEVER report a route as having "OK" SEO based on tags alone.**
  **Instead:** SEO depends on content quality, headings, internal links, performance — none of which this audit checks. Note the audit's scope (meta tags + share previews) explicitly in the report.
  **Why:** declaring a page SEO-OK from meta-tag presence misleads the user into thinking the audit covers more than it does. Stating scope keeps trust calibrated.

- **NEVER assume the project has a sitemap because there's a `/sitemap.xml` file in `public/`.**
  **Instead:** verify it's served and current — fetch it (or read it) and confirm the listed routes match the deployed routes.
  **Why:** stale sitemaps are worse than absent ones — they tell crawlers about pages that 404 or aren't canonical. The check is one fetch.
