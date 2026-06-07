import { useEffect, useMemo, useRef, useState } from "react";
import { getElectron } from "~/lib/electron";
import {
  mergeRemoteVmDeployLogs,
  remoteVmDeployJobForSandbox,
} from "~/lib/remote-vm-deploy";
import type { RemoteVmDeployJobSnapshot, RemoteVmDeployLogEntry } from "~/shared/electron-contract";
import type { RemoteVmLifecycleStatus, SandboxPublicView } from "~/shared/sandbox";

export function isRemoteVmDeployActive(job: RemoteVmDeployJobSnapshot | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

export function isSandboxProvisioning(
  sandbox: Pick<SandboxPublicView, "remoteStatus"> | null,
  deployJob: RemoteVmDeployJobSnapshot | null,
): boolean {
  if (!sandbox) return false;
  if (sandbox.remoteStatus === "provisioning") return true;
  return isRemoteVmDeployActive(deployJob);
}

export function useRemoteVmDeployForSandbox(sandboxId: string | null) {
  const electron = getElectron();
  const [deployJobs, setDeployJobs] = useState<RemoteVmDeployJobSnapshot[]>([]);
  const [deployLogs, setDeployLogs] = useState<RemoteVmDeployLogEntry[]>([]);
  const deployLogJobIdRef = useRef<string | null>(null);

  const deployJob = useMemo(
    () => (sandboxId ? remoteVmDeployJobForSandbox(deployJobs, sandboxId) : null),
    [deployJobs, sandboxId],
  );

  useEffect(() => {
    deployLogJobIdRef.current = deployJob?.id ?? null;
  }, [deployJob?.id]);

  useEffect(() => {
    const remoteVm = electron?.remoteVm;
    if (!remoteVm) {
      setDeployJobs([]);
      setDeployLogs([]);
      return;
    }
    let active = true;
    void remoteVm.listDeployJobs().then((nextJobs) => {
      if (active) setDeployJobs(nextJobs);
    });
    const offUpdate = remoteVm.onDeployUpdate((job) => {
      setDeployJobs((current) => {
        const without = current.filter((item) => item.id !== job.id);
        return [job, ...without].sort((a, b) => b.createdAt - a.createdAt);
      });
    });
    const offLog = remoteVm.onDeployLog((entry) => {
      if (entry.jobId !== deployLogJobIdRef.current) return;
      setDeployLogs((current) => mergeRemoteVmDeployLogs(current, [entry]));
    });
    return () => {
      active = false;
      offUpdate();
      offLog();
    };
  }, [electron]);

  useEffect(() => {
    const remoteVm = electron?.remoteVm;
    if (!remoteVm || !deployJob) {
      setDeployLogs([]);
      return;
    }
    setDeployLogs((current) => current.filter((entry) => entry.jobId === deployJob.id));
    let active = true;
    void remoteVm.getDeployLogs(deployJob.id, 0).then((result) => {
      if (!active) return;
      setDeployLogs((current) =>
        mergeRemoteVmDeployLogs(
          current.filter((entry) => entry.jobId === deployJob.id),
          result.entries,
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [deployJob?.id, electron]);

  const deployLogText = useMemo(
    () => deployLogs.map((entry) => entry.data).join(""),
    [deployLogs],
  );

  return {
    deployJob,
    deployLogText,
    isDeployActive: isRemoteVmDeployActive(deployJob),
  };
}

export function sandboxProvisioningStatusCopy(
  remoteStatus: RemoteVmLifecycleStatus | string | null | undefined,
  deployJob: RemoteVmDeployJobSnapshot | null,
): string {
  if (deployJob?.status === "queued") return "Queued for AWS deploy";
  if (deployJob?.status === "running") return "Deploying AWS infrastructure";
  if (remoteStatus === "provisioning") return "Finishing sandbox setup";
  return "Provisioning sandbox";
}
