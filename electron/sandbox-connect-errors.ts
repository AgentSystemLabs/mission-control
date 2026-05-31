export const CONNECT_BUDGET_REMOTE_MS = 90_000;
export const CONNECT_BUDGET_LOCAL_MS = 180_000;

export type ConnectFailureKind = "auth" | "host" | "tls" | "transient";

export function connectBudgetMs(kind: "local-docker" | "remote-vm"): number {
  return kind === "remote-vm" ? CONNECT_BUDGET_REMOTE_MS : CONNECT_BUDGET_LOCAL_MS;
}

export function connectTimeoutMessage(kind: "local-docker" | "remote-vm", budgetMs: number): string {
  const budgetSec = Math.round(budgetMs / 1000);
  return kind === "remote-vm"
    ? `Couldn't connect to the remote agent after ${budgetSec}s. Check the agent URL and API key, then try again.`
    : `Couldn't connect to the sandbox agent after ${budgetSec}s. Try again or check Docker logs.`;
}

export function classifyConnectError(err: Error): { kind: ConnectFailureKind; message: string } {
  const msg = err.message.toLowerCase();

  if (/401|403|unauthorized|invalid.*(api key|token|bearer)|authentication failed/.test(msg)) {
    return { kind: "auth", message: "Invalid API key. Check the remote agent key in sandbox settings." };
  }
  if (/enotfound|getaddrinfo|eai_again|dns|nxdomain/.test(msg)) {
    return { kind: "host", message: "Can't reach host. Check the agent URL and network." };
  }
  if (/cert|tls|ssl|self signed|unable to verify/.test(msg)) {
    return { kind: "tls", message: "Secure connection failed. Check TLS/certificate settings for the agent URL." };
  }
  if (/econnrefused|connection refused/.test(msg)) {
    return {
      kind: "host",
      message: "Connection refused. Is the agent running and reachable at this URL?",
    };
  }

  return { kind: "transient", message: err.message };
}

export function isFailFastConnectError(kind: ConnectFailureKind): boolean {
  return kind !== "transient";
}
