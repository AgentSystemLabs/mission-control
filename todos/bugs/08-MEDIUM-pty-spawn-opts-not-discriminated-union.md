# [MEDIUM] `pty.spawn` opts type accepts `{ agent, shell: true }` at compile time, rejected only at runtime

**Files:** `src/shared/electron-contract.ts:97-113`, `electron/preload.ts:63-77`, `electron/pty-spawn-policy.ts:14-29`
**Category:** Type contract weaker than runtime contract
**Severity:** Medium
**Surfaced by:** reviewer-contracts on bug 05 fix (2026-05-16)

## What's wrong

The renderer-facing pty.spawn type currently looks like:

```ts
spawn: (opts: {
  taskId: string;
  cwd: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  agent?: string;
  mcEnv?: { apiUrl?: string; token?: string };
  shell?: boolean;
}) => Promise<{ ptyId: string }>;
```

`agent` and `shell` are independent optional fields. The runtime policy (`pty-spawn-policy.ts:142-167`) enforces that *exactly one* must be set — `shell: true` with `agent: "claude-code"` throws `shell-with-agent`; neither set throws `missing-agent-or-shell-flag`. But TypeScript accepts every combination.

Result: a renderer call site can pass `{ agent: "claude-code", shell: true }` and the bug isn't caught until the IPC reply rejects it.

## Why fixing this is important — what could go wrong

The whole reason the `shell: true` flag exists is to force every call site to be *explicit* about which trust boundary it's crossing — agent allow-list vs. user-shell-execute. If the type doesn't enforce that, a future renderer change can casually pass `shell: true` to an agent spawn (or vice versa) and the mistake only surfaces at runtime, on a user's machine, as a confusing toast.

Specifically:

- The runtime check is defensive; the type system is preventive. We have one, not the other.
- A migration that flipped `agent` to required (because every current call site sets it) would silently lose the `shell: true` opt-in flag from UserTerminalPane.tsx and reintroduce bug 05's class of mistake.

## How to fix it

Convert the opts type to a discriminated union:

```ts
type BasePtySpawn = {
  taskId: string;
  cwd: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  mcEnv?: { apiUrl?: string; token?: string };
};

type AgentSpawn = BasePtySpawn & {
  agent: "claude-code" | "codex" | "cursor-cli";
  shell?: never;
};

type ShellSpawn = BasePtySpawn & {
  shell: true;
  agent?: never;
};

spawn: (opts: AgentSpawn | ShellSpawn) => Promise<{ ptyId: string }>;
```

Mirror in `src/shared/electron-contract.ts` and `electron/pty-spawn-policy.ts:SpawnRequest`. Re-export the agent enum from a single canonical source (likely `~/shared/domain` or a new `~/shared/spawn-contract.ts`) so policy.ts and the renderer types can't drift.

Existing call sites already conform: `TerminalPane.tsx` sets `agent` and not `shell`; `UserTerminalPane.tsx` sets `shell: true` and not `agent`. The change is a pure tightening.

## Notes

This is a follow-up to the bug-05 fix; the runtime check stays as belt-and-suspenders for IPC payloads that could be hand-crafted from a compromised renderer (TypeScript doesn't protect the IPC channel itself).
