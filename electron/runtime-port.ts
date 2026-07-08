import { isValidTcpPort, MAX_TCP_PORT } from "../src/shared/tcp-port";

export { isValidTcpPort, MAX_TCP_PORT };

export const DEFAULT_DEV_SERVER_PORT = 5173;

export function nextTcpPort(port: number | null | undefined): number | null {
  if (!isValidTcpPort(port) || port >= MAX_TCP_PORT) return null;
  return port + 1;
}

export function preferredProductionRuntimePort(
  previousPort: number | null | undefined,
  opts: { devServerPort?: number | null | undefined } = {},
): number | null {
  if (!isValidTcpPort(previousPort)) return null;
  if (previousPort === DEFAULT_DEV_SERVER_PORT) return null;

  if (isValidTcpPort(opts.devServerPort) && previousPort === opts.devServerPort) {
    return null;
  }

  return previousPort;
}

export function productionRuntimePortStart(
  previousPort: number | null | undefined,
  opts: { devServerPort?: number | null | undefined } = {},
): number {
  const devServerPort = isValidTcpPort(opts.devServerPort)
    ? opts.devServerPort
    : DEFAULT_DEV_SERVER_PORT;
  const preferredPort = preferredProductionRuntimePort(previousPort, { devServerPort });
  if (preferredPort) return preferredPort;

  return nextTcpPort(devServerPort) ?? nextTcpPort(DEFAULT_DEV_SERVER_PORT) ?? 1;
}
