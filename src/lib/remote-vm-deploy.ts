import type { RemoteVmDeployJobSnapshot, RemoteVmDeployLogEntry } from "~/shared/electron-contract";
export { extractRemoteVmDeployError } from "~/shared/remote-vm-deploy-error";

export function remoteVmDeployStatusCopy(job: RemoteVmDeployJobSnapshot): {
  label: string;
  color: string;
} {
  switch (job.status) {
    case "queued":
      return { label: "Queued", color: "var(--text-dim)" };
    case "running":
      return { label: "Deploying", color: "var(--status-running)" };
    case "succeeded":
      return { label: "Ready", color: "var(--accent)" };
    case "failed":
      return { label: "Failed", color: "var(--status-failed)" };
    case "canceled":
      return { label: "Canceled", color: "var(--text-dim)" };
  }
}

export function mergeRemoteVmDeployLogs(
  current: RemoteVmDeployLogEntry[],
  entries: RemoteVmDeployLogEntry[],
): RemoteVmDeployLogEntry[] {
  const bySeq = new Map<number, RemoteVmDeployLogEntry>();
  for (const entry of current) bySeq.set(entry.seq, entry);
  for (const entry of entries) bySeq.set(entry.seq, entry);
  return Array.from(bySeq.values())
    .sort((a, b) => a.seq - b.seq)
    .slice(-1_000);
}

export function remoteVmDeployJobScopeId(job: RemoteVmDeployJobSnapshot): string | null {
  return job.result?.sandboxId ?? job.input.sandboxId ?? null;
}

export function remoteVmDeployJobForSandbox(
  jobs: RemoteVmDeployJobSnapshot[],
  sandboxId: string,
): RemoteVmDeployJobSnapshot | null {
  const matching = jobs
    .filter((job) => remoteVmDeployJobScopeId(job) === sandboxId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return matching[0] ?? null;
}
