import { parseLaunchCommands } from "~/shared/domain";

type LaunchSession = {
  ptyId: string | null;
  terminal: { startCommand: string | null };
};

export function getLaunchCommandSet(raw: string | null | undefined): Set<string> {
  return new Set(
    parseLaunchCommands(raw)
      .map((c) => c.command.trim())
      .filter(Boolean)
  );
}

export function hasRunningLaunchSessions(
  sessions: readonly LaunchSession[],
  launchCommandSet: ReadonlySet<string>
): boolean {
  if (launchCommandSet.size === 0) return false;
  return sessions.some(
    (s) =>
      s.ptyId &&
      s.terminal.startCommand &&
      launchCommandSet.has(s.terminal.startCommand.trim())
  );
}

export function hasRunningLaunchForProject(
  projectId: string,
  launchCommandsRaw: string | null | undefined,
  sessionsByScope: Readonly<Record<string, readonly LaunchSession[]>>
): boolean {
  const launchCommandSet = getLaunchCommandSet(launchCommandsRaw);
  if (launchCommandSet.size === 0) return false;
  for (const [scopeKey, sessions] of Object.entries(sessionsByScope)) {
    if (!scopeKey.startsWith(`${projectId}:`)) continue;
    if (hasRunningLaunchSessions(sessions, launchCommandSet)) return true;
  }
  return false;
}
