# Provider usage (CodexBar fork)

Mission Control hosts a **TypeScript/Electron port** of CodexBar's multi-provider
usage-limits capability. The Swift app is the behavioral reference; the runtime
is Windows + macOS inside this app — not `CodexBar.app`.

## Surface

| Piece | Location |
| --- | --- |
| Shared types + full provider catalog | `src/shared/provider-usage.ts` |
| Pure normalize (Claude / Codex / Cursor + API-key providers) | `src/shared/provider-usage-normalize.ts` |
| Aggregator + adapters | `src/server/services/provider-usage/` |
| HTTP | `GET /api/provider-usage?providers=claude,codex,cursor` |
| Legacy Claude-only | `GET /api/claude-usage-limits` (unchanged) |
| Compact top-bar control | `ProviderUsageIndicator` (settings-gated) |
| Settings | Settings → Usage |

## Data model

`ProviderUsageSnapshot` carries `status` (`ok | unauthenticated | rate_limited |
error`) and `windows[]`. A window has either a real meter
(`utilization: 0–100` + optional `resetsAt`) **or** is meterless
(`utilization: null` + `detail: "$12.34"`) for prepaid balances and other
value-not-percent providers. Adapters never fabricate a 0% bar for unknown
usage and never report `unavailable` for a merely-unimplemented provider —
missing credentials are `unauthenticated`, protocol gaps are `error` with an
explanatory message.

## Adapter tiers

Every CodexBar `UsageProvider` id routes to a live adapter. After the
fact-check against the CodexBar Swift sources they fall into three tiers:

**Full (real usage windows, fact-checked against CodexBar)** —
Claude (statusline-tap cache + Anthropic OAuth usage, sonnet/opus model-week
slot, 401→unauthenticated / 403→error), Codex (`$CODEX_HOME/auth.json` →
`chatgpt_base_url`-aware wham/usage, CodexRateWindowNormalizer window roles),
Cursor (state.vscdb JWT with expiry check → usage-summary, full
CursorStatusProbe plan-percent precedence chain incl. team/enterprise ratios),
OpenCode Go (local `opencode.db` cost sums vs $12/$30/$60 plan windows),
Windsurf (local `state.vscdb` `cachedPlanInfo`; daily/weekly are *remaining*
percents → `100 − remaining`), Copilot (`copilot_internal/user` with Copilot
editor headers; zero-entitlement snapshots dropped), Kilo (tRPC batch
`user.getCreditBlocks`; `*_mUsd` micro-USD), Gemini (gemini-cli OAuth creds →
`retrieveUserQuota`), plus the API-key providers (OpenRouter, DeepSeek,
Moonshot, ElevenLabs, Poe, Crof, Venice, Kimi K2, Z.ai, Kimi, Synthetic,
Chutes, Codebuff, CrossModel, LLM Proxy, LiteLLM, ClawRouter, MiniMax, Devin,
Manus, Perplexity, T3 Chat, MiMo, Qoder, Abacus, Augment, CommandCode,
Sakana, StepFun, Mistral, Doubao, Factory) with endpoints/fields corrected to
the CodexBar Swift truth.

**Meterless-but-honest** — providers whose API exposes a value, not a percent:
balances/spend render as `detail` text (OpenAI org spend, Deepgram project
balance, Amp displayText, Moonshot/Poe/DeepSeek balances, CrossModel
micro-USD, Ollama local model count, Wayfinder gateway health, Azure OpenAI
deployment probe, Groq key check).

**Honest gaps** — CodexBar reaches these through protocols this port
deliberately does not implement (gRPC-web/protobuf, SigV4 signing, scraped
console `sec_token`s, private GraphQL schemas, CLI JSON-RPC). With credentials
present they return `error` naming the gap; without credentials,
`unauthenticated`: Warp, Grok, Bedrock (unless `CODEXBAR_BEDROCK_API_URL` is
set), Vertex AI, Kiro, both Alibaba plans, OpenCode (web `/_server` protocol),
Windsurf web fallback, MiniMax web-cookie path.

## Credentials

Resolution order everywhere: env vars → `~/.codexbar/config.json` (or
`~/.config/codexbar/config.json`) provider entries → CLI auth files → cookies.
Bare cookie-token env values are wrapped with the provider's real cookie name
(e.g. Perplexity's `__Secure-next-auth.session-token`, Kimi's `kimi-auth`) —
never a guessed `session=`. Windows and macOS file locations are both probed
(e.g. Cursor/Windsurf `%APPDATA%\…\state.vscdb` vs
`~/Library/Application Support/…`). No secrets are logged; tests inject fake
readers/fixtures.

## UI placement

Opt-in master toggle (`providerUsageEnabled`, default off). When on, a single
compact control appears in the top-bar right cluster: a small utilization ring
plus the worst window across enabled providers (`codex 91%`). Clicking opens a
CardFrame popover with per-provider windows (bar + % + reset, or detail text
for meterless windows), auth help for unauthenticated providers, refresh, and
a shortcut to Settings → Usage. Disabled ⇒ no chrome at all.

Settings → Usage: searchable provider chip-grid over the full catalog with
live status dots, a "Needs sign-in" list naming each adapter's expected env
var / config entry / auth file, and Claude session/weekly window toggles when
Claude is enabled.
