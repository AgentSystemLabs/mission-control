import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import {
  DEFAULT_BRANCH,
  DEFAULT_TASK_STATUS,
  LAUNCH_COMMANDS_MAX,
  TASK_AGENTS,
  TASK_STATUSES,
  parseLaunchCommands,
  isActiveStatus,
  isTerminalStatus,
  type LaunchCommand,
  type TaskAgent,
  type TaskStatus,
} from "~/shared/domain";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    path: text("path").notNull().unique(),
    icon: text("icon").notNull(),
    iconColor: text("icon_color").notNull(),
    imagePath: text("image_path"),
    imageDataUrl: text("image_data_url"),
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    branch: text("branch").notNull().default(DEFAULT_BRANCH),
    launchCommands: text("launch_commands"),
    launchUrl: text("launch_url"),
    runtimeKind: text("runtime_kind").notNull().default("local"),
    ownerUserId: text("owner_user_id"),
    sandboxId: text("sandbox_id"),
    workspacePath: text("workspace_path"),
    repoUrl: text("repo_url"),
    sandboxState: text("sandbox_state"),
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
    githubUrl: text("github_url"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    groupIdx: index("projects_group_idx").on(t.groupId),
    pinnedIdx: index("projects_pinned_idx").on(t.pinned),
    ownerIdx: index("projects_owner_idx").on(t.ownerUserId),
    sandboxIdx: uniqueIndex("projects_sandbox_unique").on(t.sandboxId),
  })
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
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
    statusIdx: index("tasks_status_idx").on(t.status),
    archivedIdx: index("tasks_archived_idx").on(t.archived),
    projectStatusIdx: index("tasks_project_status_idx").on(t.projectId, t.status),
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

export const userTerminals = sqliteTable(
  "user_terminals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cwd: text("cwd"),
    startCommand: text("start_command"),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("user_terminals_project_idx").on(t.projectId),
    projectNameUnique: uniqueIndex("user_terminals_project_name_unique").on(t.projectId, t.name),
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
    taskTsIdx: index("token_usage_task_ts_idx").on(t.taskId, t.ts),
    projectTsIdx: index("token_usage_project_ts_idx").on(t.projectId, t.ts),
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

export const tokenUsageDailyRollup = sqliteTable(
  "token_usage_daily_rollup",
  {
    day: text("day").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    requestCount: integer("request_count").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.day, t.projectId] }),
    dayIdx: index("token_usage_daily_rollup_day_idx").on(t.day),
  })
);

export const groupsRelations = relations(groups, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  group: one(groups, { fields: [projects.groupId], references: [groups.id] }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  logs: many(terminalLogs),
}));

export const terminalLogsRelations = relations(terminalLogs, ({ one }) => ({
  task: one(tasks, { fields: [terminalLogs.taskId], references: [tasks.id] }),
}));

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type UserTerminal = typeof userTerminals.$inferSelect;
export type NewUserTerminal = typeof userTerminals.$inferInsert;
export {
  DEFAULT_BRANCH,
  DEFAULT_TASK_STATUS,
  LAUNCH_COMMANDS_MAX,
  TASK_AGENTS,
  TASK_STATUSES,
  parseLaunchCommands,
  isActiveStatus,
  isTerminalStatus,
};
export type { LaunchCommand, TaskAgent, TaskStatus };
