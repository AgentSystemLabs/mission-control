export type ClaudeLaunchMode =
  | { kind: "new"; sessionId: string; skipPermissions: boolean }
  | { kind: "resume"; sessionId: string; skipPermissions: boolean };

export function buildClaudeCommand(mode: ClaudeLaunchMode): string {
  const parts = ["claude"];
  if (mode.kind === "new") parts.push("--session-id", mode.sessionId);
  else parts.push("--resume", mode.sessionId);
  if (mode.skipPermissions) parts.push("--dangerously-skip-permissions");
  return parts.join(" ");
}

export function newSessionId(): string {
  return crypto.randomUUID();
}
