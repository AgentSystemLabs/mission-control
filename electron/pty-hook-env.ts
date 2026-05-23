export type PtyHookEnv = {
  apiUrl: string;
  token: string;
};

const MAX_TCP_PORT = 65535;

export function buildLocalMissionControlApiUrl(port: number | null | undefined): string | null {
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > MAX_TCP_PORT) {
    return null;
  }
  return `http://127.0.0.1:${port}`;
}

export function hookEndpointSlug(agent: string | undefined): string {
  if (agent === "codex") return "codex";
  if (agent === "cursor-cli") return "cursor";
  if (agent === "opencode") return "opencode";
  return "claude";
}

export function buildSyntheticHookUrl(
  mcEnv: PtyHookEnv,
  agent: string | undefined,
  taskId: string,
): string | null {
  let base: URL;
  try {
    base = new URL(mcEnv.apiUrl);
  } catch {
    return null;
  }

  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || !base.port) {
    return null;
  }

  const url = new URL(`/api/hooks/${hookEndpointSlug(agent)}`, base);
  url.searchParams.set("taskId", taskId);
  return url.toString();
}
