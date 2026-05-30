import { describe, it, expect } from "vitest";
import {
  workspaceSlug,
  hostedWorkspacePath,
  sandboxWorkspacePath,
  SANDBOX_WORKSPACE_ROOT,
  HOSTED_WORKSPACE_ROOT,
} from "../hosted-workspace";

describe("workspaceSlug", () => {
  it("lowercases, replaces non-alphanumerics, and trims dashes", () => {
    expect(workspaceSlug("Acme Web App")).toBe("acme-web-app");
    expect(workspaceSlug("  My_Project!! ")).toBe("my-project");
    expect(workspaceSlug("foo/bar")).toBe("foo-bar");
  });
  it("falls back to 'project' for empty/symbol-only names", () => {
    expect(workspaceSlug("")).toBe("project");
    expect(workspaceSlug("***")).toBe("project");
  });
});

describe("sandboxWorkspacePath", () => {
  it("maps a project name to /workspace/<slug>", () => {
    expect(sandboxWorkspacePath("Acme Web")).toBe(`${SANDBOX_WORKSPACE_ROOT}/acme-web`);
    expect(sandboxWorkspacePath("")).toBe(`${SANDBOX_WORKSPACE_ROOT}/project`);
  });
  it("uses the same slug as the hosted path (different root)", () => {
    expect(sandboxWorkspacePath("My App")).toBe("/workspace/my-app");
    expect(hostedWorkspacePath("My App")).toBe(`${HOSTED_WORKSPACE_ROOT}/my-app`);
  });
});
