import { logHostedEvent } from "./hosted-logs";

type AlertName =
  | "academy_entitlement_sync_failures"
  | "cleanup_failures"
  | "daytona_failures"
  | "server_exceptions"
  | "stuck_cleanup_outbox";

type AlertPayload = {
  name: AlertName;
  message: string;
  severity?: "warning" | "critical";
  count?: number;
  threshold?: number;
  fields?: Record<string, string | number | boolean | null | undefined>;
};

const DEFAULT_FAILURE_THRESHOLD = 5;
const lastAlertAt = new Map<string, number>();

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function dedupeWindowMs(): number {
  return envNumber("MC_ALERT_DEDUP_WINDOW_MINUTES", 15) * 60_000;
}

function shouldSendAlert(key: string): boolean {
  const now = Date.now();
  const last = lastAlertAt.get(key) ?? 0;
  if (now - last < dedupeWindowMs()) return false;
  lastAlertAt.set(key, now);
  return true;
}

async function postAlert(payload: AlertPayload): Promise<void> {
  const url = process.env.MC_ALERT_WEBHOOK_URL?.trim();
  if (!url || process.env.VITEST) return;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      app: "mission-control",
      environment: process.env.MC_ENVIRONMENT || process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      ...payload,
    }),
  }).catch((error) => {
    logHostedEvent("alert.webhook_failed", {
      name: payload.name,
      error: error instanceof Error ? error.message : String(error),
    }, "error");
  });
}

export function sendHostedAlert(payload: AlertPayload): void {
  const key = `${payload.name}:${payload.fields?.scope ?? "global"}`;
  if (!shouldSendAlert(key)) return;
  logHostedEvent("alert.triggered", {
    alert: payload.name,
    message: payload.message,
    severity: payload.severity ?? "warning",
    count: payload.count ?? null,
    threshold: payload.threshold ?? null,
    ...(payload.fields ?? {}),
  }, payload.severity === "critical" ? "error" : "warn");
  void postAlert(payload);
}

export function alertThresholdForCounter(counter: string): number | null {
  if (counter === "remotePtyFailures") {
    return envNumber("MC_ALERT_DAYTONA_FAILURES", DEFAULT_FAILURE_THRESHOLD);
  }
  if (counter === "cleanupFailures") {
    return envNumber("MC_ALERT_CLEANUP_FAILURES", DEFAULT_FAILURE_THRESHOLD);
  }
  if (counter === "academyEntitlementSyncFailures") {
    return envNumber("MC_ALERT_ACADEMY_SYNC_FAILURES", DEFAULT_FAILURE_THRESHOLD);
  }
  if (counter === "serverExceptions") {
    return envNumber("MC_ALERT_SERVER_EXCEPTIONS", DEFAULT_FAILURE_THRESHOLD);
  }
  return null;
}

export function maybeAlertForCounter(counter: string, count: number): void {
  const threshold = alertThresholdForCounter(counter);
  if (!threshold || count < threshold || count % threshold !== 0) return;
  const name =
    counter === "remotePtyFailures"
      ? "daytona_failures"
      : counter === "cleanupFailures"
      ? "cleanup_failures"
      : counter === "academyEntitlementSyncFailures"
      ? "academy_entitlement_sync_failures"
      : "server_exceptions";
  sendHostedAlert({
    name,
    severity: counter === "serverExceptions" ? "critical" : "warning",
    message: `${counter} reached ${count}`,
    count,
    threshold,
  });
}

export function reportHostedServerException(fields: {
  method: string;
  pathname: string;
  message: string;
}): void {
  sendHostedAlert({
    name: "server_exceptions",
    severity: "critical",
    message: "Unhandled hosted API exception",
    fields,
  });
}

export function resetHostedAlertsForTests(): void {
  lastAlertAt.clear();
}
