import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import {
  DEFAULT_BRANCH,
  DEFAULT_TASK_STATUS,
  LAUNCH_COMMANDS_MAX,
  CUSTOM_SCRIPTS_MAX,
  TASK_AGENTS,
  TASK_STATUSES,
  parseLaunchCommands,
  parseCustomScripts,
  isActiveStatus,
  isTerminalStatus,
  type LaunchCommand,
  type CustomScript,
  type TaskAgent,
  type TaskStatus,
} from "~/shared/domain";
import { type DiagramFormat } from "~/shared/diagram";
import { LOCAL_SCOPE_ID, type SandboxKind, type SandboxGitAuthMode } from "~/shared/sandbox";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdAt: integer("created_at").notNull(),
});

// An isolated execution environment (its own container today; remote VM later).
// Projects are scoped to exactly one sandbox, or to Local (sandboxId = null).
// JSON-shaped columns (buildArgs/declaredPorts/env/portMap/remoteConfig) are
// stored as TEXT and parsed at the service boundary. See docs/multi-sandbox-plan.md.
export const sandboxes = sqliteTable("sandboxes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").$type<SandboxKind>().notNull().default("remote-vm"),
  color: text("color"),
  // --- fully-independent runtime config (user-set) ---
  imageTag: text("image_tag"),
  dockerfilePath: text("dockerfile_path"),
  buildArgs: text("build_args"), // JSON: Record<string,string>
  gitAuthMode: text("git_auth_mode").$type<SandboxGitAuthMode>().notNull().default("none"),
  // When true, the host's AI-CLI logins (Claude/Codex/Cursor/OpenCode) are pushed
  // to the VM over the agent WS on connect — mirrors gitAuthMode's copy-host.
  copyAgentCreds: integer("copy_agent_creds", { mode: "boolean" }).notNull().default(false),
  declaredPorts: text("declared_ports"), // JSON: number[] (container ports)
  env: text("env"), // JSON: Record<string,string>
  // --- managed (MC-derived) ---
  hostAgentPort: integer("host_agent_port"),
  portMap: text("port_map"), // JSON: Record<containerPort, hostPort>
  pairingToken: text("pairing_token"),
  // --- remote-vm config ---
  remoteConfig: text("remote_config"), // JSON
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    icon: text("icon").notNull(),
    iconColor: text("icon_color").notNull(),
    imagePath: text("image_path"),
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    // Scope: null = Local (host). Otherwise the owning sandbox. Deleting a sandbox
    // cascades its projects (and their tasks/worktrees) away — the "destroy
    // everything" delete semantics. `path` is host-absolute for Local projects and
    // an in-container workspace path for sandboxed projects.
    sandboxId: text("sandbox_id").references(() => sandboxes.id, { onDelete: "cascade" }),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    pinnedOrder: integer("pinned_order"),
    branch: text("branch").notNull().default(DEFAULT_BRANCH),
    launchCommands: text("launch_commands"),
    customScripts: text("custom_scripts"),
    launchUrl: text("launch_url"),
    worktreeSetupCommand: text("worktree_setup_command"),
    rememberAgentSettings: integer("remember_agent_settings", { mode: "boolean" })
      .notNull()
      .default(false),
    savedAgent: text("saved_agent").$type<TaskAgent>(),
    savedSkipPermissions: integer("saved_skip_permissions", { mode: "boolean" })
      .notNull()
      .default(false),
    savedBareSession: integer("saved_bare_session", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    groupIdx: index("projects_group_idx").on(t.groupId),
    pinnedIdx: index("projects_pinned_idx").on(t.pinned),
    sandboxIdx: index("projects_sandbox_idx").on(t.sandboxId),
  })
);

export const worktrees = sqliteTable(
  "worktrees",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    branch: text("branch").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("worktrees_project_idx").on(t.projectId),
    projectNameUnique: uniqueIndex("worktrees_project_name_unique").on(t.projectId, t.name),
  })
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    worktreeId: text("worktree_id").references(() => worktrees.id, { onDelete: "cascade" }),
    scopeId: text("scope_id").notNull().default(LOCAL_SCOPE_ID),
    title: text("title").notNull(),
    titleManuallySet: integer("title_manually_set", { mode: "boolean" }).notNull().default(false),
    icon: text("icon"),
    agent: text("agent").$type<TaskAgent>().notNull(),
    status: text("status").$type<TaskStatus>().notNull().default(DEFAULT_TASK_STATUS),
    branch: text("branch").notNull().default(DEFAULT_BRANCH),
    preview: text("preview").notNull().default(""),
    lines: integer("lines").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    claudeSessionId: text("claude_session_id"),
    claudeSkipPermissions: integer("claude_skip_permissions", { mode: "boolean" }).notNull().default(false),
    claudeBareSession: integer("claude_bare_session", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("tasks_project_idx").on(t.projectId),
    projectWorktreeIdx: index("tasks_project_worktree_idx").on(t.projectId, t.worktreeId),
    projectWorktreeScopeIdx: index("tasks_project_worktree_scope_idx").on(
      t.projectId,
      t.worktreeId,
      t.scopeId,
    ),
    scopeIdx: index("tasks_scope_idx").on(t.scopeId),
    worktreeIdx: index("tasks_worktree_idx").on(t.worktreeId),
    statusIdx: index("tasks_status_idx").on(t.status),
    archivedIdx: index("tasks_archived_idx").on(t.archived),
  })
);

export const terminalLogs = sqliteTable(
  "terminal_logs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    chunk: text("chunk").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    taskIdx: index("terminal_logs_task_idx").on(t.taskId),
  })
);

export const taskDiagrams = sqliteTable(
  "task_diagrams",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title"),
    source: text("source").notNull(),
    format: text("format").$type<DiagramFormat>().notNull().default("mermaid"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("task_diagrams_project_idx").on(t.projectId),
    taskIdx: index("task_diagrams_task_idx").on(t.taskId),
  })
);

export const userTerminals = sqliteTable(
  "user_terminals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    worktreeId: text("worktree_id").references(() => worktrees.id, { onDelete: "cascade" }),
    scopeId: text("scope_id").notNull().default(LOCAL_SCOPE_ID),
    name: text("name").notNull(),
    cwd: text("cwd"),
    startCommand: text("start_command"),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("user_terminals_project_idx").on(t.projectId),
    projectWorktreeIdx: index("user_terminals_project_worktree_idx").on(t.projectId, t.worktreeId),
    projectWorktreeScopeIdx: index("user_terminals_project_worktree_scope_idx").on(
      t.projectId,
      t.worktreeId,
      t.scopeId,
    ),
    scopeIdx: index("user_terminals_scope_idx").on(t.scopeId),
    worktreeIdx: index("user_terminals_worktree_idx").on(t.worktreeId),
  })
);

// Project-less "home" terminals shown on the dashboard. Deliberately a separate
// table (not a nullable project_id on user_terminals) so the FK-heavy
// user_terminals table never needs a destructive rebuild — this is purely
// additive. Rows are surfaced to the renderer shaped as UserTerminal (with a
// sentinel projectId) so the existing terminal store/panel/pane can render them.
export const homeTerminals = sqliteTable(
  "home_terminals",
  {
    id: text("id").primaryKey(),
    // The scope (sandbox) the terminal belongs to: "local" for the host, or a
    // sandbox id. A home terminal runs a shell ON that scope's machine, so it is
    // only shown while that scope is active. Defaults to "local".
    scopeId: text("scope_id").notNull().default(LOCAL_SCOPE_ID),
    name: text("name").notNull(),
    cwd: text("cwd"),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    scopeIdx: index("home_terminals_scope_idx").on(t.scopeId),
  })
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const tokenUsage = sqliteTable(
  "token_usage",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    claudeSessionId: text("claude_session_id").notNull(),
    messageUuid: text("message_uuid").notNull().unique(),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    ts: integer("ts").notNull(),
  },
  (t) => ({
    taskIdx: index("token_usage_task_idx").on(t.taskId),
    projectIdx: index("token_usage_project_idx").on(t.projectId),
    tsIdx: index("token_usage_ts_idx").on(t.ts),
  })
);

export const tokenUsageSessionOffsets = sqliteTable(
  "token_usage_session_offsets",
  {
    claudeSessionId: text("claude_session_id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    byteOffset: integer("byte_offset").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  }
);

export const groupsRelations = relations(groups, ({ many }) => ({
  projects: many(projects),
}));

export const sandboxesRelations = relations(sandboxes, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  group: one(groups, { fields: [projects.groupId], references: [groups.id] }),
  sandbox: one(sandboxes, { fields: [projects.sandboxId], references: [sandboxes.id] }),
  tasks: many(tasks),
  worktrees: many(worktrees),
}));

export const worktreesRelations = relations(worktrees, ({ one, many }) => ({
  project: one(projects, { fields: [worktrees.projectId], references: [projects.id] }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  worktree: one(worktrees, { fields: [tasks.worktreeId], references: [worktrees.id] }),
  logs: many(terminalLogs),
  diagrams: many(taskDiagrams),
}));

export const terminalLogsRelations = relations(terminalLogs, ({ one }) => ({
  task: one(tasks, { fields: [terminalLogs.taskId], references: [tasks.id] }),
}));

export const taskDiagramsRelations = relations(taskDiagrams, ({ one }) => ({
  task: one(tasks, { fields: [taskDiagrams.taskId], references: [tasks.id] }),
  project: one(projects, { fields: [taskDiagrams.projectId], references: [projects.id] }),
}));

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type Sandbox = typeof sandboxes.$inferSelect;
export type NewSandbox = typeof sandboxes.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Worktree = typeof worktrees.$inferSelect;
export type NewWorktree = typeof worktrees.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type UserTerminal = typeof userTerminals.$inferSelect;
export type NewUserTerminal = typeof userTerminals.$inferInsert;
export type HomeTerminal = typeof homeTerminals.$inferSelect;
export type NewHomeTerminal = typeof homeTerminals.$inferInsert;
export {
  DEFAULT_BRANCH,
  DEFAULT_TASK_STATUS,
  LAUNCH_COMMANDS_MAX,
  CUSTOM_SCRIPTS_MAX,
  TASK_AGENTS,
  TASK_STATUSES,
  parseLaunchCommands,
  parseCustomScripts,
  isActiveStatus,
  isTerminalStatus,
};
export type { LaunchCommand, CustomScript, TaskAgent, TaskStatus };
