// Battery-saver mode. Active while the machine is on battery AND the
// "Reduce energy use on battery" setting (default on) is enabled. When active:
//   - `data-power-save` is set on <html>, and styles.css freezes the
//     decorative infinite animations (session-icon stroke draw, activity
//     shimmer/pulse, pinned-project sweep);
//   - CursorGlow stops rendering its pointer-following gradient;
//   - terminal cursors stop blinking (panes watch via `watchPowerSave`);
//   - the idle git-status poll stretches (see src/queries/git.ts).
// The battery signal comes from the main process's powerMonitor over IPC; in
// a plain browser (no preload) it stays false and none of this engages.

import { useEffect, useSyncExternalStore } from "react";
import { getElectron } from "~/lib/electron";
import { useSettings } from "~/queries";

let powerSaveActive = false;
const activeListeners = new Set<() => void>();

function setPowerSaveActive(next: boolean): void {
  if (powerSaveActive === next) return;
  powerSaveActive = next;
  document.documentElement.toggleAttribute("data-power-save", next);
  // The main process slows the PTY output pump for non-interactive terminals
  // while saver is active (see electron/pty-output-batch.ts).
  void getElectron()?.power?.setSaverActive(next).catch(() => undefined);
  for (const listener of activeListeners) listener();
}

/** Snapshot read — safe from non-React modules (query intervals, terminals). */
export function isPowerSaveActive(): boolean {
  return powerSaveActive;
}

/** Notifies on every activate/deactivate. Returns an unsubscribe fn. */
export function watchPowerSave(listener: () => void): () => void {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}

// ── Battery signal (main-process powerMonitor over IPC) ─────────────────────
let onBattery = false;
let batteryWired = false;
const batteryListeners = new Set<() => void>();

function updateOnBattery(next: boolean): void {
  if (onBattery === next) return;
  onBattery = next;
  for (const listener of batteryListeners) listener();
}

function subscribeBattery(listener: () => void): () => void {
  if (!batteryWired) {
    batteryWired = true;
    const electron = getElectron();
    // Optional-chained: absent in the browser and in older preloads.
    electron?.power
      ?.getOnBattery()
      .then(updateOnBattery)
      .catch(() => undefined);
    electron?.power?.onBatteryChange(updateOnBattery);
  }
  batteryListeners.add(listener);
  return () => {
    batteryListeners.delete(listener);
  };
}

export function useOnBattery(): boolean {
  return useSyncExternalStore(
    subscribeBattery,
    () => onBattery,
    () => false,
  );
}

/** Reactive power-save flag for components (e.g. CursorGlow). */
export function usePowerSaveActive(): boolean {
  return useSyncExternalStore(
    watchPowerSave,
    () => powerSaveActive,
    () => false,
  );
}

/**
 * Combines the battery signal with the user setting and drives the module
 * state + the `data-power-save` root attribute. Mount exactly once, in the
 * root shell.
 */
export function usePowerSaveController(): void {
  const { data: settings } = useSettings();
  const batterySaverEnabled = settings?.batterySaverEnabled ?? true;
  const onBatteryNow = useOnBattery();
  useEffect(() => {
    setPowerSaveActive(batterySaverEnabled && onBatteryNow);
  }, [batterySaverEnabled, onBatteryNow]);
}
