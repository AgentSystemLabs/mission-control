import { useEffect, useSyncExternalStore } from "react";
import { getElectron } from "~/lib/electron";
import { AGENT_REGISTRY, UI_AGENTS } from "~/shared/agents";
import type { TaskAgent } from "~/shared/domain";
import type { CliCheckResult } from "~/shared/electron-contract";

export type CliAvailabilityStatus = "unknown" | "checking" | "available" | "missing" | "outdated";

export type CliAvailability = {
  status: CliAvailabilityStatus;
  path?: string;
  reason?: string;
  label?: string;
  version?: string;
  requiredVersion?: string;
  packageUrl?: string;
  updateCommands?: readonly string[];
};

export type CliAvailabilityMap = Partial<Record<TaskAgent, CliAvailability>>;

const UNKNOWN: CliAvailability = { status: "unknown" };
const listeners = new Set<() => void>();
let snapshot: CliAvailabilityMap = Object.fromEntries(
  UI_AGENTS.map((agent) => [agent, UNKNOWN])
) as CliAvailabilityMap;
let started = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function setAgentAvailability(agent: TaskAgent, next: CliAvailability) {
  snapshot = { ...snapshot, [agent]: next };
  emit();
}

export function availabilityFor(
  availability: CliAvailabilityMap,
  agent: TaskAgent
): CliAvailability {
  return availability[agent] ?? UNKNOWN;
}

export function isCliUnavailable(availability: CliAvailabilityMap, agent: TaskAgent): boolean {
  const status = availabilityFor(availability, agent).status;
  return status === "missing" || status === "outdated";
}

export function agentCanLaunch(availability: CliAvailabilityMap, agent: TaskAgent): boolean {
  if (AGENT_REGISTRY[agent].disabled) return false;
  const status = availabilityFor(availability, agent).status;
  if (status === "available") return true;
  if (status === "unknown" && !getElectron()) return true;
  return false;
}

export function cliAvailabilityFromCheckResult(result: CliCheckResult): CliAvailability {
  if (result.ok) {
    const next: CliAvailability = { status: "available", path: result.path };
    if (result.label) next.label = result.label;
    if (result.version) next.version = result.version;
    if (result.requiredVersion) next.requiredVersion = result.requiredVersion;
    if (result.packageUrl) next.packageUrl = result.packageUrl;
    if (result.updateCommands) next.updateCommands = result.updateCommands;
    return next;
  }
  if (result.reason === "outdated" || result.reason === "version-unknown" || result.reason === "version-check-failed") {
    const next: CliAvailability = { status: "outdated", reason: result.reason };
    if (result.path) next.path = result.path;
    if (result.label) next.label = result.label;
    if (result.version) next.version = result.version;
    if (result.requiredVersion) next.requiredVersion = result.requiredVersion;
    if (result.packageUrl) next.packageUrl = result.packageUrl;
    if (result.updateCommands) next.updateCommands = result.updateCommands;
    return next;
  }
  return { status: "missing", reason: result.reason };
}

export function firstAvailableAgent(availability: CliAvailabilityMap): TaskAgent | null {
  return (
    UI_AGENTS.find(
      (agent) => agentCanLaunch(availability, agent)
    ) ?? null
  );
}

export function checkCliAvailabilityOnce() {
  if (started || typeof window === "undefined") return;
  started = true;

  const electron = getElectron();
  if (!electron) return;

  for (const agent of UI_AGENTS) {
    if (AGENT_REGISTRY[agent].disabled) continue;
    const command = AGENT_REGISTRY[agent].command;
    setAgentAvailability(agent, { status: "checking" });
    void electron
      .cliCheck(command)
      .then((result) => {
        setAgentAvailability(agent, cliAvailabilityFromCheckResult(result));
      })
      .catch((err) => {
        setAgentAvailability(agent, {
          status: "missing",
          reason: err instanceof Error ? err.message : "check-failed",
        });
      });
  }
}

export function useWarmCliAvailability() {
  useEffect(() => {
    checkCliAvailabilityOnce();
  }, []);
}

export function useCliAvailability(): CliAvailabilityMap {
  useWarmCliAvailability();
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
