import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mcToastLoading } from "~/lib/mc-toast";
import { ApiError, api } from "~/lib/api";
import type { ElectronBridge } from "~/lib/electron";
import {
  buildOptimisticRemoteVmSandbox,
  restoreSandboxesCache,
  upsertSandboxInCache,
  type SandboxesQueryData,
} from "~/lib/optimistic-sandbox";
import { waitForRemoteVmDeployJob } from "~/lib/remote-vm-deploy";
import { queryKeys } from "~/queries";
import { newClientId } from "~/shared/client-id";
import { sandboxWorkspacePath, workspaceSlug } from "~/shared/hosted-workspace";
import { DEFAULT_BRANCH } from "~/shared/domain";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import type { Project } from "~/db/schema";
import type { ProjectSandboxCreateInput } from "~/components/views/ProjectSandboxDialog";
import { setupCommandNeedsPackageJson } from "~/lib/setup-command";
const DEFAULT_AWS_REGION = "us-east-1";
const DEFAULT_AWS_SIZE = "t3.medium";
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;

export function projectSandboxPathName(projectPath: string, fallbackName: string): string {
  return projectPath.split("/").filter(Boolean).pop() || fallbackName || "project";
}

function rootEnvFiles(files: string[]): string[] {
  return files
    .map((file) => file.split("\\").join("/"))
    .filter((file) => !file.includes("/") && (file === ".env" || file.startsWith(".env.")))
    .sort((a, b) => a.localeCompare(b));
}

export function projectSandboxBaseBranch(input: Pick<ProjectSandboxCreateInput, "baseBranch">): string {
  return input.baseBranch.trim() || DEFAULT_BRANCH;
}

/** Init command only — clone already checks out the requested branch. */
export function buildProjectSandboxSetupCommand(
  input: ProjectSandboxCreateInput,
): string | null {
  const init = input.initCommand.trim();
  if (!init) return null;
  return `set -e\n${init}`;
}

const SANDBOX_CONNECT_TIMEOUT_MS = 180_000;

export async function waitForSandboxConnected(
  electron: ElectronBridge,
  sandboxId: string,
  timeoutMs = SANDBOX_CONNECT_TIMEOUT_MS,
): Promise<void> {
  const started = Date.now();
  let triggeredStart = false;
  while (Date.now() - started < timeoutMs) {
    const state = await electron.sandbox.getState(sandboxId).catch(() => null);
    if (state) {
      if (state.status === "connected" || state.status === "update-required") return;
      if (state.status === "error") {
        throw new Error(state.message || "The sandbox failed to start.");
      }
      if (!triggeredStart && (state.status === "stopped" || state.status === "disabled")) {
        triggeredStart = true;
        const up = await electron.sandbox.up(sandboxId);
        if (!up.ok && !/already in progress/i.test(up.error)) {
          throw new Error(up.error || "Could not start the sandbox.");
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "The sandbox did not finish connecting in time. Open its settings → Logs for details.",
  );
}

export async function copyProjectEnvFilesToSandbox(
  electron: ElectronBridge,
  projectRoot: string,
  sandboxRoot: string,
): Promise<string[]> {
  const listed = await electron.files.list(projectRoot);
  if (!listed.ok) throw new Error(`Could not list project files: ${listed.error}`);
  const envFiles = rootEnvFiles(listed.files);
  for (const relPath of envFiles) {
    const read = await electron.files.read(projectRoot, relPath);
    if (!read.ok) throw new Error(`Could not read ${relPath}: ${read.error}`);
    if (read.kind !== "text") throw new Error(`${relPath} is not a text file.`);
    const written = await electron.remoteFs.write(`${sandboxRoot}/${relPath}`, read.content, null);
    if (!written.ok) throw new Error(`Could not copy ${relPath}: ${written.error}`);
  }
  return envFiles;
}

type CreateTerminal = (opts: {
  project: Project & { activeRuntimeScopeId?: string | null };
  name: string;
  startCommand: string;
  cwd?: string;
}) => Promise<unknown>;

const SANDBOX_REPO_READY_TIMEOUT_MS = 30_000;

export async function waitForSandboxSetupReady(
  electron: ElectronBridge,
  sandboxRoot: string,
  setupCommand: string | null,
  timeoutMs = SANDBOX_REPO_READY_TIMEOUT_MS,
): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      await electron.remoteGit.status(sandboxRoot);
      if (setupCommand && setupCommandNeedsPackageJson(setupCommand)) {
        const packageJson = await electron.remoteFs.read(`${sandboxRoot}/package.json`);
        if (!packageJson.ok) {
          lastError = packageJson.error;
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
      }
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `The sandbox repo was not ready at ${sandboxRoot} before setup started${lastError ? `: ${lastError}` : "."}`,
  );
}

export async function createProjectSandbox({
  project,
  input,
  remote,
  electron,
  queryClient,
  router,
  createTerminal,
  onPaywall,
  onError,
  onStarted,
}: {
  project: Project;
  input: ProjectSandboxCreateInput;
  remote: string | null;
  electron: ElectronBridge;
  queryClient: QueryClient;
  router: { navigate: (opts: { to: string; params?: { id: string } }) => void };
  createTerminal: CreateTerminal;
  onPaywall: (context: "sandboxes" | "projects") => void;
  /** Validation or deploy-start failures while the create dialog is still open. */
  onError: (message: string) => void;
  /** Fired once optimistic UI is in place and the AWS deploy job has started. */
  onStarted: () => void;
}): Promise<void> {
  const baseBranch = projectSandboxBaseBranch(input);
  const toastId = mcToastLoading(`Creating ${input.name}…`, {
    description: `Deploying an AWS sandbox, cloning ${baseBranch}, and preparing the project.`,
  });
  let activatedSandboxId: string | null = null;
  let started = false;
  let deploySucceeded = false;
  let previousSandboxes: SandboxesQueryData | undefined;
  try {
    if (!electron.remoteVm) {
      throw new Error("Project sandboxes require the desktop app with AWS remote VM support.");
    }

    const cloneRemote =
      remote ?? (await electron.sandbox.detectRemote(project.path).catch(() => null));
    if (!cloneRemote) {
      throw new Error("This project needs an origin remote before Mission Control can clone it into a sandbox.");
    }

    const pathName = projectSandboxPathName(project.path, project.name);
    const cloneSlug = workspaceSlug(pathName);
    const sandboxRoot = sandboxWorkspacePath(pathName);
    const sandboxId = newClientId("sb");
    previousSandboxes = queryClient.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
    const optimisticSandbox = buildOptimisticRemoteVmSandbox({
      id: sandboxId,
      name: input.name,
      remoteProvider: "aws",
      hasApiKey: true,
      projectId: project.id,
    });
    upsertSandboxInCache(queryClient, optimisticSandbox, { activate: true });
    queryClient.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) =>
      current ? { ...current, enabled: true, activeScopeId: sandboxId } : current,
    );
    activatedSandboxId = sandboxId;

    mcToastLoading(`Deploying ${input.name}…`, {
      id: toastId,
      description: "Provisioning the AWS EC2 instance and agent.",
    });
    let jobId: string;
    try {
      ({ jobId } = await electron.remoteVm.startDeploy({
        provider: "aws",
        sandboxId,
        name: input.name,
        region: DEFAULT_AWS_REGION,
        size: DEFAULT_AWS_SIZE,
        gitAuthMode: "copy-host",
        copyAgentCreds: true,
        idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
        setupScript: input.bootCommand.trim() ? input.bootCommand : undefined,
        imageStrategy: input.imageStrategy,
        projectId: project.id,
        activate: false,
      }));
    } catch (error) {
      restoreSandboxesCache(queryClient, previousSandboxes);
      throw error;
    }

    started = true;
    onStarted();

    const deployJob = await waitForRemoteVmDeployJob(electron, jobId);
    const sandbox = deployJob.result?.sandboxId ?? sandboxId;
    if (sandbox !== activatedSandboxId) activatedSandboxId = sandbox;
    deploySucceeded = true;

    mcToastLoading(`Linking ${input.name}…`, {
      id: toastId,
      description: "Connecting the sandbox to this project.",
    });
    await api.setActiveScope(sandbox);
    await electron.sandbox.setActive(sandbox);
    queryClient.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) =>
      current ? { ...current, activeScopeId: sandbox } : current,
    );

    mcToastLoading(`Connecting to ${input.name}…`, {
      id: toastId,
      description: "Waiting for the remote agent to come online.",
    });
    await waitForSandboxConnected(electron, sandbox);

    mcToastLoading(`Cloning into ${input.name}…`, {
      id: toastId,
      description: "Cloning the repo and preparing the project.",
    });
    await electron.remoteGit.clone(cloneRemote, cloneSlug, baseBranch);

    const setupCommand = buildProjectSandboxSetupCommand(input);
    await waitForSandboxSetupReady(electron, sandboxRoot, setupCommand);

    const copiedEnvFiles = input.copyEnvFiles
      ? await copyProjectEnvFilesToSandbox(electron, project.path, sandboxRoot)
      : [];

    if (setupCommand) {
      await createTerminal({
        project: { ...project, activeRuntimeScopeId: sandbox },
        name: "Sandbox setup",
        startCommand: setupCommand,
        cwd: sandboxRoot,
      });
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
    ]);
    toast.success(`${input.name} is ready`, {
      id: toastId,
      description:
        copiedEnvFiles.length > 0
          ? `Copied ${copiedEnvFiles.length} env file${copiedEnvFiles.length === 1 ? "" : "s"}.`
          : undefined,
    });
    void router.navigate({ to: "/projects/$id", params: { id: project.id } });
  } catch (error) {
    toast.dismiss(toastId);
    if (started && !deploySucceeded) {
      restoreSandboxesCache(queryClient, previousSandboxes);
      await api.setActiveScope(LOCAL_SCOPE_ID).catch(() => undefined);
      await electron.sandbox.setActive(null).catch(() => undefined);
    }
    if (error instanceof ApiError && error.status === 402) {
      const body = error.body as { code?: string } | null;
      onPaywall(body?.code === "free_tier_project_cap" ? "projects" : "sandboxes");
      return;
    }
    const message = error instanceof Error ? error.message : "Could not create sandbox.";
    if (!started) onError(message);
    toast.error(message);
    void queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes });
  }
}
