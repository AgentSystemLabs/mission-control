import { ipcMain } from "electron";
import type { IpcMain, IpcMainInvokeEvent, WebFrameMain } from "electron";
import log from "electron-log/main";

// Every ipcMain.handle in this app should go through safeHandle. The wrapper
// rejects calls whose sender frame is either (a) not the top frame of the
// BrowserWindow, or (b) not loaded from an origin in `allowedOrigins`.
//
// Configure once at startup with the URL(s) the renderer is allowed to load
// from (`configureIpcAllowedOrigins([url])`) before any window finishes
// loading. The allow-list is matched on the URL's WHATWG `origin` only — route
// path doesn't matter.
let allowedOrigins: ReadonlySet<string> = new Set();

function toOrigin(maybeUrl: string | null | undefined): string | null {
  if (!maybeUrl) return null;
  try {
    // url.origin normalizes scheme/host/port per the WHATWG spec. The allow-list
    // and the runtime check both go through this so they can never disagree.
    return new URL(maybeUrl).origin;
  } catch {
    return null;
  }
}

export function configureIpcAllowedOrigins(urls: readonly string[]): void {
  const set = new Set<string>();
  for (const raw of urls) {
    const origin = toOrigin(raw);
    if (origin) set.add(origin);
  }
  // Near-one-shot: the trust root for the entire IPC surface should not be
  // re-pointable from elsewhere in the codebase. Re-arming with the IDENTICAL
  // origin set is a no-op — createWindow re-runs on macOS `app.on('activate')`
  // (dock click after the last window was closed) and re-arms with the same
  // origin — but any DIFFERENT set still throws. Tests reset via the helper below.
  if (allowedOrigins.size > 0) {
    const same =
      set.size === allowedOrigins.size && [...set].every((origin) => allowedOrigins.has(origin));
    if (same) return;
    throw new Error("ipc-safe-handle: allowed origins already configured");
  }
  allowedOrigins = set;
}

// Test-only escape hatch. Production code never calls this.
export function __resetIpcAllowedOriginsForTesting(): void {
  allowedOrigins = new Set();
}

export function getIpcAllowedOrigins(): ReadonlySet<string> {
  return allowedOrigins;
}

export type FrameLike = Pick<WebFrameMain, "url"> & { top: FrameLike | null };

export function isFrameAllowed(
  frame: FrameLike | null,
  origins: ReadonlySet<string> = allowedOrigins,
): boolean {
  if (!frame) return false;
  if (frame.top !== frame) return false;
  if (origins.size === 0) return false;
  const origin = toOrigin(frame.url);
  if (!origin) return false;
  return origins.has(origin);
}

export function safeHandle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
  ipc: IpcMain = ipcMain,
): void {
  ipc.handle(channel, (event, ...args) => {
    const frame = event.senderFrame as FrameLike | null;
    if (!isFrameAllowed(frame)) {
      // Full URL goes to the main-process log only; the error thrown back to
      // the renderer carries just the origin so a query-string token (if one is
      // ever added to renderer URLs) can't echo back through devtools.
      const fullUrl = frame?.url ?? "<no-frame>";
      const safeOrigin = toOrigin(frame?.url) ?? "<no-origin>";
      log.warn("ipc.rejected", { channel, frameUrl: fullUrl });
      throw new Error(`ipc: rejected sender for channel "${channel}" (origin=${safeOrigin})`);
    }
    return handler(event, ...args);
  });
}
