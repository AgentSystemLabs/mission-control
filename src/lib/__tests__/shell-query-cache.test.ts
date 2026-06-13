import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectWithCounts } from "~/shared/projects";
import {
  SHELL_QUERY_CACHE_KEYS,
  installShellQueryCache,
  readCachedProjects,
} from "../shell-query-cache";

function mockWindowStorage() {
  const store = new Map<string, string>();
  const previousWindow = globalThis.window;

  globalThis.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  } as unknown as Window & typeof globalThis;

  return {
    store,
    restore() {
      globalThis.window = previousWindow;
    },
  };
}

function makeProject(overrides: Partial<ProjectWithCounts> = {}): ProjectWithCounts {
  return {
    id: "project-1",
    name: "Core",
    path: "/tmp/core",
    icon: "folder",
    iconColor: "#ffffff",
    imagePath: null,
    groupId: null,
    sandboxId: null,
    pinned: true,
    pinnedOrder: 0,
    branch: "main",
    launchCommands: null,
    customScripts: null,
    launchUrl: null,
    worktreeSetupCommand: null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    createdAt: 1,
    updatedAt: 1,
    taskCounts: {
      ready: 0,
      running: 0,
      "needs-input": 0,
      interrupted: 0,
      finished: 0,
      terminated: 0,
      disconnected: 0,
      total: 0,
      activeNonDone: 0,
    },
    ...overrides,
  };
}

describe("shell query cache", () => {
  let storage: ReturnType<typeof mockWindowStorage>;

  beforeEach(() => {
    storage = mockWindowStorage();
  });

  afterEach(() => {
    storage.restore();
  });

  it("persists shell queries when the query cache receives fresh data", () => {
    const queryClient = new QueryClient();
    const projects = [makeProject()];

    installShellQueryCache(queryClient);
    queryClient.setQueryData(["projects"], projects);

    expect(readCachedProjects()).toEqual(projects);
  });

  it("ignores similarly-prefixed detail query keys", () => {
    const queryClient = new QueryClient();
    const projects = [makeProject({ id: "detail" })];

    installShellQueryCache(queryClient);
    queryClient.setQueryData(["projects", "detail"], projects);

    expect(readCachedProjects()).toBeUndefined();
  });

  it("ignores cache envelopes from older versions", () => {
    storage.store.set(
      SHELL_QUERY_CACHE_KEYS.projects,
      JSON.stringify({ version: 0, savedAt: Date.now(), data: [makeProject()] }),
    );

    expect(readCachedProjects()).toBeUndefined();
  });
});
