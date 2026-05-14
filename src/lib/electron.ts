// Compatibility wrapper. New shared UI code should import from ~/lib/runtime.

import { getRuntime } from "./runtime";
import type { RuntimeBridge } from "~/shared/runtime-contract";

export type { RuntimeBridge as ElectronBridge } from "~/shared/runtime-contract";

export function getElectron(): RuntimeBridge | null {
  return getRuntime();
}

export function isElectron(): boolean {
  return getRuntime()?.hostKind === "desktop";
}
