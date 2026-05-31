// Minimal structured logger. mc-agent runs in a container, so stdout/stderr is
// the only observability surface — one JSON object per line that `docker logs`
// captures cleanly. No heavyweight dep (keeps the bundle small).
//
// SECURITY: never pass secrets here — no pairing token, no MC_API_TOKEN, no raw
// request URLs, no file contents, no spawn env.

export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, op: string, fields: Record<string, unknown> = {}): void {
  let line: string;
  try {
    line = JSON.stringify({ level, op, ...fields });
  } catch {
    line = JSON.stringify({ level, op, note: "unserializable fields" });
  }
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}
