/** Highest valid TCP port number (2^16 − 1). */
export const MAX_TCP_PORT = 65_535;

export function isValidTcpPort(port: number | null | undefined): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= MAX_TCP_PORT;
}
