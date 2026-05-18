import { maybeAlertForCounter } from "./hosted-alerts";

type HostedCounterName =
  | "academyEntitlementSyncFailures"
  | "cleanupFailures"
  | "hookFailures"
  | "remotePtyFailures"
  | "remotePtyStarts"
  | "serverExceptions";

type HostedGaugeName = "activeRemotePtys";

const counters: Record<HostedCounterName, number> = {
  academyEntitlementSyncFailures: 0,
  cleanupFailures: 0,
  hookFailures: 0,
  remotePtyFailures: 0,
  remotePtyStarts: 0,
  serverExceptions: 0,
};

const gauges: Record<HostedGaugeName, number> = {
  activeRemotePtys: 0,
};

export function incrementHostedCounter(name: HostedCounterName, by = 1): void {
  counters[name] += by;
  maybeAlertForCounter(name, counters[name]);
}

export function setHostedGauge(name: HostedGaugeName, value: number): void {
  gauges[name] = value;
}

export function readHostedMetrics() {
  return {
    counters: { ...counters },
    gauges: { ...gauges },
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

export function resetHostedMetricsForTests(): void {
  for (const key of Object.keys(counters) as HostedCounterName[]) counters[key] = 0;
  for (const key of Object.keys(gauges) as HostedGaugeName[]) gauges[key] = 0;
}
