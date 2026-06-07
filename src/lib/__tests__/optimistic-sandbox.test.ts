import { describe, expect, it } from "vitest";
import {
  buildOptimisticRemoteVmSandbox,
  buildOptimisticRemoteVmSandboxFromDeployJob,
  markSandboxStoppedInCache,
  markSandboxStoppingInCache,
  mergeServerSandboxesPreservingPending,
  removeSandboxFromCache,
  restoreSandboxesCache,
  updateSandboxRemoteStatusInCache,
  upsertSandboxInCache,
  type SandboxesQueryData,
} from "../optimistic-sandbox";
import { queryKeys } from "~/queries";
import type { RemoteVmDeployJobSnapshot } from "~/shared/electron-contract";
import { LOCAL_SCOPE_ID, type SandboxPublicView } from "~/shared/sandbox";

function createQueryClientStub() {
  const cache = new Map<string, unknown>();
  return {
    setQueryData: <T,>(key: readonly unknown[], updater: T | ((current: T | undefined) => T)) => {
      const current = cache.get(JSON.stringify(key)) as T | undefined;
      const next = typeof updater === "function" ? (updater as (c: T | undefined) => T)(current) : updater;
      cache.set(JSON.stringify(key), next);
      return next;
    },
    getQueryData: <T,>(key: readonly unknown[]) => cache.get(JSON.stringify(key)) as T | undefined,
  };
}

describe("optimistic-sandbox", () => {
  it("builds a remote VM placeholder before deploy persistence finishes", () => {
    const sandbox = buildOptimisticRemoteVmSandbox({
      id: "sb-pending",
      name: "AWS Dev",
      createdAt: 123,
    });

    expect(sandbox).toMatchObject({
      id: "sb-pending",
      name: "AWS Dev",
      kind: "remote-vm",
      remoteAgentUrl: null,
      hasApiKey: false,
      createdAt: 123,
    });
  });

  it("marks managed cloud deploys as provisioning with a provider label", () => {
    const sandbox = buildOptimisticRemoteVmSandbox({
      id: "sb-aws",
      name: "AWS Dev",
      remoteProvider: "aws",
      hasApiKey: true,
    });

    expect(sandbox).toMatchObject({
      remoteProvider: "aws",
      remoteProviderName: "AWS EC2",
      remoteStatus: "provisioning",
      hasApiKey: true,
    });
  });

  it("builds deploy-job placeholders with the owning project id", () => {
    const job = {
      id: "job-1",
      input: {
        provider: "aws",
        sandboxId: "sb-project",
        name: "Project Dev",
        region: "us-east-1",
        projectId: "p-project",
      },
      status: "running",
      createdAt: 123,
      startedAt: 124,
      updatedAt: 125,
      finishedAt: null,
      nextSeq: 1,
    } satisfies RemoteVmDeployJobSnapshot;

    const sandbox = buildOptimisticRemoteVmSandboxFromDeployJob(job);

    expect(sandbox).toMatchObject({
      id: "sb-project",
      name: "Project Dev",
      remoteProvider: "aws",
      remoteStatus: "provisioning",
      projectId: "p-project",
    });
  });

  it("preserves an existing owning project id when replaying a deploy job without one", () => {
    const existing = buildOptimisticRemoteVmSandbox({
      id: "sb-existing",
      name: "Existing",
      projectId: "p-project",
    });
    const job = {
      id: "job-1",
      input: {
        provider: "aws",
        sandboxId: "sb-existing",
        name: "Existing",
        region: "us-east-1",
      },
      status: "queued",
      createdAt: 123,
      startedAt: null,
      updatedAt: 123,
      finishedAt: null,
      nextSeq: 1,
    } satisfies RemoteVmDeployJobSnapshot;

    const sandbox = buildOptimisticRemoteVmSandboxFromDeployJob(job, existing);

    expect(sandbox?.projectId).toBe("p-project");
  });

  it("adds and selects an optimistic sandbox in the shared query cache", () => {
    const qc = createQueryClientStub();
    const sandbox = buildOptimisticRemoteVmSandbox({ id: "sb-pending", name: "AWS Dev" });

    upsertSandboxInCache(qc as never, sandbox, { activate: true });

    const state = qc.getQueryData<{
      sandboxes: SandboxPublicView[];
      enabled: boolean;
      activeScopeId: string;
    }>(queryKeys.sandboxes)!;
    expect(state.enabled).toBe(true);
    expect(state.activeScopeId).toBe("sb-pending");
    expect(state.sandboxes.map((item) => item.id)).toEqual(["sb-pending"]);
  });

  it("merges managed provider onto an existing row without dropping a saved agent URL", () => {
    const qc = createQueryClientStub();
    const persisted = {
      ...buildOptimisticRemoteVmSandbox({ id: "sb-real", name: "Persisted" }),
      remoteAgentUrl: "wss://agent.example.com/",
      hasApiKey: true,
    } satisfies SandboxPublicView;
    qc.setQueryData(queryKeys.sandboxes, {
      sandboxes: [persisted],
      enabled: true,
      activeScopeId: LOCAL_SCOPE_ID,
    });

    upsertSandboxInCache(
      qc as never,
      buildOptimisticRemoteVmSandbox({
        id: "sb-real",
        name: "Pending",
        remoteProvider: "aws",
        hasApiKey: true,
      }),
      { activate: true },
    );

    const state = qc.getQueryData<{ sandboxes: SandboxPublicView[] }>(queryKeys.sandboxes)!;
    expect(state.sandboxes[0]).toMatchObject({
      remoteProvider: "aws",
      remoteAgentUrl: "wss://agent.example.com/",
      hasApiKey: true,
    });
  });

  it("preserves a persisted sandbox when the optimistic row is replayed", () => {
    const qc = createQueryClientStub();
    const persisted = {
      ...buildOptimisticRemoteVmSandbox({ id: "sb-real", name: "Persisted" }),
      remoteAgentUrl: "wss://agent.example.com/",
      hasApiKey: true,
    } satisfies SandboxPublicView;
    qc.setQueryData(queryKeys.sandboxes, {
      sandboxes: [persisted],
      enabled: true,
      activeScopeId: LOCAL_SCOPE_ID,
    });

    upsertSandboxInCache(
      qc as never,
      buildOptimisticRemoteVmSandbox({ id: "sb-real", name: "Pending" }),
      { activate: true },
    );

    const state = qc.getQueryData<{
      sandboxes: SandboxPublicView[];
      enabled: boolean;
      activeScopeId: string;
    }>(queryKeys.sandboxes)!;
    expect(state.activeScopeId).toBe("sb-real");
    expect(state.sandboxes[0]).toMatchObject({
      remoteAgentUrl: "wss://agent.example.com/",
      hasApiKey: true,
    });
  });

  it("marks a sandbox as stopping and switches the active scope back to Local", () => {
    const qc = createQueryClientStub();
    qc.setQueryData(queryKeys.sandboxes, {
      sandboxes: [
        buildOptimisticRemoteVmSandbox({
          id: "sb-stopping",
          name: "Stopping",
          remoteProvider: "aws",
          remoteStatus: "ready",
        }),
      ],
      enabled: true,
      activeScopeId: "sb-stopping",
    });

    markSandboxStoppingInCache(qc as never, "sb-stopping", { switchActiveToLocal: true });

    const state = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes)!;
    expect(state.activeScopeId).toBe(LOCAL_SCOPE_ID);
    expect(state.sandboxes[0]).toMatchObject({
      remoteStatus: "pausing",
      remoteStatusMessage: null,
    });
  });

  it("updates a stopped sandbox status without moving an unrelated active scope", () => {
    const qc = createQueryClientStub();
    qc.setQueryData(queryKeys.sandboxes, {
      sandboxes: [
        buildOptimisticRemoteVmSandbox({
          id: "sb-stopped",
          name: "Stopped",
          remoteProvider: "aws",
          remoteStatus: "pausing",
        }),
      ],
      enabled: true,
      activeScopeId: LOCAL_SCOPE_ID,
    });

    markSandboxStoppedInCache(qc as never, "sb-stopped");

    const state = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes)!;
    expect(state.activeScopeId).toBe(LOCAL_SCOPE_ID);
    expect(state.sandboxes[0]).toMatchObject({
      remoteStatus: "paused",
      remotePublicAddress: null,
    });
  });

  it("ignores remote status updates for missing sandbox rows", () => {
    const qc = createQueryClientStub();
    const previous: SandboxesQueryData = {
      sandboxes: [],
      enabled: true,
      activeScopeId: LOCAL_SCOPE_ID,
    };
    qc.setQueryData(queryKeys.sandboxes, previous);

    updateSandboxRemoteStatusInCache(qc as never, "sb-missing", { remoteStatus: "pausing" });

    expect(qc.getQueryData(queryKeys.sandboxes)).toEqual(previous);
  });

  describe("mergeServerSandboxesPreservingPending", () => {
    const serverState = (
      sandboxes: SandboxPublicView[],
      activeScopeId = LOCAL_SCOPE_ID,
    ): SandboxesQueryData => ({ sandboxes, enabled: true, activeScopeId });

    it("keeps a pending deploy the server hasn't persisted yet and holds the active scope on it", () => {
      const pending = buildOptimisticRemoteVmSandbox({
        id: "sb-pending",
        name: "AWS Dev",
        remoteProvider: "aws",
      });

      const merged = mergeServerSandboxesPreservingPending(serverState([]), [pending], "sb-pending");

      expect(merged.sandboxes.map((s) => s.id)).toEqual(["sb-pending"]);
      expect(merged.activeScopeId).toBe("sb-pending");
      expect(merged.enabled).toBe(true);
    });

    it("lets the server row win once persisted while a deploy is still in flight", () => {
      const persisted: SandboxPublicView = {
        ...buildOptimisticRemoteVmSandbox({ id: "sb-pending", name: "AWS Dev", remoteProvider: "aws" }),
        remoteAgentUrl: "wss://1.2.3.4:8443/",
        remoteStatus: "provisioning",
      };
      const pending = buildOptimisticRemoteVmSandbox({
        id: "sb-pending",
        name: "AWS Dev",
        remoteProvider: "aws",
      });

      const merged = mergeServerSandboxesPreservingPending(
        serverState([persisted], LOCAL_SCOPE_ID),
        [pending],
        "sb-pending",
      );

      expect(merged.sandboxes).toHaveLength(1);
      expect(merged.sandboxes[0].remoteAgentUrl).toBe("wss://1.2.3.4:8443/");
      // The server doesn't switch scopes until deploy success, so the optimistic
      // selection is preserved while the job is still pending.
      expect(merged.activeScopeId).toBe("sb-pending");
    });

    it("preserves the active scope when the selected sandbox is already on the server", () => {
      const existing = buildOptimisticRemoteVmSandbox({ id: "sb-real", name: "Real" });
      const merged = mergeServerSandboxesPreservingPending(
        serverState([existing], LOCAL_SCOPE_ID),
        [],
        "sb-real",
      );

      expect(merged.sandboxes.map((s) => s.id)).toEqual(["sb-real"]);
      expect(merged.activeScopeId).toBe("sb-real");
    });

    it("defers entirely to the server when nothing is pending", () => {
      const existing = buildOptimisticRemoteVmSandbox({ id: "sb-real", name: "Real" });
      const merged = mergeServerSandboxesPreservingPending(
        serverState([existing], "sb-real"),
        [],
        "sb-pending",
      );

      expect(merged.sandboxes.map((s) => s.id)).toEqual(["sb-real"]);
      expect(merged.activeScopeId).toBe("sb-real");
    });

    it("does not hijack the active scope for a pending row that isn't selected", () => {
      const pending = buildOptimisticRemoteVmSandbox({ id: "sb-pending", name: "Pending" });
      const merged = mergeServerSandboxesPreservingPending(
        serverState([], "local"),
        [pending],
        "local",
      );

      expect(merged.sandboxes.map((s) => s.id)).toEqual(["sb-pending"]);
      expect(merged.activeScopeId).toBe("local");
    });
  });

  it("removes a sandbox from the cache and switches the active scope to Local", () => {
    const qc = createQueryClientStub();
    qc.setQueryData(queryKeys.sandboxes, {
      sandboxes: [
        buildOptimisticRemoteVmSandbox({ id: "sb-delete", name: "Delete Me" }),
        buildOptimisticRemoteVmSandbox({ id: "sb-keep", name: "Keep Me" }),
      ],
      enabled: true,
      activeScopeId: "sb-delete",
    });

    removeSandboxFromCache(qc as never, "sb-delete", { switchActiveToLocal: true });

    const state = qc.getQueryData<SandboxesQueryData>(queryKeys.sandboxes)!;
    expect(state.activeScopeId).toBe(LOCAL_SCOPE_ID);
    expect(state.sandboxes.map((sandbox) => sandbox.id)).toEqual(["sb-keep"]);
  });

  it("restores the previous sandbox cache after a failed optimistic write", () => {
    const qc = createQueryClientStub();
    const previous = {
      sandboxes: [],
      enabled: true,
      activeScopeId: LOCAL_SCOPE_ID,
    };
    qc.setQueryData(queryKeys.sandboxes, previous);

    upsertSandboxInCache(
      qc as never,
      buildOptimisticRemoteVmSandbox({ id: "sb-pending", name: "Pending" }),
      { activate: true },
    );
    restoreSandboxesCache(qc as never, previous);

    expect(qc.getQueryData(queryKeys.sandboxes)).toEqual(previous);
  });
});
