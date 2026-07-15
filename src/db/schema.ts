import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
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
import {
  DEFAULT_MEMORY_STATUS,
  DEFAULT_MEMORY_CONFIDENCE,
  DEFAULT_MEMORY_SOURCE,
  type MemoryType,
  type MemoryStatus,
  type MemoryConfidence,
  type MemorySource,
} from "~/shared/project-memory";
import {
  type GraphNodeKind,
  type GraphEdgeKind,
  type GraphConfidence,
  type GraphLanguage,
} from "~/shared/code-graph";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  // Manual display order (0-based). Null on legacy rows created before
  // reordering existed; those sort last by createdAt until the user reorders,
  // which assigns every group a concrete index. See groups.repo findAllGroups.
  sortOrder: integer("sort_order"),
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
    // Which layout this project opens in: true = grid (all sessions tiled),
    // false = list (sessions stacked in a column). Chosen at create time; the
    // in-session toggle still lets the user switch on the fly.
    defaultGridView: integer("default_grid_view", { mode: "boolean" })
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
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
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
    pinnedIdx: index("tasks_pinned_idx").on(t.pinned),
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

// Durable, searchable history of every prompt the user submits to a session.
// One row per submission (see services/prompts.ts recordPrompt, which dedups so
// the agent hook + terminal-capture fallback don't both persist the same send).
// Rows are captured server-side where the prompt text already arrives (agent
// hooks / task status) and power the prompt-search palette. Cascades away with
// the task/project so history never outlives its session.
export const prompts = sqliteTable(
  "prompts",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    worktreeId: text("worktree_id"),
    scopeId: text("scope_id").notNull().default(LOCAL_SCOPE_ID),
    claudeSessionId: text("claude_session_id"),
    agent: text("agent").$type<TaskAgent>().notNull(),
    text: text("text").notNull(),
    ts: integer("ts").notNull(),
  },
  (t) => ({
    taskIdx: index("prompts_task_idx").on(t.taskId),
    projectIdx: index("prompts_project_idx").on(t.projectId),
    tsIdx: index("prompts_ts_idx").on(t.ts),
  })
);

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

// Recall — project-level memory. Curated, typed facts about a project that are
// assembled into a Session Brief and fed to new agent sessions so the agent
// starts already knowing the project. Cascades away with its project/scope like
// prompts/token_usage. `tags` is JSON stored as TEXT (parsed at the service
// boundary); `superseded_by_id` chains factual updates instead of overwriting.
export const projectMemory = sqliteTable(
  "project_memory",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scopeId: text("scope_id").notNull().default(LOCAL_SCOPE_ID),
    type: text("type").$type<MemoryType>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    tags: text("tags"), // JSON: string[]
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    status: text("status").$type<MemoryStatus>().notNull().default(DEFAULT_MEMORY_STATUS),
    confidence: text("confidence")
      .$type<MemoryConfidence>()
      .notNull()
      .default(DEFAULT_MEMORY_CONFIDENCE),
    source: text("source").$type<MemorySource>().notNull().default(DEFAULT_MEMORY_SOURCE),
    sourceTaskId: text("source_task_id").references(() => tasks.id, { onDelete: "set null" }),
    supersededById: text("superseded_by_id"),
    usageCount: integer("usage_count").notNull().default(0),
    lastVerifiedAt: integer("last_verified_at"),
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("project_memory_project_idx").on(t.projectId),
    projectScopeIdx: index("project_memory_project_scope_idx").on(t.projectId, t.scopeId),
    typeIdx: index("project_memory_type_idx").on(t.type),
    statusIdx: index("project_memory_status_idx").on(t.status),
    pinnedIdx: index("project_memory_pinned_idx").on(t.pinned),
  })
);

// Recall Code Graph — the structural map of a project's source. `graph_nodes`
// are symbols (one `file` node per source file plus its declarations);
// `graph_edges` connect them (imports/calls/defines). Both are project-scoped
// and cascade away with the project. `degree` (cached in+out edge count) drives
// god-node ranking. Rebuilt by the indexer, not hand-edited. See
// recall-phase4a-code-graph.md and src/shared/code-graph.ts.
export const graphNodes = sqliteTable(
  "graph_nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<GraphNodeKind>().notNull(),
    // Symbol name; for a `file` node, the repo-relative path.
    name: text("name").notNull(),
    filePath: text("file_path").notNull(),
    startLine: integer("start_line").notNull().default(0),
    endLine: integer("end_line").notNull().default(0),
    exported: integer("exported", { mode: "boolean" }).notNull().default(false),
    signature: text("signature"),
    language: text("language").$type<GraphLanguage>().notNull(),
    // Cached in+out edge count → god-node ranking (recomputed on index).
    degree: integer("degree").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("graph_nodes_project_idx").on(t.projectId),
    projectKindIdx: index("graph_nodes_project_kind_idx").on(t.projectId, t.kind),
    projectNameIdx: index("graph_nodes_project_name_idx").on(t.projectId, t.name),
    projectFileIdx: index("graph_nodes_project_file_idx").on(t.projectId, t.filePath),
    projectDegreeIdx: index("graph_nodes_project_degree_idx").on(t.projectId, t.degree),
  })
);

export const graphEdges = sqliteTable(
  "graph_edges",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    srcId: text("src_id").notNull(),
    // Resolved target node id, or null when the target is external/unresolved
    // (then `dstName` carries the raw name).
    dstId: text("dst_id"),
    dstName: text("dst_name"),
    kind: text("kind").$type<GraphEdgeKind>().notNull(),
    confidence: text("confidence").$type<GraphConfidence>().notNull().default("extracted"),
    // Call came from a member expression (`x.foo()`); the incremental
    // re-resolution pass must never name-resolve these across files.
    isMember: integer("is_member", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    projectIdx: index("graph_edges_project_idx").on(t.projectId),
    srcIdx: index("graph_edges_src_idx").on(t.srcId),
    dstIdx: index("graph_edges_dst_idx").on(t.dstId),
    projectKindIdx: index("graph_edges_project_kind_idx").on(t.projectId, t.kind),
  })
);

// Per-file stat + hash index driving the code graph's incremental builds:
// (size, mtime_ms) match → trust `hash`, never read the file; hash change →
// re-parse. One row per indexed file, replaced/updated by the indexer.
export const graphFiles = sqliteTable(
  "graph_files",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    size: integer("size").notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.path] }),
  })
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
  prompts: many(prompts),
}));

export const promptsRelations = relations(prompts, ({ one }) => ({
  task: one(tasks, { fields: [prompts.taskId], references: [tasks.id] }),
  project: one(projects, { fields: [prompts.projectId], references: [projects.id] }),
}));

export const projectMemoryRelations = relations(projectMemory, ({ one }) => ({
  project: one(projects, { fields: [projectMemory.projectId], references: [projects.id] }),
  sourceTask: one(tasks, { fields: [projectMemory.sourceTaskId], references: [tasks.id] }),
}));

export const graphNodesRelations = relations(graphNodes, ({ one }) => ({
  project: one(projects, { fields: [graphNodes.projectId], references: [projects.id] }),
}));

export const graphEdgesRelations = relations(graphEdges, ({ one }) => ({
  project: one(projects, { fields: [graphEdges.projectId], references: [projects.id] }),
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
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type ProjectMemory = typeof projectMemory.$inferSelect;
export type NewProjectMemory = typeof projectMemory.$inferInsert;
export type GraphNode = typeof graphNodes.$inferSelect;
export type NewGraphNode = typeof graphNodes.$inferInsert;
export type GraphEdge = typeof graphEdges.$inferSelect;
export type NewGraphEdge = typeof graphEdges.$inferInsert;
export type GraphFile = typeof graphFiles.$inferSelect;
export type NewGraphFile = typeof graphFiles.$inferInsert;
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
