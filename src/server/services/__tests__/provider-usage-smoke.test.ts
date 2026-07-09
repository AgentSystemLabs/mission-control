import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getProviderUsage } from "../provider-usage";
import { readCodexOAuthCredentials } from "../provider-usage/codex-usage";
import { readCursorAppSession } from "../provider-usage/cursor-usage";
import { readClaudeOAuthToken } from "../claude-usage-limits";

/**
 * Live smoke against local credentials when present. Writes evidence when
 * SCRATCH (or default implementer scratch) is set. Does not fail the suite
 * if providers are unauthenticated — that is a valid host outcome.
 */
describe("provider-usage live smoke", () => {
  it("returns multi-provider payload on this host", async () => {
    const scratch =
      process.env.SCRATCH ||
      path.join(
        process.env.LOCALAPPDATA || process.env.TMP || ".",
        "Temp",
        "grok-goal-fbb5878009d5",
        "implementer",
      );
    fs.mkdirSync(scratch, { recursive: true });
    const log: string[] = [];
    const line = (s: string) => log.push(s);
    line("=== provider-usage smoke (Windows host) ===");
    line("platform: " + process.platform);
    line("claude token present: " + Boolean(readClaudeOAuthToken()));
    line("codex creds present: " + Boolean(readCodexOAuthCredentials()));
    line("cursor session present: " + Boolean(readCursorAppSession()));
    const result = await getProviderUsage(["claude", "codex", "cursor", "openrouter"]);
    fs.writeFileSync(path.join(scratch, "provider-usage-api.json"), JSON.stringify(result, null, 2));
    line("wrote provider-usage-api.json");
    for (const p of result.providers) {
      line(
        p.id +
          ": status=" +
          p.status +
          " windows=" +
          p.windows.length +
          (p.error ? " error=" + p.error : ""),
      );
      for (const w of p.windows) {
        line(
          "  - " +
            w.id +
            " " +
            (w.utilization === null ? (w.detail ?? "—") : Math.round(w.utilization) + "%") +
            (w.resetsAt ? " resets=" + w.resetsAt : ""),
        );
      }
    }
    expect(Array.isArray(result.providers)).toBe(true);
    expect(result.providers.length).toBeGreaterThanOrEqual(3);
    expect(result.providers.every((p) => typeof p.status === "string")).toBe(true);
    // not Claude-only legacy flat shape
    expect((result as { session?: unknown }).session).toBeUndefined();
    fs.writeFileSync(path.join(scratch, "provider-usage-smoke.log"), log.join("\n") + "\n");
    console.log(log.join("\n"));
  }, 60_000);
});
