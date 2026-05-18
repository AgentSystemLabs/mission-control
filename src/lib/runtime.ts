import { isElectron } from "./electron";
import type { MissionControlRuntime } from "~/shared/runtime";

export function getClientRuntime(): MissionControlRuntime {
  return isElectron() ? "electron-local" : "web-daytona";
}

export function isWebDaytonaRuntime(): boolean {
  return getClientRuntime() === "web-daytona";
}

