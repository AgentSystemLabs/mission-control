export type ClaudeLaunchMode =
  | {
      kind: "new";
      sessionId: string;
      skipPermissions: boolean;
      bareSession?: boolean;
      model?: string | null;
    }
  | {
      kind: "resume";
      sessionId: string;
      skipPermissions: boolean;
      bareSession?: boolean;
      model?: string | null;
    };

export function buildClaudeCommand(mode: ClaudeLaunchMode): string {
  const parts = ["claude"];
  if (mode.bareSession) parts.push("--bare");
  if (mode.kind === "new") parts.push("--session-id", mode.sessionId);
  else parts.push("--resume", mode.sessionId);
  if (mode.model) parts.push("--model", mode.model);
  if (mode.skipPermissions) parts.push("--dangerously-skip-permissions");
  return parts.join(" ");
}

export function newSessionId(): string {
  return crypto.randomUUID();
}
