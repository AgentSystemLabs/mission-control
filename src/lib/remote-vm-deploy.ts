import type { ElectronBridge } from "~/lib/electron";
import type { RemoteVmDeployJobSnapshot, RemoteVmDeployLogEntry } from "~/shared/electron-contract";
export {
  extractRemoteVmDeployError,
  isMissingRemoteInstanceError,
} from "~/shared/remote-vm-deploy-error";

const REMOTE_VM_DEPLOY_TIMEOUT_MS = 30 * 60 * 1000;

export async function waitForRemoteVmDeployJob(
  electron: ElectronBridge,
  jobId: string,
  timeoutMs = REMOTE_VM_DEPLOY_TIMEOUT_MS,
): Promise<RemoteVmDeployJobSnapshot> {
  const remoteVm = electron.remoteVm;
  if (!remoteVm) throw new Error("Remote VM deployment is only available in the desktop app.");

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const jobs = await remoteVm.listDeployJobs();
    const job = jobs.find((entry) => entry.id === jobId);
    if (!job) throw new Error("The deploy job disappeared before it finished.");
    if (job.status === "succeeded") return job;
    if (job.status === "failed") {
      throw new Error(job.error ?? "AWS sandbox deploy failed. Open sandbox settings → Logs for details.");
    }
    if (job.status === "canceled") throw new Error("AWS sandbox deploy was canceled.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("AWS sandbox deploy timed out after 30 minutes.");
}

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
