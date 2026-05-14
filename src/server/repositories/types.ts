import type { Group, Project, Task, UserTerminal } from "~/db/schema";
import type { LaunchCommand, TaskStatus } from "~/shared/domain";
import type { ProjectWithCounts } from "~/shared/projects";
import type { UsageSummary } from "~/shared/token-usage";

export type RepoMode = "sqlite" | "postgres";

export type UserScope = {
  userId?: string | null;
};

export type ProjectCreateInput = {
  name?: string;
  path: string;
  icon?: string;
  iconColor?: string;
  imageDataUrl?: string | null;
  groupId?: string | null;
  runtimeKind?: string;
  ownerUserId?: string | null;
  sandboxId?: string | null;
  workspacePath?: string | null;
  repoUrl?: string | null;
  sandboxState?: string | null;
  pro: boolean;
};

export type ProjectUpdatePatch = Partial<
  Pick<
    Project,
    | "name"
    | "path"
    | "icon"
    | "iconColor"
    | "imagePath"
    | "imageDataUrl"
    | "groupId"
    | "pinned"
    | "branch"
    | "launchUrl"
    | "runtimeKind"
    | "ownerUserId"
    | "sandboxId"
    | "workspacePath"
    | "repoUrl"
    | "sandboxState"
    | "rememberAgentSettings"
    | "savedAgent"
    | "savedSkipPermissions"
    | "savedBareSession"
  >
> & { launchCommands?: LaunchCommand[] | null };

export type DeletedProjectInfo = {
  deleted: boolean;
  existing: Project | null;
  taskIds: string[];
  userTerminalIds: string[];
};

export class RepositoryProjectCapExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
  ) {
    super(`Project cap exceeded (${current}/${limit})`);
    this.name = "RepositoryProjectCapExceededError";
  }
}

export type TaskCreateInput = {
  projectId: string;
  title: string;
  agent: Task["agent"];
  branch?: string;
  status?: TaskStatus;
  preview?: string;
  claudeSessionId?: string | null;
  claudeSkipPermissions?: boolean;
  claudeBareSession?: boolean;
};

export type StatusUpdateResult = {
  task: Task;
  previousStatus: TaskStatus;
  projectName: string;
} | null;

export type StoredLicenseState = {
  key: string | null;
  status: "active" | "invalid" | null;
  plan: string | null;
  lastValidatedAt: string | null;
  payload: unknown | null;
};

export interface ProjectRepository {
  list(scope?: UserScope): Promise<ProjectWithCounts[]>;
  get(id: string): Promise<ProjectWithCounts | null>;
  getRow(id: string): Promise<Project | null>;
  create(input: ProjectCreateInput): Promise<Project>;
  update(id: string, patch: ProjectUpdatePatch, scope?: UserScope): Promise<Project | null>;
  togglePin(id: string): Promise<Project | null>;
  delete(id: string): Promise<DeletedProjectInfo>;
  refreshBranch(id: string, branch: string): Promise<string | null>;
}

export interface GroupRepository {
  list(scope?: UserScope): Promise<Group[]>;
  create(input: { name: string; color?: string; ownerUserId?: string | null }): Promise<Group>;
  update(id: string, patch: Partial<Pick<Group, "name" | "color">>, scope?: UserScope): Promise<Group | null>;
  delete(id: string, scope?: UserScope): Promise<boolean>;
}

export interface TaskRepository {
  listForProject(projectId: string): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  create(input: TaskCreateInput): Promise<Task>;
  updateStatus(id: string, patch: { status?: TaskStatus; preview?: string; lines?: number }): Promise<StatusUpdateResult>;
  update(
    id: string,
    patch: Partial<Pick<Task, "title" | "branch" | "claudeSessionId" | "claudeSkipPermissions" | "claudeBareSession">>,
  ): Promise<Task | null>;
  archive(id: string): Promise<Task | null>;
  restore(id: string): Promise<Task | null>;
  delete(id: string): Promise<{ deleted: boolean; existing: Task | null }>;
  appendTerminalLog(taskId: string, chunk: string): Promise<void>;
  readTerminalLog(taskId: string): Promise<string>;
}

export interface UserTerminalRepository {
  list(projectId: string): Promise<UserTerminal[]>;
  purgeLaunchSpawned(projectId?: string): Promise<number>;
  create(input: {
    projectId: string;
    name?: string;
    cwd?: string | null;
    startCommand?: string | null;
  }): Promise<UserTerminal>;
  rename(id: string, name: string): Promise<UserTerminal | null>;
  delete(id: string): Promise<{ deleted: boolean; projectId: string | null }>;
  getProjectId(id: string): Promise<string | null>;
}

export interface SettingsRepository {
  get(key: string, scope?: UserScope): Promise<string | null>;
  set(key: string, value: string, scope?: UserScope): Promise<void>;
  delete(key: string, scope?: UserScope): Promise<void>;
}

export interface UsageRepository {
  syncTokenUsage(): Promise<number>;
  getUsageSummary(daysBack?: number, scope?: UserScope): Promise<UsageSummary>;
  resetSyncSingleton(): void;
}

export interface AppRepositories {
  mode: RepoMode;
  projects: ProjectRepository;
  groups: GroupRepository;
  tasks: TaskRepository;
  userTerminals: UserTerminalRepository;
  settings: SettingsRepository;
  usage: UsageRepository;
}
