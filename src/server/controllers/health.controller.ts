import { json } from "../auth";
import { getHostedPool, isHostedDatabaseEnabled } from "../hosted-pg";
import { HTTP_SERVICE_UNAVAILABLE } from "~/shared/http-status";

type HealthResponse = {
  ok: boolean;
  status: "ok" | "degraded";
  uptimeSeconds: number;
  checks: {
    api: "ok";
    database: "disabled" | "ok" | "error";
  };
};

export async function read(): Promise<Response> {
  const body: HealthResponse = {
    ok: true,
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    checks: {
      api: "ok",
      database: isHostedDatabaseEnabled() ? "ok" : "disabled",
    },
  };

  if (isHostedDatabaseEnabled()) {
    try {
      await getHostedPool().query("SELECT 1");
    } catch (err) {
      console.error("[health] database check failed", err);
      body.ok = false;
      body.status = "degraded";
      body.checks.database = "error";
      return json(body, { status: HTTP_SERVICE_UNAVAILABLE });
    }
  }

  return json(body);
}
