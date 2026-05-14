import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalUserDataDir = process.env.MC_USER_DATA_DIR;

const appliedThroughBareSession = [
  "0001_rename_task_statuses.sql",
  "0002_project_image.sql",
  "0003_launch_commands.sql",
  "0004_remember_agent_settings.sql",
  "0005_claude_session_persistence.sql",
  "0006_project_launch_url.sql",
  "0007_claude_bare_session.sql",
];
const appliedThroughProjectImageDataUrl = [
  ...appliedThroughBareSession,
  "0008_token_usage.sql",
  "0009_unique_constraints.sql",
  "0010_token_usage_task_ts_index.sql",
  "0011_projects_github_url.sql",
  "0012_token_usage_project_ts_index.sql",
  "0013_tasks_project_status_index.sql",
  "0014_token_usage_daily_rollup.sql",
  "0015_cloud_runtime_projects.sql",
  "0016_project_image_data_url.sql",
];

describe("db migration reconciliation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-db-migrations-"));
    process.env.MC_USER_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    if (originalUserDataDir === undefined) {
      delete process.env.MC_USER_DATA_DIR;
    } else {
      process.env.MC_USER_DATA_DIR = originalUserDataDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("continues past an unrecorded token_usage schema when applying later migrations", async () => {
    seedDbWithUnrecordedTokenUsage(path.join(tmpDir, "missioncontrol.db"));

    const { getDb, getSqlite } = await import("~/db/client");

    expect(() => getDb()).not.toThrow();

    const sqlite = getSqlite();
    const projectColumns = sqlite.prepare("PRAGMA table_info(projects)").all() as Array<{
      name: string;
    }>;
    expect(projectColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["runtime_kind", "owner_user_id", "sandbox_id", "image_data_url"])
    );

    const project = sqlite
      .prepare("SELECT runtime_kind FROM projects WHERE id = 'p1'")
      .get() as { runtime_kind: string };
    expect(project.runtime_kind).toBe("local");

    const applied = sqlite
      .prepare("SELECT name FROM schema_migrations")
      .all() as Array<{ name: string }>;
    expect(applied.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "0008_token_usage.sql",
        "0014_token_usage_daily_rollup.sql",
        "0015_cloud_runtime_projects.sql",
        "0016_project_image_data_url.sql",
        "0017_daytona_workspace_relative_paths.sql",
      ])
    );

    const rollup = sqlite
      .prepare(
        `SELECT input_tokens, output_tokens, request_count
         FROM token_usage_daily_rollup
         WHERE day = '2026-05-01' AND project_id = 'p1'`
      )
      .get() as { input_tokens: number; output_tokens: number; request_count: number };
    expect(rollup).toEqual({
      input_tokens: 10,
      output_tokens: 20,
      request_count: 1,
    });
  });

  it("backfills legacy Daytona /workspace paths to workdir-relative paths", async () => {
    seedDbWithLegacyDaytonaPath(path.join(tmpDir, "missioncontrol.db"));

    const { getDb, getSqlite } = await import("~/db/client");

    expect(() => getDb()).not.toThrow();

    const sqlite = getSqlite();
    const project = sqlite
      .prepare("SELECT path, workspace_path FROM projects WHERE id = 'p-cloud'")
      .get() as { path: string; workspace_path: string };
    expect(project).toEqual({
      path: "workspace/agentsystemlabs-mission-control",
      workspace_path: "workspace/agentsystemlabs-mission-control",
    });
  });

  it("keeps legacy Daytona workspace paths distinct when the relative path already exists", async () => {
    seedDbWithLegacyDaytonaPath(path.join(tmpDir, "missioncontrol.db"), {
      withRelativeCollision: true,
    });

    const { getDb, getSqlite } = await import("~/db/client");

    expect(() => getDb()).not.toThrow();

    const sqlite = getSqlite();
    const legacy = sqlite
      .prepare("SELECT path, workspace_path FROM projects WHERE id = 'p-cloud'")
      .get() as { path: string; workspace_path: string };
    expect(legacy).toEqual({
      path: "workspace/agentsystemlabs-mission-control-p-cloud",
      workspace_path: "workspace/agentsystemlabs-mission-control-p-cloud",
    });
  });
});

function seedDbWithUnrecordedTokenUsage(dbPath: string) {
  const sqlite = new Database(dbPath);
  const now = Date.now();
  try {
    sqlite.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        icon TEXT NOT NULL,
        icon_color TEXT NOT NULL,
        image_path TEXT,
        group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        branch TEXT NOT NULL DEFAULT 'main',
        launch_commands TEXT,
        launch_url TEXT,
        remember_agent_settings INTEGER NOT NULL DEFAULT 0,
        saved_agent TEXT,
        saved_skip_permissions INTEGER NOT NULL DEFAULT 0,
        saved_bare_session INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        agent TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        branch TEXT NOT NULL DEFAULT 'main',
        preview TEXT NOT NULL DEFAULT '',
        lines INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        claude_session_id TEXT,
        claude_skip_permissions INTEGER NOT NULL DEFAULT 0,
        claude_bare_session INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE terminal_logs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        chunk TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE user_terminals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        cwd TEXT,
        start_command TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE token_usage (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        claude_session_id TEXT NOT NULL,
        message_uuid TEXT NOT NULL UNIQUE,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        ts INTEGER NOT NULL
      );

      CREATE TABLE token_usage_session_offsets (
        claude_session_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        byte_offset INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE token_usage_daily_rollup (
        day TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, project_id)
      );
    `);

    const insertMigration = sqlite.prepare(
      "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
    );
    for (const name of appliedThroughBareSession) {
      insertMigration.run(name, now);
    }

    sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, path, icon, icon_color, pinned, branch,
          remember_agent_settings, saved_skip_permissions, saved_bare_session,
          created_at, updated_at
        ) VALUES ('p1', 'Demo', '/tmp/demo', 'folder', '#888', 0, 'main', 0, 0, 0, ?, ?)`
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO tasks (
          id, project_id, title, agent, status, branch, preview, lines,
          archived, claude_session_id, claude_skip_permissions,
          claude_bare_session, created_at, updated_at
        ) VALUES ('t1', 'p1', 'A task', 'claude-code', 'finished', 'main', '', 0, 0, 'sess-1', 0, 0, ?, ?)`
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO token_usage (
          id, task_id, project_id, claude_session_id, message_uuid, model,
          input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, ts
        ) VALUES ('tu-msg-1', 't1', 'p1', 'sess-1', 'msg-1', 'claude-test', 10, 20, 0, 0, ?)`
      )
      .run(Date.UTC(2026, 4, 1, 12, 0, 0));
    sqlite
      .prepare(
        `INSERT INTO token_usage_daily_rollup (
          day, project_id, input_tokens, output_tokens,
          cache_creation_tokens, cache_read_tokens, request_count
        ) VALUES ('2026-05-01', 'p1', 999, 999, 0, 0, 99)`
      )
      .run();
  } finally {
    sqlite.close();
  }
}

function seedDbWithLegacyDaytonaPath(
  dbPath: string,
  opts: { withRelativeCollision?: boolean } = {},
) {
  const sqlite = new Database(dbPath);
  const now = Date.now();
  try {
    sqlite.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        icon TEXT NOT NULL,
        icon_color TEXT NOT NULL,
        image_path TEXT,
        image_data_url TEXT,
        group_id TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        branch TEXT NOT NULL DEFAULT 'main',
        launch_commands TEXT,
        launch_url TEXT,
        runtime_kind TEXT NOT NULL DEFAULT 'local',
        owner_user_id TEXT,
        sandbox_id TEXT,
        workspace_path TEXT,
        repo_url TEXT,
        sandbox_state TEXT,
        remember_agent_settings INTEGER NOT NULL DEFAULT 0,
        saved_agent TEXT,
        saved_skip_permissions INTEGER NOT NULL DEFAULT 0,
        saved_bare_session INTEGER NOT NULL DEFAULT 0,
        github_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        agent TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        branch TEXT NOT NULL DEFAULT 'main',
        preview TEXT NOT NULL DEFAULT '',
        lines INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        claude_session_id TEXT,
        claude_skip_permissions INTEGER NOT NULL DEFAULT 0,
        claude_bare_session INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE user_terminals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        cwd TEXT,
        start_command TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    const insertMigration = sqlite.prepare(
      "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
    );
    for (const name of appliedThroughProjectImageDataUrl) {
      insertMigration.run(name, now);
    }

    sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, path, icon, icon_color, pinned, branch,
          runtime_kind, owner_user_id, workspace_path, repo_url,
          remember_agent_settings, saved_skip_permissions, saved_bare_session,
          created_at, updated_at
        ) VALUES (
          'p-cloud', 'Mission Control', '/workspace/agentsystemlabs-mission-control',
          'MC', '#ff5a1f', 0, 'main', 'daytona', 'user-1',
          '/workspace/agentsystemlabs-mission-control',
          'https://github.com/AgentSystemLabs/mission-control.git',
          0, 0, 0, ?, ?
        )`
      )
      .run(now, now);
    if (opts.withRelativeCollision) {
      sqlite
        .prepare(
          `INSERT INTO projects (
            id, name, path, icon, icon_color, pinned, branch,
            runtime_kind, owner_user_id, workspace_path, repo_url,
            remember_agent_settings, saved_skip_permissions, saved_bare_session,
            created_at, updated_at
          ) VALUES (
            'p-existing', 'Existing', 'workspace/agentsystemlabs-mission-control',
            'EX', '#ff5a1f', 0, 'main', 'daytona', 'user-1',
            'workspace/agentsystemlabs-mission-control',
            'https://github.com/AgentSystemLabs/mission-control.git',
            0, 0, 0, ?, ?
          )`
        )
        .run(now, now);
    }
  } finally {
    sqlite.close();
  }
}
