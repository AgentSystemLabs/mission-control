# Observability Decision

Resolves two **MED** items in `AUDIT_FOLLOWUPS.md`:
- "MED — structured error reporter"
- "MED — basic metrics (latency/failure) on hot IPC + API paths"

Both were blocked on a product decision. This document records the recommendation, the reasoning, and the cheapest stopgap that needs no third-party choice (already applied this commit).

## Context that drives both decisions

- Mission Control is a **single-user desktop Electron app** with an **embedded local-only HTTP server** (`src/server/api-router.ts`) bound to localhost. There are no multi-tenant servers, no orgs, no SREs.
- The existing telemetry surface (`src/server/services/telemetry.ts`) is **fire-and-forget, opt-in by virtue of an install file**, and reports only two coarse events (`app_launch`, `session_started`) plus install ID, app version, OS platform/release. No PII, no stack traces, no request payloads. This is the privacy posture any new reporter must respect.
- Logs already land in `stderr` as structured JSON via `electron/logger.ts` / `src/shared/logger.ts`, with a redaction allowlist for tokens/secrets.

Any reporter or metrics shipper must (a) be opt-in, (b) not break the no-network-required offline grace, (c) not leak file paths / repo contents / API tokens beyond what the user has already accepted in the existing telemetry consent.

---

## 1. Error reporter

| Option | Cost | Integration effort | What it buys us | What it doesn't |
|---|---|---|---|---|
| **Sentry (paid)** | Free tier covers <5k events/mo; paid starts ~$26/mo | Low — official `@sentry/electron` package wraps both main + renderer, source-maps via CLI | Symbolicated stacks, release health, breadcrumb trails, native crash capture (Crashpad) | Tied to a SaaS vendor; sends event data off-device by default; legal/privacy posture for individual users using a local-only tool is awkward |
| **GlitchTip (self-host, OSS)** | Free if self-hosted; managed ~$15/mo | Medium — Sentry-protocol-compatible, so `@sentry/electron` SDK works against it; we'd run/maintain a server | Same SDK surface as Sentry; we control the data; OSS friendly | Operational cost of running a server for a desktop app; small project, narrower native-crash coverage than Sentry |
| **Highlight** | Free tier; paid from ~$50/mo | Medium — has Electron support but designed around session replay which is overkill (and a privacy non-starter) here | Session replay, full-stack tracing | Privacy-hostile by default for a desktop app; replay of a user's repo file tree is a hard no |
| **Skip — desktop-only, single user** | $0 | None | Keeps the privacy posture intact; logs already land in stderr + log file; users can attach `mission-control.log` to bug reports | No aggregated trend visibility; "did this crash for many users" remains invisible |

### Recommendation: **Skip a third-party reporter; invest in local log retention + a "Report a problem" flow.**

Reasoning:
1. Mission Control is **not** a multi-user SaaS where aggregated error trends pay back the privacy cost.
2. The current telemetry consent covers two anonymous events. Pushing every unhandled error to a SaaS expands that scope dramatically — would require new consent UI, new legal copy, new redaction guarantees.
3. The cheapest win is a **local rotating log file** (already partially in place via stderr) plus a renderer "Report a problem" action that bundles the latest log + sysinfo into a tarball the user can attach to a GitHub issue. This gets us the same outcome (root-causing user-reported crashes) at zero recurring cost and zero privacy surface area.
4. If user volume grows and we ever ship a **paid Pro tier with explicit error-reporting opt-in**, revisit **Sentry** (lowest integration effort) first — but only as opt-in behind the same telemetry toggle.

**Follow-up tickets:**
- Add log rotation + a fixed retention window in `electron/logger.ts` (size-capped file in `~/.mission-control/logs/`).
- Add a "Report a problem" menu item that opens the log directory and prefills a GitHub issue template.
- Defer SaaS reporter until at least 100 active installs and a Pro tier ship.

---

## 2. Metrics (latency / failure rates on hot paths)

| Option | Cost | Integration effort | What it buys us | What it doesn't |
|---|---|---|---|---|
| **OpenTelemetry SDK** | Free | High — multiple packages (`@opentelemetry/sdk-node`, exporter, instrumentations); needs a collector or backend (Honeycomb, Grafana Cloud, etc.) | Industry-standard traces + metrics, span propagation across processes | Huge dependency footprint for a desktop app; needs a backend; overkill for "is `pty.spawn` getting slower" |
| **statsd client** | Free if self-hosted | Medium — `hot-shots` client is tiny, but needs a statsd server somewhere | Mature push-metrics model | Same backend problem as OTel; nothing to push to on a user's laptop |
| **prom-client (Prometheus)** | Free | Medium — exposes `/metrics` HTTP endpoint to scrape | Local `/metrics` endpoint, no backend required for inspection during dev | Pull model assumes a scraper; not useful in a shipped desktop app where nothing is scraping |
| **Minimal in-app rolling ring** | $0 | Low — a ~50-line `Metrics` module: ring buffer of recent durations per op, `p50`/`p95`/error-rate computed on read, exposed in a "Diagnostics" panel | Live numbers the user (and we, in bug reports) can read; zero deps; aligns with the privacy posture | No historical trend; no fleet-wide aggregation |

### Recommendation: **Minimal in-app rolling ring + `duration_ms` on existing structured logs.**

Reasoning:
1. The actionable use of metrics here is "is X getting slower" and "is X failing often" — both answerable from a rolling window of the last N=1000 samples per op, computed lazily.
2. `duration_ms` on existing log lines (the stopgap below) is already 80% of the value for free: anyone reading the log can grep + sort.
3. A Diagnostics panel surfacing `p50 / p95 / error-rate` per hot op closes the remaining 20% without adding a network dependency or a new SaaS account.
4. If we ever want fleet-wide perf insight, attach **percentile summaries** (not individual samples) to the existing opt-in telemetry payload at app exit. Same consent, same anonymous shape.

**Follow-up tickets:**
- Add `src/shared/metrics.ts`: `record(op: string, durationMs: number, ok: boolean)` + `snapshot(): Record<op, {p50,p95,n,errRate}>`.
- Wrap hot ops (`pty.spawn`, `files.*`, `skills.install`, `/api/*` handlers) with the recorder.
- Add a "Diagnostics" tab under Settings that renders `snapshot()`.
- (Later, behind telemetry opt-in) include percentile summary in `app_launch` / `app_exit` telemetry payload.

---

## 3. Stopgap actions applied in this commit

Per the instruction to apply the cheapest no-third-party-choice stopgap now, scoped to **only** `electron/file-handlers.ts` (the only one of the four hot-path files not currently in flight):

- Wrapped each IPC handler (`filesList`, `filesRead`, `filesWrite`, `filesWatch`, `filesUnwatch`) with `Date.now()` start / end.
- On success, emits `logger.info("ipc.<channel>", { durationMs, ... })`.
- On failure, emits `logger.warn("ipc.<channel>.err", { durationMs, err, ... })`.
- **Did not** change handler return shapes or any caller-visible behavior.
- **Did not** touch `electron/pty-manager.ts`, `electron/agent-hooks.ts`, `electron/install-skills.ts`, or `src/server/api-router.ts` — those will get the same wrapper once their respective in-flight work lands.

Verified with `pnpm typecheck`.
