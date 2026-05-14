import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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

const millis = (name: string) => bigint(name, { mode: "number" });

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => ({
    userIdx: index("session_user_id_idx").on(t.userId),
  }),
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("account_user_id_idx").on(t.userId),
  }),
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    identifierIdx: index("verification_identifier_idx").on(t.identifier),
  }),
);

export const groups = pgTable(
  "groups",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: millis("created_at").notNull(),
  },
  (t) => ({
    ownerIdx: index("groups_owner_idx").on(t.ownerUserId),
    ownerNameUnique: uniqueIndex("groups_owner_name_unique").on(t.ownerUserId, t.name),
  }),
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    icon: text("icon").notNull(),
    iconColor: text("icon_color").notNull(),
    imagePath: text("image_path"),
    imageDataUrl: text("image_data_url"),
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    pinned: boolean("pinned").notNull().default(false),
    branch: text("branch").notNull().default(DEFAULT_BRANCH),
    launchCommands: text("launch_commands"),
    launchUrl: text("launch_url"),
    runtimeKind: text("runtime_kind").notNull().default("local"),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sandboxId: text("sandbox_id"),
    workspacePath: text("workspace_path"),
    repoUrl: text("repo_url"),
    sandboxState: text("sandbox_state"),
    rememberAgentSettings: boolean("remember_agent_settings").notNull().default(false),
    savedAgent: text("saved_agent").$type<TaskAgent>(),
    savedSkipPermissions: boolean("saved_skip_permissions").notNull().default(false),
    savedBareSession: boolean("saved_bare_session").notNull().default(false),
    githubUrl: text("github_url"),
    createdAt: millis("created_at").notNull(),
    updatedAt: millis("updated_at").notNull(),
  },
  (t) => ({
    groupIdx: index("projects_group_idx").on(t.groupId),
    pinnedIdx: index("projects_pinned_idx").on(t.pinned),
    ownerIdx: index("projects_owner_idx").on(t.ownerUserId),
    ownerPathUnique: uniqueIndex("projects_owner_path_unique").on(t.ownerUserId, t.path),
    sandboxIdx: uniqueIndex("projects_sandbox_unique").on(t.sandboxId),
  }),
);

export const tasks = pgTable(
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
    archived: boolean("archived").notNull().default(false),
    claudeSessionId: text("claude_session_id"),
    claudeSkipPermissions: boolean("claude_skip_permissions").notNull().default(false),
    claudeBareSession: boolean("claude_bare_session").notNull().default(false),
    createdAt: millis("created_at").notNull(),
    updatedAt: millis("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("tasks_project_idx").on(t.projectId),
    statusIdx: index("tasks_status_idx").on(t.status),
    archivedIdx: index("tasks_archived_idx").on(t.archived),
    projectStatusIdx: index("tasks_project_status_idx").on(t.projectId, t.status),
  }),
);

export const terminalLogs = pgTable(
  "terminal_logs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    chunk: text("chunk").notNull(),
    createdAt: millis("created_at").notNull(),
  },
  (t) => ({
    taskIdx: index("terminal_logs_task_idx").on(t.taskId),
  }),
);

export const userTerminals = pgTable(
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
    createdAt: millis("created_at").notNull(),
    updatedAt: millis("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("user_terminals_project_idx").on(t.projectId),
    projectNameUnique: uniqueIndex("user_terminals_project_name_unique").on(t.projectId, t.name),
  }),
);

export const appSettings = pgTable(
  "app_settings",
  {
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ownerUserId, t.key] }),
    ownerIdx: index("app_settings_owner_idx").on(t.ownerUserId),
  }),
);

export const tokenUsage = pgTable(
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
    ts: millis("ts").notNull(),
  },
  (t) => ({
    taskIdx: index("token_usage_task_idx").on(t.taskId),
    projectIdx: index("token_usage_project_idx").on(t.projectId),
    tsIdx: index("token_usage_ts_idx").on(t.ts),
    taskTsIdx: index("token_usage_task_ts_idx").on(t.taskId, t.ts),
    projectTsIdx: index("token_usage_project_ts_idx").on(t.projectId, t.ts),
  }),
);

export const tokenUsageSessionOffsets = pgTable("token_usage_session_offsets", {
  claudeSessionId: text("claude_session_id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  byteOffset: integer("byte_offset").notNull().default(0),
  updatedAt: millis("updated_at").notNull(),
});

export const tokenUsageDailyRollup = pgTable(
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
  }),
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

export type PgGroup = typeof groups.$inferSelect;
export type PgProject = typeof projects.$inferSelect;
export type PgTask = typeof tasks.$inferSelect;
export type PgUserTerminal = typeof userTerminals.$inferSelect;
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
