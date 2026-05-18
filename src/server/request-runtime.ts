import {
  MISSION_CONTROL_RUNTIME_HEADER,
  type MissionControlRuntime,
} from "~/shared/runtime";
import { requireBearerToken } from "./auth";

export function getRequestRuntime(request: Request): MissionControlRuntime | null {
  const runtime = request.headers.get(MISSION_CONTROL_RUNTIME_HEADER);
  return runtime === "electron-local" || runtime === "web-daytona" ? runtime : null;
}

export function isElectronLocalApiRequest(request: Request): boolean {
  return getRequestRuntime(request) === "electron-local" && requireBearerToken(request).ok;
}
