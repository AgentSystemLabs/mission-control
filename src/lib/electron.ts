// Thin client-side wrapper for the Electron preload bridge.

import type { ElectronBridge } from "~/shared/electron-contract";

export type { ElectronBridge } from "~/shared/electron-contract";

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}

export function getElectron(): ElectronBridge | null {
  if (typeof window === "undefined") return null;
  return window.electronAPI ?? null;
}

export function isElectron(): boolean {
  return getElectron() !== null;
}
