import type { HostedAuthContext } from "../hosted-auth-context";
import { getHostedPool, isHostedDatabaseEnabled } from "../hosted-pg";
import { deleteRemoteSandboxByIdOrName, deleteRemoteSandboxesForProject } from "./daytona-remote-pty";
import { sendHostedAlert } from "./hosted-alerts";
import { logHostedEvent } from "./hosted-logs";
import { incrementHostedCounter } from "./hosted-metrics";

type CleanupOutboxRow = {
  id: string;
  scope: {
    organizationId: string | null;
    userId: string | null;
  };
  payload: {
    projectId: string;
    remoteSandboxId: string | null;
  };
};

type CleanupOutboxAlertRow = {
  count: string | number;
};

let scheduled = false;

function contextFromOutbox(row: CleanupOutboxRow): HostedAuthContext {
  return {
    sessionId: "cleanup-worker",
    academyUserId: "cleanup-worker",
    userId: row.scope.userId ?? "cleanup-worker",
    email: "cleanup-worker@example.invalid",
    organizationId: row.scope.organizationId,
  };
}

export async function enqueueHostedProjectCleanup(
  context: HostedAuthContext,
  projectId: string,
  remoteSandboxId: string | null,
  error: unknown,
): Promise<void> {
  const id = `hco-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  await getHostedPool().query(
    `INSERT INTO "hostedCleanupOutbox" (
        "id", "kind", "scope", "payload", "lastError"
      )
      VALUES ($1, 'daytona-project-sandboxes', $2::jsonb, $3::jsonb, $4)`,
    [
      id,
      JSON.stringify({
        organizationId: context.organizationId,
        userId: context.organizationId ? null : context.userId,
      }),
      JSON.stringify({ projectId, remoteSandboxId }),
      error instanceof Error ? error.message : String(error),
    ],
  );
  logHostedEvent("cleanup.enqueued", {
    id,
    projectId,
    remoteSandboxId,
    userId: context.organizationId ? null : context.userId,
    organizationId: context.organizationId,
  }, "warn");
}

export async function processHostedCleanupOutbox(limit = 10): Promise<void> {
  if (!isHostedDatabaseEnabled()) return;
  const pool = getHostedPool();
  const result = await pool.query<CleanupOutboxRow>(
    `UPDATE "hostedCleanupOutbox"
      SET "status" = 'processing',
        "attempts" = "attempts" + 1,
        "updatedAt" = now()
      WHERE "id" IN (
        SELECT "id"
        FROM "hostedCleanupOutbox"
        WHERE "kind" = 'daytona-project-sandboxes'
          AND (
            "status" IN ('pending', 'failed')
            OR ("status" = 'processing' AND "updatedAt" < now() - interval '15 minutes')
          )
        ORDER BY "createdAt" ASC
        LIMIT $1
      )
        AND "kind" = 'daytona-project-sandboxes'
        AND (
          "status" IN ('pending', 'failed')
          OR ("status" = 'processing' AND "updatedAt" < now() - interval '15 minutes')
        )
      RETURNING "id", "scope", "payload"`,
    [limit],
  );

  for (const row of result.rows) {
    logHostedEvent("cleanup.processing", {
      id: row.id,
      projectId: row.payload.projectId,
      remoteSandboxId: row.payload.remoteSandboxId,
    });
    try {
      const projectExists = await pool.query(
        `SELECT 1 FROM "hostedProject" WHERE "id" = $1 LIMIT 1`,
        [row.payload.projectId],
      );
      if ((projectExists.rowCount ?? 0) > 0) {
        logHostedEvent("cleanup.deferred", {
          id: row.id,
          projectId: row.payload.projectId,
          reason: "project_still_exists",
        }, "warn");
        throw new Error("project still exists; cleanup deferred");
      }
      await deleteRemoteSandboxByIdOrName(row.payload.remoteSandboxId);
      await deleteRemoteSandboxesForProject(contextFromOutbox(row), row.payload.projectId);
      await pool.query(
        `UPDATE "hostedCleanupOutbox"
          SET "status" = 'done', "lastError" = NULL, "updatedAt" = now()
          WHERE "id" = $1`,
        [row.id],
      );
      logHostedEvent("cleanup.done", {
        id: row.id,
        projectId: row.payload.projectId,
        remoteSandboxId: row.payload.remoteSandboxId,
      });
    } catch (error) {
      incrementHostedCounter("cleanupFailures");
      await pool.query(
        `UPDATE "hostedCleanupOutbox"
          SET "status" = 'failed', "lastError" = $2, "updatedAt" = now()
          WHERE "id" = $1`,
        [row.id, error instanceof Error ? error.message : String(error)],
      );
      logHostedEvent("cleanup.failed", {
        id: row.id,
        projectId: row.payload.projectId,
        remoteSandboxId: row.payload.remoteSandboxId,
        error: error instanceof Error ? error.message : String(error),
      }, "error");
    }
  }

  const stuck = await pool.query<CleanupOutboxAlertRow>(
    `SELECT count(*)::int AS count
      FROM "hostedCleanupOutbox"
      WHERE "kind" = 'daytona-project-sandboxes'
        AND (
          ("status" = 'processing' AND "updatedAt" < now() - interval '15 minutes')
          OR ("status" = 'failed' AND "attempts" >= $1)
        )`,
    [Number(process.env.MC_ALERT_CLEANUP_OUTBOX_ATTEMPTS ?? 3)],
  );
  const stuckCount = Number(stuck.rows[0]?.count ?? 0);
  const stuckThreshold = Number(process.env.MC_ALERT_CLEANUP_OUTBOX_ROWS ?? 1);
  if (stuckCount >= stuckThreshold) {
    sendHostedAlert({
      name: "stuck_cleanup_outbox",
      message: "Hosted cleanup outbox has stuck rows",
      count: stuckCount,
      threshold: stuckThreshold,
      fields: { stuckCount },
    });
  }
}

export function scheduleHostedCleanupOutboxWorker(): void {
  if (process.env.VITEST) return;
  if (scheduled || !isHostedDatabaseEnabled()) return;
  scheduled = true;
  void processHostedCleanupOutbox();
  const timer = setInterval(() => {
    void processHostedCleanupOutbox();
  }, 60_000);
  timer.unref?.();
}
