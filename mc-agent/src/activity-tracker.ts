import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "./logger";

/**
 * Records "the agent is doing work" by bumping a heartbeat file's mtime. An on-VM
 * systemd timer reads that mtime to decide whether to stop an idle instance (see
 * renderIdleWatchdog in scripts/remote-vm.mjs). Writes are throttled so a chatty
 * PTY doesn't thrash the disk; failures are logged but never thrown (a heartbeat
 * problem must not take down a connection). A blank path disables it entirely,
 * which is the default for Docker sandboxes and local testing.
 */
export class ActivityTracker {
  private lastWrite = 0;

  constructor(
    private readonly filePath: string,
    private readonly throttleMs = 15_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Heartbeat ignoring the throttle — use on startup and WS connect. */
  touchNow(): void {
    this.write(this.now());
  }

  /** Throttled heartbeat for hot paths (PTY I/O, RPC dispatch). */
  touch(): void {
    if (!this.filePath) return;
    const t = this.now();
    // Always write the very first time; otherwise respect the throttle window.
    if (this.lastWrite !== 0 && t - this.lastWrite < this.throttleMs) return;
    this.write(t);
  }

  private write(t: number): void {
    if (!this.filePath) return;
    this.lastWrite = t;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, `${t}\n`);
    } catch (err) {
      log("warn", "activity.write.fail", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
