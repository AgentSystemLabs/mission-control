---
title: Grok Build provider research
status: implementation reference
researched_at: 2026-07-31
mission_control_revision: 8dff848c1652c0bb5c3895d5dce28582219092b0
grok_build_revision: dd04f397b1d02f2272b092555669dfba1f01bc85
tested_grok_cli: 0.2.117 (f1c06093089f, stable)
scope: native local managed provider
---

# Grok Build provider research

## Decision summary

Grok Build can be a native Mission Control managed agent. Its CLI provides the
required launch, deterministic session ID, resume, model selection, permission,
headless, version, update, account, and lifecycle-hook primitives.

The first complete support boundary should be a **local managed provider**:

1. Launchable-provider catalog and UI support.
2. CLI discovery, version checks, update guidance, and custom `GROK_HOME`
   handling.
3. Correct new-session and resume commands.
4. Model selection and live model discovery with a static fallback.
5. PTY argument validation and skip-permission authorization.
6. Native Grok hooks, with Grok payload normalization at the HTTP controller
   boundary.
7. Best-effort account detection that honors Grok's supported environment and
   path overrides without exposing credentials.
8. Regression tests and one real local smoke test against the supported minimum
   version.

This provider must not depend on Grok's Claude Code compatibility layer. The
native integration should use Grok's own hook and configuration locations. The
Usage screen is a separate subsystem and is not part of launch-provider support.

Remote sandbox credential forwarding, remote installation, Recall parity, and
Grok billing-window usage are separate capabilities. They should be implemented
and labeled separately instead of being implied by the local provider card.

## Research baseline

| Subject | Revision or observed result | Meaning |
|---|---|---|
| Mission Control | `8dff848c1652c0bb5c3895d5dce28582219092b0` (`0.49.0`) | Baseline before Grok provider implementation |
| Grok Build source | `dd04f397b1d02f2272b092555669dfba1f01bc85` | Primary source for CLI, hooks, auth, and persistence behavior |
| Grok Build source package version | `0.2.116` | The checked-out Rust package manifests identify this version |
| Installed Grok Build | `grok 0.2.117 (f1c06093089f) [stable]` | Locally verified executable for command/output smoke checks |
| Installed model result | default and available model: `grok-4.5` | Local account result on 2026-07-31; not a permanent global catalog claim |

The source checkout and installed binary differ by one patch version. The
source establishes that the required behavior exists by `0.2.116`; the installed
`0.2.117` binary is the version actually exercised. The public changelog does
not establish the first release containing every required contract. Therefore,
`0.2.117` is the conservative tested minimum for the initial Mission Control
integration, not a claim that earlier versions are incompatible.

Official xAI documentation independently confirms interactive/headless use,
custom models, deterministic session IDs, resume, and `--always-approve`:

- [Grok Build overview](https://docs.x.ai/build/overview)
- [CLI reference](https://docs.x.ai/build/cli/reference)
- [Headless scripting](https://docs.x.ai/build/cli/headless-scripting)
- [Permissions](https://docs.x.ai/build/features/permissions)
- [Grok Build changelog](https://x.ai/build/changelog)

The pinned Grok Build source is the authority for details not fully specified in
the public docs.

## Mission Control's launchable-agent pattern

Mission Control does not have one plugin registration point for managed agents.
`TaskAgent` is a cross-cutting domain type, and several security and runtime
registries intentionally remain exhaustive.

| Layer | Existing convention | Grok obligation |
|---|---|---|
| Domain | `TASK_AGENTS` is the canonical union | Add `"grok"` once, then satisfy every exhaustive consumer |
| CLI metadata | `AGENT_CLI_CONFIG` is an exhaustive `Record<TaskAgent, AgentCliConfig>` | Define command, version scheme, minimum, URL, updates, aliases, and paths |
| Provider metadata | `AGENT_REGISTRY` is exhaustive and derives `UI_AGENTS` | Add label, description, command, permission support, start command, and title invocation |
| Design metadata | `AGENT_META` is exhaustive | Add provider color/name metadata consistent with the existing UI |
| Logo | `AgentLogo` maps each agent to an asset | Add a Grok asset and explicit branch |
| Commands | `agent-command.ts` owns persisted-session and new/resume behavior | Add Grok builders and resume recognition; preserve session invariants |
| PTY security | Agent commands are tokenized and validated without a shell | Add only the required flags and gate `--always-approve` on dangerous-permission authorization |
| Electron IPC | `PtySpawnAgent` is a second explicit agent union | Add Grok here; `TASK_AGENTS` alone does not update this boundary |
| Account state | `agent-accounts.ts` uses an exhaustive reader map | Add a read-only Grok reader that never returns secrets |
| Models | Static catalogs and headless invocation are exhaustive; selected providers also have live CLI discovery | Add `grok-4.5` fallback, `grok -p`, and a Grok-specific `grok models` parser |
| Hooks | `agent-hooks.ts` owns provider hook installation and preserves user settings | Add a native Grok-owned hook file and payload normalizer |
| Status | `task-status-sync.ts` declares which agents have usable lifecycle hooks | Add Grok only when the native hooks and edge-case fallbacks are complete |
| Task creation | New tasks explicitly decide whether to preassign a session ID | Use the shared persisted-session predicate; do not retain a Claude/Cursor-only check |
| Remote parity | Sandbox credentials, remote tools, and skill installation use separate explicit maps | Add in a separate remote-support change or clearly report local-only capability |

Primary Mission Control sources:

- [`TASK_AGENTS`](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/shared/domain.ts#L3-L4)
- [`AGENT_CLI_CONFIG`](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/shared/agent-cli-config.ts#L23-L106)
- [`AGENT_REGISTRY`](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/shared/agents.ts#L4-L76)
- [persisted-session command policy](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/lib/agent-command.ts#L8-L166)
- [PTY argument policy](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/shared/pty-spawn-policy.ts#L114-L148)
- [independent Electron agent union](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/shared/electron-contract.ts#L62-L62)
- [task-creation session assignment](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/routes/projects.$id.tsx#L1546-L1558)
- [account reader registry](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/server/services/agent-accounts.ts#L19-L78)
- [runtime model catalog and headless invocation](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/shared/ai-runtime-defaults.ts#L19-L143)
- [live model discovery](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/server/services/ai-runtime-models.ts#L50-L89)

### Registration implication

The Providers settings page and new-session picker already derive from launcher
configuration and the agent registry. They should not receive a second Grok-only
catalog. The implementation should extend the existing sources of truth and let
the normal UI flow render Grok.

### Naming implication

Use the domain ID `grok`, display label `Grok Build`, and command `grok`.
Persisted database fields such as `claudeSessionId` and
`claudeSkipPermissions` are currently provider-neutral in behavior despite their
historical names. Renaming them is a separate migration and should not be mixed
into this provider change unless the repository deliberately chooses a broader
schema refactor.

## Exact Grok CLI contract

The required flags are defined in Grok's top-level pager CLI, not only in its
SDK-oriented `grok agent` subcommand.

| Mission Control operation | Command | Contract |
|---|---|---|
| Interactive launch | `grok` | Starts the native Grok Build TUI |
| New managed session | `grok --session-id <UUID>` | `<UUID>` must be valid and unused in the target working directory |
| Resume managed session | `grok --resume <UUID>` | Resumes that exact stored session; scripts should use IDs rather than titles |
| Select model | append `--model <MODEL>` | Model is a single CLI argument |
| Skip approvals | append `--always-approve` | Alias `--yolo`; must use Mission Control's dangerous-permission authorization |
| Headless title generation | `grok -p <PROMPT>` | Single-turn output to stdout |
| Version | `grok --version` or `grok version --json` | Installed output is parseable as semantic version `0.2.117` |
| Models | `grok models` | Authenticated, runtime-derived list; output is decorated text |
| Update | `grok update` | Native updater; `grok update --check --json` supports checking |
| Sign in | `grok login` | Interactive/device/OAuth flows are owned by Grok |

Sources:

- [Grok command and subcommand definitions](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-pager/src/app/cli.rs#L47-L121)
- [top-level permission, headless, model, resume, and session-ID flags](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-pager/src/app/cli.rs#L446-L595)
- [`grok models` output implementation](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-pager/src/models.rs#L10-L41)

### Recommended CLI metadata

```ts
grok: {
  agent: "grok",
  command: "grok",
  label: "Grok Build",
  versionScheme: "semver",
  minimumVersion: "0.2.117",
  packageUrl: "https://docs.x.ai/build/overview",
  updateCommands: ["grok update"],
  homePathSuffixes: [".grok/bin"],
}
```

Do not add an npm package: Grok's supported updater is the CLI. The default
install location is `$GROK_HOME/bin/grok`, where `GROK_HOME` defaults to
`~/.grok`. Mission Control's current `homePathSuffixes` mechanism joins suffixes
to the OS home directory, so `.grok/bin` only handles the default case. Native
custom setup support also requires prepending `${GROK_HOME}/bin` when
`GROK_HOME` is a valid configured path. Grok's own path resolution is defined
in [`paths.rs`](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-config/src/paths.rs#L14-L68).

## Session lifecycle invariants

### New and resume are not interchangeable

`--session-id` is a create-only flag. Grok validates that the value is a UUID
and rejects a session ID already persisted for the working directory. Resume
must use `--resume`.

Grok also creates `summary.json` during `session/new`, before the user submits a
prompt. An idle launch followed by exit has therefore consumed its assigned
session ID.

Sources:

- [new-ID preflight](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-pager/src/app/session_startup.rs#L462-L503)
- [resumable session requires `summary.json`](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/session/persistence.rs#L405-L427)
- [new-session persistence initialization](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/session/persistence.rs#L2486-L2502)
- [`summary.json` is written immediately for a new session](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/session/storage/jsonl/mod.rs#L1388-L1405)

### Required Mission Control behavior

```text
first launch of an allocated task ID
  -> grok --session-id <UUID>

every later launch of that same Grok session
  -> grok --resume <UUID>

fresh/duplicate session
  -> allocate a different UUID
  -> grok --session-id <new UUID>
```

Task status alone is not a reliable new/resume discriminator. In particular,
Mission Control currently leaves a process that exits while the task is still
`ready` in that settled status. Relaunching it as “new” reuses the now-occupied
UUID and fails. The implementation needs an explicit first-launch/persisted
signal or a Grok-specific session-end/PTY-exit transition that makes subsequent
launches resume. This must be covered by an idle-launch regression test.

### Initial input

Mission Control may inject a starting prompt only for a genuine new session.
A resumed Grok command should not receive the old initial input again. This
matches the existing `shouldInjectInitialInput` policy for other persisted
agents.

## Model discovery

Observed `grok models` output:

```text
You are logged in with grok.com.

Default model: grok-4.5

Available models:
  * grok-4.5 (default)
```

The existing `parsePlainModelList` accepts only lines that already consist of a
valid model ID. It will reject Grok's bullet and `(default)` decoration and may
misinterpret future banner text. Add a Grok-specific parser that:

1. Starts after `Available models:`.
2. Accepts `*` and `-` bullets.
3. Removes a terminal ` (default)` marker.
4. Validates the remaining token with Mission Control's existing model-ID
   grammar.
5. Deduplicates while preserving Grok's output order.

`grok models` starts the Grok backend and reflects account/configured models.
It may fail when unauthenticated, offline, or misconfigured. Preserve Mission
Control's existing cache and static-catalog fallback behavior. Use `grok-4.5`
as the initial fallback because the checked-in Grok guide identifies it as the
new-session default and the installed CLI returned it; live discovery remains
authoritative for custom models.

The selected model must also be forwarded by the generic headless runtime:

```text
grok -p <PROMPT> --model <MODEL>
```

## PTY security policy

Mission Control directly spawns managed agents and validates the tokenized
arguments. Grok needs this narrow policy:

| Argument | Value | Additional rule |
|---|---|---|
| `--session-id` | required UUID | New sessions only |
| `--resume` | required UUID | Existing managed sessions only |
| `--model` | required valid Mission Control model ID | Single token; no shell syntax |
| `--always-approve` | no value | Require `dangerouslySkipPermissions === true` |

Do not allow `--trust`. Grok's `--trust` persists a folder-wide trust decision
that enables project hooks, MCP servers, and LSP servers together. Mission
Control should not grant that broad user decision implicitly.

Add tests for every allowed argument, missing values, invalid UUIDs, invalid
model IDs, shell metacharacters, unknown flags, and `--always-approve` with and
without authorization.

## Native Grok hooks

### Installation decision

Install one Mission Control-owned native file:

```text
${GROK_HOME:-~/.grok}/hooks/mission-control.json
```

Do not write `.claude/settings.local.json` for Grok and do not enable
`[compat.claude] hooks`. The user can keep all Claude compatibility disabled.

The global native location is the correct default because:

- `$GROK_HOME/hooks/*.json` is always trusted.
- Project `.grok/hooks/*.json` is silently skipped until the user trusts the
  folder.
- Grok's folder-trust grant also enables project MCP and LSP configuration, so
  Mission Control should not auto-grant it.
- A global hook can remain inert outside Mission Control because MC injects
  task/API variables only into managed sessions.
- An exact Mission Control filename keeps the integration isolated from sibling
  hook files. Managed groups inside that file can be replaced idempotently while
  preserving any non-Mission-Control groups already present there.

Honor `GROK_HOME`; fall back to the platform home plus `.grok`. Update only
Mission Control-marked groups in `mission-control.json`. Preserve every sibling
user or managed hook source and never modify `config.toml`.

Grok's hook locations, trust boundary, event list, and JSON structure are
documented in its [native hook guide](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md#L59-L156).

### Why the existing hook command failed

Grok preflights plain environment references in shell hook commands. If an
unresolved variable such as `${MC_TASK_ID}` appears, Grok refuses to execute the
hook and reports it as required-but-unset. Parameter-expansion modifier forms
are intentionally exempt because they explicitly handle the unset case.

Every Mission Control variable reference in the generated command must use a
modifier form, not only the initial guard:

```sh
${MC_TASK_ID:-}
${MC_API_URL:-}
${MC_API_TOKEN:-}
```

The command should:

1. Exit successfully when the task ID or API URL is empty.
2. Read the Grok JSON payload from stdin.
3. POST it to the local Mission Control hook endpoint with bearer auth.
4. Discard stdout for all Grok events.
5. Swallow connection errors and timeouts so Mission Control cannot block the
   Grok session.

Discarding stdout is deliberate. Grok's `Stop` and `SubagentStop` events parse
hook output for turn-control decisions. Mission Control is observing status,
not controlling whether Grok may stop. Its ordinary `{ok: true}` API response
must never become an accidental gate decision.

Use a command hook rather than Grok's HTTP-hook type. Grok HTTP hooks require a
public HTTPS target and apply SSRF protections; Mission Control's endpoint is an
authenticated loopback HTTP endpoint. The relevant runner behavior is in
[`command.rs`](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-hooks/src/runner/command.rs#L85-L175) and its [modifier-aware preflight](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-hooks/src/runner/command.rs#L307-L353).

### Native event set

Install these events for the local managed provider:

| Grok event | Matcher | Mission Control use |
|---|---|---|
| `SessionStart` | none | Capture/confirm session identity and trigger normal session-start services |
| `UserPromptSubmit` | none | `running` and prompt history |
| `Stop` | none | `finished` for genuine turn completion |
| `StopFailure` | none | Move an API-error turn out of `running`; recommended status is `interrupted` |
| `Notification` | `permission_prompt` | `needs-input` before tool, plan, or diff approval waits |
| `PreToolUse` | `ask_user_question` | `needs-input`; metadata only unless a Grok answer adapter is implemented |
| `PostToolUse` | `ask_user_question` | Return to `running` |
| `SubagentStart` | none | Active-subagent bookkeeping |
| `SubagentStop` | none | Active-subagent bookkeeping |
| `SessionEnd` | none | Settle an idle process/session and preserve resume semantics |

Grok emits `Notification` with `notificationType: "permission_prompt"`
immediately before ordinary tool permission and plan approval waits. Mission
Control already treats that precise notification type as `needs-input`; no
terminal-screen scraping is required for those waits. Sources:

- [tool permission notification before the wait](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/session/acp_session_impl/tool_calls.rs#L1207-L1220)
- [plan approval notification before the wait](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/session/acp_session_impl/tool_calls.rs#L1535-L1573)
- [Mission Control's existing notification mapping](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/shared/agent-hook-events.ts#L35-L78)

### Payload normalization

Mission Control's controller currently parses Claude-style snake-case fields.
Grok serializes a camel-case envelope and lower-snake-case event values. Add a
normalizer before the existing Zod/domain logic so downstream status code keeps
one canonical representation.

| Grok payload | Mission Control canonical payload |
|---|---|
| `hookEventName: "session_start"` | `hook_event_name: "SessionStart"` |
| `hookEventName: "user_prompt_submit"` | `hook_event_name: "UserPromptSubmit"` |
| `hookEventName: "pre_tool_use"` | `hook_event_name: "PreToolUse"` |
| `hookEventName: "post_tool_use"` | `hook_event_name: "PostToolUse"` |
| `hookEventName: "stop_failure"` | `hook_event_name: "StopFailure"` |
| `sessionId` | `session_id` |
| `transcriptPath` | `transcript_path` |
| `notificationType` | `notification_type` |
| `toolName` | `tool_name` |
| `toolUseId` | `tool_use_id` |
| `toolInput` | `tool_input` |
| `toolResult` | `tool_response` |
| `lastAssistantMessage` | `last_assistant_message` |
| `subagentId` | `agent_id` |

Normalize only recognized fields and preserve the existing request-size and
schema validation boundary. Grok's full envelope is defined in
[`event.rs`](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-hooks/src/event.rs#L316-L501); Mission Control's current schema is in
[`hooks.controller.ts`](https://github.com/AgentSystemLabs/mission-control/blob/8dff848c1652c0bb5c3895d5dce28582219092b0/src/server/controllers/hooks.controller.ts#L38-L77).

#### Tool-name normalization

Grok's native questionnaire tool is `ask_user_question`; Mission Control's
canonical constant is `AskUserQuestion`. Normalize the tool name for status
mapping, or teach the mapping to recognize both spellings.

Do not enable Mission Control's native question-answer overlay for Grok merely
because the payload parses. The existing answer encoder was built and verified
against Claude's TUI keystrokes. Until a Grok-specific answer transport is
implemented and tested, let Grok render and answer its own questionnaire while
Mission Control reports `needs-input`.

#### Subagent session reconciliation

For Grok, `SubagentStart` is emitted by the parent actor, while
`SubagentStop` is emitted by the child actor and its envelope's `sessionId` is
the child session. Mission Control identifies the parent task through the URL's
`taskId` and pairs lifecycle events through `subagentId`.

For both subagent lifecycle events, normalize `subagentId` to `agent_id` but
omit `session_id` from session reconciliation. Otherwise the child's
`sessionId` is rejected as a foreign task session and the stop never drains the
active-subagent count. The parent and child emission paths are visible in
[`updates.rs`](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/session/acp_session_impl/updates.rs#L491-L509) and
[`stop_gate.rs`](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/session/acp_session_impl/stop_gate.rs#L210-L231).

For every non-subagent Grok event, keep the preassigned task UUID authoritative.
A different top-level `sessionId` can come from a nested Grok process that
inherited Mission Control's environment; treating it as a capture event would
silently replace the parent task's resume identity.

### Status gaps that need explicit handling

Grok `Stop` fires on genuine completion, not on user interrupt. API-error turns
fire `StopFailure`. A native-hook-capable classification therefore needs:

- `StopFailure -> interrupted` or another explicit non-running error status.
- A Grok-specific interrupt/idle backstop for Esc/Ctrl+C, because the CLI may
  remain open and PTY process exit will not fire.
- PTY process-exit handling for the case where the whole CLI exits.
- `SessionEnd`/idle-exit coverage so a consumed UUID is resumed on the next
  launch.

Without these, a task can remain `running` after an interrupted turn or can try
to create an already-persisted ready session. Grok documents its completion and
failure semantics in the [native event table and stop behavior](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md#L84-L103).

### Recall and context injection are not hook-equivalent

Mission Control currently keeps stdout from Claude's `SessionStart` and
`UserPromptSubmit` hooks so Claude can consume `additionalContext`. Grok's
ordinary observe hooks do not provide the same context-injection contract.
Posting the event successfully does not give Grok proactive Recall parity.

Use Mission Control's existing file/skill-based Session Brief and Recall path,
or add a verified Grok-native context mechanism. Do not enable Claude
compatibility solely to obtain this behavior.

## Account detection

Grok supports more than one credential source:

| Source | Behavior Mission Control should recognize |
|---|---|
| `GROK_AUTH` | Inline JSON `GrokAuth`; highest-priority credential source |
| `GROK_AUTH_PATH` | Overrides the default auth-file path |
| `$GROK_HOME/auth.json` | Default auth file; `$GROK_HOME` defaults to `~/.grok` |
| `XAI_API_KEY` | Supported API-key authentication |
| `GROK_CODE_XAI_API_KEY` | Legacy API-key fallback still accepted by Grok |
| Per-model/deployment configuration | Valid for some installations but not cheaply represented by the current synchronous account reader |

`auth.json` is not one flat credential object. It is a map from auth scope to
`GrokAuth`. Each entry contains a secret `key` plus metadata such as
`auth_mode`, `user_id`, optional `email`, refresh token, and expiry.

Implementation requirements:

1. Treat a non-empty supported API-key environment credential as connected
   without returning its value.
2. Parse a valid, usable `GROK_AUTH` object first. If it is malformed, continue
   to the file source, matching Grok's fallback behavior.
3. Resolve `GROK_AUTH_PATH`, then `GROK_HOME`, then `~/.grok/auth.json`.
4. Parse the file as an object of credential entries.
5. Require at least one structurally usable entry rather than file existence
   alone.
6. Prefer a non-empty email for the UI identifier, then user ID; otherwise use
   `null`.
7. Never log, return, snapshot, or test with the `key` or refresh token.
8. Fail closed to `connected: false` when no usable environment or file source
   remains.

This is credential-presence detection, consistent with Mission Control's other
provider cards; it is not a network reachability or entitlement check. Full
recognition of per-model BYOK and managed deployment credentials would require
parsing Grok's effective layered TOML configuration or a future machine-readable
Grok auth-status command.

Sources:

- [`GROK_HOME` resolution](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-config/src/paths.rs#L14-L47)
- [`GROK_AUTH_PATH` and `GROK_AUTH` precedence](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/auth/manager.rs#L279-L324)
- [`GrokAuth` fields and map storage](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/auth/model.rs#L26-L105)
- [`XAI_API_KEY` and legacy fallback](https://github.com/xai-org/grok-build/blob/dd04f397b1d02f2272b092555669dfba1f01bc85/crates/codegen/xai-grok-shell/src/agent/auth_method.rs#L23-L43)

## Local support boundary and follow-up parity

### Required in the initial native provider

- Provider card and new-session picker visibility.
- Defaults/settings normalization through the standard `TASK_AGENTS` flow.
- CLI availability, version, minimum-version, update, and PATH behavior.
- New, resume, model, title, and skip-permission commands.
- PTY validation.
- Native hook installation and payload normalization.
- Working lifecycle status, including failure/interruption and idle-relaunch
  edge cases.
- Account state.
- Live model discovery with catalog fallback.
- Local launch and resume smoke test.

### Separate remote sandbox work

Remote parity needs explicit design and tests for:

- Remote Grok installation/update.
- A remote credential type and destination path.
- `GROK_HOME`, `GROK_AUTH_PATH`, `GROK_AUTH`, and API-key policy on the remote
  host without leaking secrets into logs.
- Native hook installation inside the remote environment.
- Recall and diagram skills under `.grok/skills` or the shared `.agents/skills`
  location.
- Remote model discovery and version checks.

Do not silently copy the entire `.grok` directory. It contains more than auth
and may include user configuration, sessions, memory, plugins, and hooks. Copy
only an explicit, reviewed credential/config subset over Mission Control's
encrypted credential transport.

### Separate Usage-provider work

The Usage screen monitors provider billing/rate-limit windows. Its adapter
catalog is independent from launchable agents, and the existing Grok adapter
does not implement the protocol required to fetch billing data. Native launch
support should neither re-enable that unsupported adapter nor claim usage
monitoring support.

## Required tests

### Registry and settings

- `TASK_AGENTS`, `AGENT_CLI_CONFIG`, `AGENT_REGISTRY`, design metadata, and
  Electron unions stay synchronized.
- Launcher normalization preserves Grok in order and visibility settings.
- Providers and new-session derivations include Grok without a second catalog.

### CLI and commands

- Version parser accepts `grok 0.2.117 (f1c06093089f) [stable]`.
- Default and custom `GROK_HOME/bin` discovery.
- New command with UUID, model, and optional `--always-approve`.
- Resume command with the same UUID.
- Resume recognition.
- Fresh duplicate allocates a different UUID.
- Initial input is not replayed on resume.
- Headless invocation forwards model selection.

### Session lifecycle

- First launch uses `--session-id`.
- Exit before the first prompt, then relaunch, uses `--resume`.
- Finished and interrupted tasks resume.
- A new task never receives an existing Grok UUID.
- Session-end and PTY-exit events do not leave an occupied session classified as
  first-launch `ready`.

### PTY policy

- Allow only the four required flags and valid values.
- Reject unknown flags, missing values, bad UUIDs, invalid model IDs, and shell
  metacharacters.
- Reject `--always-approve` without dangerous-permission authorization.

### Hooks

- Installer honors `GROK_HOME`, owns only marked groups in one exact file, and
  preserves all sibling hook files and user config.
- Installer is idempotent and replaces only its own marked groups.
- Generated POSIX and Windows commands handle missing `MC_*` variables without
  Grok's unresolved-env error.
- Camel-case payloads normalize to the existing canonical schema.
- `notificationType: permission_prompt` becomes `needs-input`.
- `StopFailure` moves the task out of `running`.
- `ask_user_question` maps status without using Claude keystroke injection.
- Subagent start/stop pair through `subagentId`; child `sessionId` is not rejected
  as foreign.
- Curl stdout cannot affect Grok Stop/SubagentStop decisions.

### Accounts and models

- Default auth file, custom `GROK_HOME`, custom `GROK_AUTH_PATH`, inline auth,
  API key, malformed file, and absent credentials.
- Tests assert returned values and logs never contain credential secrets.
- Model parser handles authenticated banners, `*`/`-` bullets, default marker,
  duplicates, malformed lines, empty output, and custom valid model IDs.
- Model-discovery failure falls back to the static catalog.

### Manual acceptance

Against Grok Build `0.2.117` or the chosen higher minimum:

1. Grok appears in Settings → Providers and New Session.
2. Account and CLI status are correct for default and custom home paths.
3. A managed session starts, accepts a prompt, completes, and updates status.
4. A permission request reaches `needs-input` before the prompt is answered.
5. Closing before the first prompt and reopening resumes successfully.
6. Closing after a completed turn and reopening preserves conversation history.
7. A selected model is passed to Grok.
8. Skip approvals is present only when explicitly enabled.
9. Native hooks work while `[compat.claude] hooks = false`.
10. A normal Grok terminal outside Mission Control produces no Mission Control
    hook errors or requests.

## Corrections and additions to the initial diagnosis

| Initial statement | Research result |
|---|---|
| Grok needs terminal fallback for permission waiting because there is no `PermissionRequest` event | Grok emits native `Notification` / `permission_prompt` immediately before tool, plan, and diff approval waits; normalize it and use the existing status mapping |
| The existing `.claude` hook file can provide full integration | It conflicts with the intended native configuration and depends on a compatibility layer the user disabled; use a native global Grok hook file |
| `${MC_*:-}` is needed in the hook guard | Every MC variable reference in the entire command needs modifier syntax, including URL and authorization header references |
| Adding `grok` to `TASK_AGENTS` reaches all launch boundaries | Electron has an independent `PtySpawnAgent` union, and task creation has a hard-coded persisted-session check |
| `grok --session-id <UUID>` is sufficient for ready tasks | Grok writes the session summary at startup; an idle launch consumes the UUID, so later launch must resume even when no prompt was submitted |
| The generic plain model parser can consume `grok models` | Grok emits banners, headings, bullet markers, and `(default)` decoration; it needs a dedicated parser |
| Camel-case field mapping is enough for subagents | A child `SubagentStop` carries the child envelope session ID; session reconciliation must use task ID + `subagentId`, not treat the child as the task session |
| Hook success gives Recall parity | Grok observe-hook stdout is not Claude's `additionalContext` channel; use a native verified file/skill mechanism |
| AskUserQuestion normalization enables the native MC overlay | The current response encoder is Claude-TUI-specific; status can be native now, but answer injection needs a separate Grok adapter and tests |
| Local provider support implies sandbox and Usage support | These are separate explicit systems and need separate implementation and user-facing capability reporting |

## Acceptance definition

Native local Grok Build support is complete when a user with Claude
compatibility disabled can select Grok in Mission Control, launch a managed
session, choose a model, explicitly enable or withhold automatic approvals,
receive accurate lifecycle/permission status, close and resume the same session
without UUID errors, and use default or custom Grok home/auth paths without
Mission Control rewriting unrelated Grok configuration.

Remote sandbox, Recall-context, and Usage support are complete only when their
separate acceptance tests pass; the presence of a Grok provider card does not
stand in for those capabilities.
