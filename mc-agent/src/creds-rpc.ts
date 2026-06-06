import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CredsKind, CredsTool, RpcParams } from "./protocol";

// AI-CLI credential provisioning inside the sandbox (US: "Copy my AI tool
// credentials"). The host reads its local logins (Claude/Codex/Cursor/OpenCode)
// and sends labelled items { tool, kind, content }; THIS side owns where each
// item lands, resolved against the VM's own HOME / CLAUDE_CONFIG_DIR / XDG dirs
// (so macOS-host → Linux-VM and docker-vs-AWS path differences stay here, where
// the real environment is known). Mirrors ssh-rpc.ts: a dedicated RPC that
// writes secrets with 0600 perms, bypassing FileRpc's sensitive-path block.

export type CredsSetupParams = RpcParams["creds.setup"];
export type CredsSetupResult = { wrote: number };

const MAX_CRED_BYTES = 256 * 1024;
const TOOLS: ReadonlySet<CredsTool> = new Set<CredsTool>(["claude", "codex", "cursor", "opencode"]);
const KINDS: ReadonlySet<CredsKind> = new Set<CredsKind>(["credentials", "state"]);

export class CredsRpc {
  constructor(
    private readonly home: string = os.homedir(),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async setup(params: CredsSetupParams): Promise<CredsSetupResult> {
    const items = Array.isArray(params?.items) ? params.items : [];
    let wrote = 0;
    for (const item of items) {
      if (!item || typeof item !== "object" || typeof item.content !== "string") continue;
      if (!TOOLS.has(item.tool) || !KINDS.has(item.kind)) continue;
      if (item.content.length === 0 || Buffer.byteLength(item.content, "utf8") > MAX_CRED_BYTES) continue;
      const dest = this.destFor(item.tool, item.kind);
      if (!dest) continue;
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
        // Claude's state file (.claude.json) may already exist on a persisted
        // volume — shallow-merge our auth/onboarding keys so VM-side state isn't
        // clobbered. Pure credential files are overwritten (host token wins).
        const content =
          item.tool === "claude" && item.kind === "state"
            ? mergeJson(dest, item.content)
            : item.content;
        fs.writeFileSync(dest, content, { mode: 0o600 });
        try {
          fs.chmodSync(dest, 0o600);
        } catch {
          /* best effort */
        }
        wrote += 1;
      } catch {
        // Skip an item we can't place (unwritable dir, etc.) — never fail the
        // whole batch over one tool.
      }
    }
    return { wrote };
  }

  /** Where (tool, kind) lands on this VM, honoring CLAUDE_CONFIG_DIR / XDG_*. */
  private destFor(tool: CredsTool, kind: CredsKind): string | null {
    const configHome = this.env.XDG_CONFIG_HOME || path.join(this.home, ".config");
    const dataHome = this.env.XDG_DATA_HOME || path.join(this.home, ".local", "share");
    const claudeDir = this.env.CLAUDE_CONFIG_DIR || path.join(this.home, ".claude");
    switch (tool) {
      case "claude":
        if (kind === "credentials") return path.join(claudeDir, ".credentials.json");
        // With CLAUDE_CONFIG_DIR set (the sandbox compose does this) the session
        // state file lives inside it; otherwise it's ~/.claude.json at HOME root.
        return this.env.CLAUDE_CONFIG_DIR
          ? path.join(this.env.CLAUDE_CONFIG_DIR, ".claude.json")
          : path.join(this.home, ".claude.json");
      case "codex":
        return kind === "credentials" ? path.join(this.home, ".codex", "auth.json") : null;
      case "cursor":
        // cursor-agent reads ~/.config/cursor-agent/auth.json on Linux (no keychain).
        return kind === "credentials" ? path.join(configHome, "cursor-agent", "auth.json") : null;
      case "opencode":
        return kind === "credentials" ? path.join(dataHome, "opencode", "auth.json") : null;
      default:
        return null;
    }
  }
}

/** Shallow-merge incoming JSON over any existing object at `dest`. Falls back to
 *  the incoming string verbatim if either side isn't a JSON object. */
function mergeJson(dest: string, incoming: string): string {
  let next: unknown;
  try {
    next = JSON.parse(incoming);
  } catch {
    return incoming;
  }
  if (!next || typeof next !== "object") return incoming;
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(dest)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(dest, "utf8"));
      if (parsed && typeof parsed === "object") existing = parsed as Record<string, unknown>;
    }
  } catch {
    /* corrupt/unreadable existing file — overwrite with our keys only */
  }
  return JSON.stringify({ ...existing, ...(next as Record<string, unknown>) }, null, 2);
}
