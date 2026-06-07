import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  activateSandboxScope,
  projectRuntimeScopeId,
  scopeIdToActivate,
} from "../activate-sandbox-scope";
import { buildOptimisticRemoteVmSandbox } from "../optimistic-sandbox";
import { queryKeys } from "~/queries";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";

const setActiveScope = vi.fn();
const listSandboxes = vi.fn();

vi.mock("~/lib/api", () => ({
  api: {
    setActiveScope: (...args: unknown[]) => setActiveScope(...args),
    listSandboxes: (...args: unknown[]) => listSandboxes(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const sandboxState = {
  sandboxes: [
    buildOptimisticRemoteVmSandbox({
      id: "sb-1",
      name: "AWS Dev",
      remoteProvider: "aws",
      projectId: "project-1",
    }),
  ],
  enabled: true,
  activeScopeId: LOCAL_SCOPE_ID,
};

describe("projectRuntimeScopeId", () => {
  it("maps a project-owned sandbox to its runtime scope", () => {
    expect(projectRuntimeScopeId(sandboxState, "project-1", "sb-1")).toBe("sb-1");
  });

  it("falls back to local for sandboxes owned by another project", () => {
    expect(projectRuntimeScopeId(sandboxState, "project-2", "sb-1")).toBe(LOCAL_SCOPE_ID);
  });
});

describe("scopeIdToActivate", () => {
  it("activates the sandbox id when it belongs to the project", () => {
    expect(scopeIdToActivate(sandboxState, "project-1", "sb-1")).toBe("sb-1");
  });
});

describe("activateSandboxScope", () => {
  beforeEach(() => {
    setActiveScope.mockReset();
    listSandboxes.mockReset();
    setActiveScope.mockResolvedValue({ activeScopeId: "sb-1" });
    listSandboxes.mockResolvedValue({
      ...sandboxState,
      activeScopeId: "sb-1",
    });
  });

  it("returns true without calling the API when scope is already active", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.sandboxes, {
      sandboxes: [],
      enabled: true,
      activeScopeId: "sb-1",
    });

    await expect(activateSandboxScope(queryClient, "sb-1")).resolves.toBe(true);
    expect(setActiveScope).not.toHaveBeenCalled();
  });

  it("optimistically updates cache and persists the new active scope", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.sandboxes, sandboxState);

    await expect(activateSandboxScope(queryClient, "sb-1")).resolves.toBe(true);

    expect(queryClient.getQueryData(queryKeys.sandboxes)).toMatchObject({
      activeScopeId: "sb-1",
    });
    expect(setActiveScope).toHaveBeenCalledWith("sb-1");
    expect(listSandboxes).toHaveBeenCalled();
  });

  it("seeds cache when sandboxes have not loaded yet", async () => {
    const queryClient = new QueryClient();

    await expect(activateSandboxScope(queryClient, "sb-1")).resolves.toBe(true);

    expect(queryClient.getQueryData(queryKeys.sandboxes)).toMatchObject({
      activeScopeId: "sb-1",
    });
  });

  it("restores the previous cache when activation fails", async () => {
    setActiveScope.mockRejectedValueOnce(new Error("network"));
    const queryClient = new QueryClient();
    const previous = {
      sandboxes: [],
      enabled: true,
      activeScopeId: LOCAL_SCOPE_ID,
    };
    queryClient.setQueryData(queryKeys.sandboxes, previous);

    await expect(activateSandboxScope(queryClient, "sb-1")).resolves.toBe(false);

    expect(queryClient.getQueryData(queryKeys.sandboxes)).toEqual(previous);
  });
});
