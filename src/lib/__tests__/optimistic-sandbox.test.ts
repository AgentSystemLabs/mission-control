import { describe, expect, it } from "vitest";
import {
  buildOptimisticRemoteVmSandbox,
  mergeServerSandboxesPreservingPending,
  restoreSandboxesCache,
  upsertSandboxInCache,
  type SandboxesQueryData,
} from "../optimistic-sandbox";
import { queryKeys } from "~/queries";
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
      id: "sb-rail",
      name: "Railway Dev",
      remoteProvider: "railway",
      hasApiKey: true,
    });

    expect(sandbox).toMatchObject({
      remoteProvider: "railway",
      remoteProviderName: "Railway",
      remoteStatus: "provisioning",
      hasApiKey: true,
    });
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
        remoteProvider: "railway",
        hasApiKey: true,
      }),
      { activate: true },
    );

    const state = qc.getQueryData<{ sandboxes: SandboxPublicView[] }>(queryKeys.sandboxes)!;
    expect(state.sandboxes[0]).toMatchObject({
      remoteProvider: "railway",
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
