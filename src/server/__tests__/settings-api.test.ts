import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { emptyVoiceCommandAliases } from "~/shared/voice-command-aliases";
import { DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY } from "~/shared/session-header-buttons";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-settings-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getDb } = await import("~/db/client");
const { appSettings } = await import("~/db/schema");
const { getOrCreateApiToken } = await import("../services/settings");

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function authedRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("authorization")) {
    headers.set("authorization", `Bearer ${getOrCreateApiToken()}`);
  }
  return new Request(input, { ...init, headers });
}

describe("settings API", () => {
  beforeEach(() => {
    getDb().delete(appSettings).run();
  });

  it("keeps mouse gradients enabled by default", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      mouseGradientDisabled: false,
    });
  });

  it("keeps the launch intro disabled by default", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      launchOverlayEnabled: false,
    });
  });

  it("keeps automatic update downloads disabled by default", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      automaticUpdateDownloadsEnabled: false,
      automaticUpdateInstallOnQuitEnabled: false,
      terminalZoomLevel: 0,
    });
  });

  it("keeps Claude usage limits off by default, with both windows shown", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      claudeUsageLimitsEnabled: false,
      claudeUsageLimitsShowSession: true,
      claudeUsageLimitsShowWeekly: true,
      providerUsageEnabled: false,
      providerUsageIds: ["claude", "codex", "cursor"],
    });
  });

  it("persists Claude usage limit toggles", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claudeUsageLimitsEnabled: true,
          claudeUsageLimitsShowWeekly: false,
        }),
      }),
    );
    expect(update?.status).toBe(200);

    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );
    expect(await jsonBody(read!)).toMatchObject({
      claudeUsageLimitsEnabled: true,
      claudeUsageLimitsShowSession: true,
      claudeUsageLimitsShowWeekly: false,
    });
  });

  it("persists multi-provider usage toggles", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerUsageEnabled: true,
          providerUsageIds: ["claude", "codex"],
        }),
      }),
    );
    expect(update?.status).toBe(200);

    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );
    expect(await jsonBody(read!)).toMatchObject({
      providerUsageEnabled: true,
      providerUsageIds: ["claude", "codex"],
      claudeUsageLimitsEnabled: true,
    });
  });

  it("defaults the agent launcher config to all agents visible in canonical order", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      agentLauncherConfig: {
        order: ["claude-code", "codex", "cursor-cli", "opencode"],
        hidden: [],
      },
    });
  });

  it("persists a reordered agent launcher config and normalizes unknown ids", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentLauncherConfig: {
            order: ["codex", "made-up-agent", "claude-code"],
            hidden: ["opencode", "also-fake"],
          },
        }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    const expected = {
      order: ["codex", "claude-code", "cursor-cli", "opencode"],
      hidden: ["opencode"],
    };
    expect(await jsonBody(update!)).toMatchObject({ agentLauncherConfig: expected });
    expect(await jsonBody(read!)).toMatchObject({ agentLauncherConfig: expected });
  });

  it("refuses to hide every launcher agent", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentLauncherConfig: {
            order: ["cursor-cli", "codex", "claude-code", "opencode"],
            hidden: ["claude-code", "codex", "cursor-cli", "opencode"],
          },
        }),
      }),
    );

    expect(update?.status).toBe(200);
    const body = await jsonBody(update!);
    const config = body.agentLauncherConfig as { order: string[]; hidden: string[] };
    expect(config.hidden).not.toContain("cursor-cli");
    expect(config.order.filter((id) => !config.hidden.includes(id))).toEqual(["cursor-cli"]);
  });

  it("rejects a malformed agent launcher config payload", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentLauncherConfig: "codex-first" }),
      }),
    );
    expect(update?.status).toBe(400);
  });

  it("defaults Recall off: master switch and every gated flag disabled", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      recallEnabled: false,
      recallAutoCaptureEnabled: false,
      recallEngineEnabled: false,
      // Harness + model aren't gated by the master switch, so they keep defaults.
      recallEngineHarness: "claude-code",
      recallEngineModel: null,
      recallAgentWriteEnabled: false,
      recallInjectBriefEnabled: false,
      recallCodeGraphEnabled: false,
      recallProactiveRecallEnabled: false,
      recallLearnedToastEnabled: false,
    });
  });

  it("recallEnabled=false forces every Recall flag off, and re-enabling restores stored values", async () => {
    // Store an explicit non-default sub-setting so we can see it survive the off/on cycle.
    await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recallAutoCaptureEnabled: false }),
      }),
    );

    const disabled = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recallEnabled: false }),
      }),
    );
    expect(disabled?.status).toBe(200);
    expect(await jsonBody(disabled!)).toMatchObject({
      recallEnabled: false,
      recallAutoCaptureEnabled: false,
      recallEngineEnabled: false,
      recallAgentWriteEnabled: false,
      recallInjectBriefEnabled: false,
      recallCodeGraphEnabled: false,
      recallProactiveRecallEnabled: false,
      recallLearnedToastEnabled: false,
    });

    const reenabled = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recallEnabled: true }),
      }),
    );
    expect(await jsonBody(reenabled!)).toMatchObject({
      recallEnabled: true,
      // Explicitly stored off — must survive the master toggle round-trip.
      recallAutoCaptureEnabled: false,
      // Defaults come back on.
      recallEngineEnabled: true,
      recallAgentWriteEnabled: true,
      recallInjectBriefEnabled: true,
      recallCodeGraphEnabled: true,
      recallProactiveRecallEnabled: true,
      recallLearnedToastEnabled: true,
    });
  });

  it("persists Recall engine harness + model and toggles", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recallEnabled: true,
          recallAutoCaptureEnabled: false,
          recallEngineHarness: "codex",
          recallEngineModel: "gpt-5.5",
        }),
      }),
    );
    expect(update?.status).toBe(200);

    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(read!)).toMatchObject({
      recallAutoCaptureEnabled: false,
      recallEngineHarness: "codex",
      recallEngineModel: "gpt-5.5",
      recallEngineEnabled: true,
    });
  });

  it("clears the Recall engine model when set to null", async () => {
    await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recallEngineModel: "opus" }),
      }),
    );
    await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recallEngineModel: null }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(read!)).toMatchObject({ recallEngineModel: null });
  });

  it("persists the default terminal zoom level", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terminalZoomLevel: 2 }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ terminalZoomLevel: 2 });
    expect(await jsonBody(read!)).toMatchObject({ terminalZoomLevel: 2 });
  });

  it("hides the zoom session button by default and shows the rest", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(response!)).toMatchObject({
      sessionHeaderButtons: DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY,
    });
    expect(DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY).toMatchObject({
      rename: true,
      zoom: false,
      clone: true,
      focus: true,
    });
  });

  it("persists session button visibility, merging a partial payload over defaults", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Only send the two the user changed; unknown keys are dropped and the
        // rest fall back to their defaults.
        body: JSON.stringify({ sessionHeaderButtons: { zoom: true, clone: false, bogus: true } }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    const expected = { rename: true, zoom: true, clone: false, focus: true };
    expect(await jsonBody(update!)).toMatchObject({ sessionHeaderButtons: expected });
    expect(await jsonBody(read!)).toMatchObject({ sessionHeaderButtons: expected });
  });

  it("defaults voice agents to Claude Code with no model until one is chosen", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(response!)).toMatchObject({
      defaultAgent: "claude-code",
      defaultModel: null,
    });
  });

  it("has no custom voice command aliases by default", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(response!)).toMatchObject({
      voiceCommandAliases: emptyVoiceCommandAliases(),
    });
  });

  it("persists the default harness and generic model for voice-started agents", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultAgent: "codex", defaultModel: "gpt-5.3-codex" }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      defaultAgent: "codex",
      defaultModel: "gpt-5.3-codex",
    });
    expect(await jsonBody(read!)).toMatchObject({
      defaultAgent: "codex",
      defaultModel: "gpt-5.3-codex",
    });
  });

  it("rejects an unsafe default model value", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultModel: "gpt-4; rm -rf /" }),
      }),
    );
    expect(update?.status).toBe(400);
  });

  it("defaults markdown annotations to Claude Code with no model until one is chosen", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(response!)).toMatchObject({
      annotationAgent: "claude-code",
      annotationModel: null,
    });
  });

  it("defaults Ship to Claude Code with the sync prompt until customized", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(response!)).toMatchObject({
      shipAgent: "claude-code",
      shipModel: null,
      shipPrompt:
        "commit my changes, then push my latest branch changes to remote, and if upstream changes exist, pull them, fix conflict, and push when resolved.",
    });
  });

  it("persists the annotation harness and model independently of the voice default", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          annotationAgent: "opencode",
          annotationModel: "anthropic/claude-sonnet-4-5",
        }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    // The annotation runtime is set without disturbing the voice default.
    expect(await jsonBody(update!)).toMatchObject({
      annotationAgent: "opencode",
      annotationModel: "anthropic/claude-sonnet-4-5",
      defaultAgent: "claude-code",
      defaultModel: null,
    });
    expect(await jsonBody(read!)).toMatchObject({
      annotationAgent: "opencode",
      annotationModel: "anthropic/claude-sonnet-4-5",
      defaultAgent: "claude-code",
      defaultModel: null,
    });
  });

  it("rejects an unsafe annotation model value", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ annotationModel: "$(whoami)" }),
      }),
    );
    expect(update?.status).toBe(400);
  });

  it("persists the Ship harness, model, and prompt independently of voice defaults", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipAgent: "codex",
          shipModel: "gpt-5.3-codex",
          shipPrompt: "  push and reconcile with origin  ",
        }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      shipAgent: "codex",
      shipModel: "gpt-5.3-codex",
      shipPrompt: "push and reconcile with origin",
      defaultAgent: "claude-code",
      defaultModel: null,
    });
    expect(await jsonBody(read!)).toMatchObject({
      shipAgent: "codex",
      shipModel: "gpt-5.3-codex",
      shipPrompt: "push and reconcile with origin",
    });
  });

  it("rejects an unsafe ship model value", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shipModel: "gpt-4; rm -rf /" }),
      }),
    );
    expect(update?.status).toBe(400);
  });

  it("persists normalized custom voice command aliases", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          voiceCommandAliases: {
            ship: [" Send It! ", "send it"],
            "switch-project": ["Hop To"],
            "new-agent": ["tell the agent"],
          },
        }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      voiceCommandAliases: {
        ...emptyVoiceCommandAliases(),
        ship: ["send it"],
        "switch-project": ["hop to"],
        "new-agent": ["tell the agent"],
      },
    });
    expect(await jsonBody(read!)).toMatchObject({
      voiceCommandAliases: {
        ...emptyVoiceCommandAliases(),
        ship: ["send it"],
        "switch-project": ["hop to"],
        "new-agent": ["tell the agent"],
      },
    });
  });

  it("rejects invalid custom voice command alias payloads", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          voiceCommandAliases: {
            "unknown-command": ["send it"],
          },
        }),
      }),
    );

    expect(update?.status).toBe(400);
  });

  it("persists the mouse gradient preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mouseGradientDisabled: true }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      mouseGradientDisabled: true,
    });
    expect(await jsonBody(read!)).toMatchObject({
      mouseGradientDisabled: true,
    });
  });

  it("persists the launch intro preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launchOverlayEnabled: true }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      launchOverlayEnabled: true,
    });
    expect(await jsonBody(read!)).toMatchObject({
      launchOverlayEnabled: true,
    });
  });

  it("persists the automatic update download preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ automaticUpdateDownloadsEnabled: true }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      automaticUpdateDownloadsEnabled: true,
    });
    expect(await jsonBody(read!)).toMatchObject({
      automaticUpdateDownloadsEnabled: true,
    });
  });

  it("persists the automatic update install-on-quit preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ automaticUpdateInstallOnQuitEnabled: true }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      automaticUpdateInstallOnQuitEnabled: true,
    });
    expect(await jsonBody(read!)).toMatchObject({
      automaticUpdateInstallOnQuitEnabled: true,
    });
  });

  it("keeps notification sound enabled by default", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      notificationSoundEnabled: true,
    });
  });

  it("persists the notification sound preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationSoundEnabled: false }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      notificationSoundEnabled: false,
    });
    expect(await jsonBody(read!)).toMatchObject({
      notificationSoundEnabled: false,
    });
  });

  it("keeps spellcheck enabled by default", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      spellcheckEnabled: true,
    });
  });

  it("persists the spellcheck preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spellcheckEnabled: false }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ spellcheckEnabled: false });
    expect(await jsonBody(read!)).toMatchObject({ spellcheckEnabled: false });
  });

  it("keeps worktrees enabled (always on)", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      worktreesEnabled: true,
    });
  });

  it("leaves durable UI preferences unset by default", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      gitDiffChangedFilesView: null,
      gitDiffChangedFilesWidth: null,
      projectsDashboardView: null,
      selectedWorktreeByProject: null,
    });
  });

  it("ignores attempts to disable worktrees", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worktreesEnabled: false }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      worktreesEnabled: true,
    });
    expect(await jsonBody(read!)).toMatchObject({
      worktreesEnabled: true,
    });
  });

  it("keeps voice control disabled by default (experimental)", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(response!)).toMatchObject({ voiceControlEnabled: false });
  });

  it("persists the voice control preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceControlEnabled: true }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ voiceControlEnabled: true });
    expect(await jsonBody(read!)).toMatchObject({ voiceControlEnabled: true });
  });

  it("keeps multiplayer pets disabled by default (opt-in)", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(response!)).toMatchObject({ petMultiplayerEnabled: false });
  });

  it("persists the multiplayer pets preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ petMultiplayerEnabled: true }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ petMultiplayerEnabled: true });
    expect(await jsonBody(read!)).toMatchObject({ petMultiplayerEnabled: true });
  });

  it("homes the pet on the right by default", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(response!)).toMatchObject({ petHomeSide: "right" });
  });

  it("persists the pet home corner preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ petHomeSide: "left" }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ petHomeSide: "left" });
    expect(await jsonBody(read!)).toMatchObject({ petHomeSide: "left" });
  });

  it("rejects an invalid pet home corner", async () => {
    const rejected = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ petHomeSide: "top" }),
      }),
    );
    expect(rejected?.status).toBe(400);
  });

  it("keeps the question overlay enabled by default (beta)", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));
    expect(await jsonBody(response!)).toMatchObject({ questionOverlayEnabled: true });
  });

  it("persists the question overlay preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionOverlayEnabled: false }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ questionOverlayEnabled: false });
    expect(await jsonBody(read!)).toMatchObject({ questionOverlayEnabled: false });
  });

  it("persists durable UI preferences", async () => {
    const selectedWorktreeByProject = { "project-1": "worktree-2" };
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gitDiffChangedFilesView: "tree",
          gitDiffChangedFilesWidth: 420,
          projectsDashboardView: "table",
          selectedWorktreeByProject,
        }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      gitDiffChangedFilesView: "tree",
      gitDiffChangedFilesWidth: 420,
      projectsDashboardView: "table",
      selectedWorktreeByProject,
    });
    expect(await jsonBody(read!)).toMatchObject({
      gitDiffChangedFilesView: "tree",
      gitDiffChangedFilesWidth: 420,
      projectsDashboardView: "table",
      selectedWorktreeByProject,
    });
  });

  it("defaults to the painted theme style", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      themeStyle: "painted",
      minimalTheme: false,
    });
  });

  it("persists the flat theme style and derives minimalTheme from it", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeStyle: "flat" }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      themeStyle: "flat",
      minimalTheme: true,
    });
    expect(await jsonBody(read!)).toMatchObject({
      themeStyle: "flat",
      minimalTheme: true,
    });
  });

  it("rejects a legacy theme style (noir / ember) on write", async () => {
    for (const legacy of ["noir", "ember", "minimal"]) {
      const response = await handleApiRequest(
        authedRequest("http://localhost/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ themeStyle: legacy }),
        }),
      );
      expect(response?.status).toBe(400);
    }
  });

  it("migrates a legacy theme_style row (noir / ember / minimal) to flat on read", async () => {
    for (const legacy of ["noir", "ember", "minimal"]) {
      getDb().delete(appSettings).run();
      getDb()
        .insert(appSettings)
        .values({ key: "theme_style", value: legacy })
        .run();
      const read = await handleApiRequest(
        authedRequest("http://localhost/api/settings"),
      );
      expect(await jsonBody(read!)).toMatchObject({
        themeStyle: "flat",
        minimalTheme: true,
      });
    }
  });

  it("defaults the surface tint to subtle", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({ surfaceTint: "subtle" });
  });

  it("persists the surface tint", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ surfaceTint: "vivid" }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ surfaceTint: "vivid" });
    expect(await jsonBody(read!)).toMatchObject({ surfaceTint: "vivid" });
  });

  it("persists the intense surface tint", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ surfaceTint: "intense" }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ surfaceTint: "intense" });
    expect(await jsonBody(read!)).toMatchObject({ surfaceTint: "intense" });
  });

  it("persists an explicit off surface tint", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ surfaceTint: "off" }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(read!)).toMatchObject({ surfaceTint: "off" });
  });

  it("rejects an invalid surface tint", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ surfaceTint: "neon" }),
      }),
    );

    expect(update?.status).toBe(400);
  });

  it("reports no theme chosen on a fresh install", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({ themeChosen: false });
  });

  it("reports the theme as chosen once a style is saved, even the default one", async () => {
    // "painted" is the default themeStyle: the raw-key check must distinguish
    // "picked the default" from "never picked", which the normalized
    // themeStyle field cannot.
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeStyle: "painted" }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ themeChosen: true });
    expect(await jsonBody(read!)).toMatchObject({ themeChosen: true });
  });

  it("reports the theme as chosen once an accent color is saved", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accentColor: "terracotta" }),
      }),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ themeChosen: true });
  });

  it("counts the legacy minimalTheme toggle as a chosen theme", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minimalTheme: true }),
      }),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({ themeChosen: true });
  });

  it("rejects an unknown theme style", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeStyle: "vaporwave" }),
      }),
    );

    expect(response?.status).toBe(400);
  });

  it("maps an install that only stored the legacy minimal flag to the flat style", async () => {
    // Simulate a database written by a build that predates theme_style.
    getDb().insert(appSettings).values({ key: "minimal_theme", value: "true" }).run();

    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(await jsonBody(response!)).toMatchObject({
      themeStyle: "flat",
      minimalTheme: true,
    });
  });

  it("selects flat when a legacy client sends minimalTheme: true", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minimalTheme: true }),
      }),
    );

    expect(await jsonBody(update!)).toMatchObject({
      themeStyle: "flat",
      minimalTheme: true,
    });
  });

  it("returns to painted when a legacy client sends minimalTheme: false", async () => {
    await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeStyle: "flat" }),
      }),
    );
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minimalTheme: false }),
      }),
    );

    expect(await jsonBody(update!)).toMatchObject({
      themeStyle: "painted",
      minimalTheme: false,
    });
  });

  it("enables the pet with messages on and sounds off by default, with no stored state", async () => {
    const response = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      petEnabled: true,
      petMessagesEnabled: true,
      petSoundsEnabled: false,
      petHomeSide: "right",
      petState: null,
    });
  });

  it("round-trips pet state, normalizing level from xp", async () => {
    const petState = {
      version: 1,
      name: "  Draco  ",
      xp: 160,
      level: 1, // stale on purpose — the server recomputes from xp
      personality: { snark: 7, wisdom: 4, chaos: 12, zen: -1 },
      createdAt: 1700000000000,
    };
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ petEnabled: false, petState }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(update?.status).toBe(200);
    const expected = {
      version: 1,
      name: "Draco",
      xp: 160,
      level: 3, // 160 xp crosses the 150 threshold
      personality: { snark: 7, wisdom: 4, chaos: 10, zen: 0 },
      createdAt: 1700000000000,
    };
    expect(await jsonBody(update!)).toMatchObject({ petEnabled: false, petState: expected });
    expect(await jsonBody(read!)).toMatchObject({ petEnabled: false, petState: expected });
  });

  it("rejects garbage pet state instead of erasing the stored pet", async () => {
    await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          petState: {
            version: 1,
            name: "Pixel",
            xp: 10,
            level: 1,
            personality: { snark: 1, wisdom: 1, chaos: 1, zen: 1 },
            createdAt: 1700000000000,
          },
        }),
      }),
    );
    const rejected = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ petState: "not a pet" }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    // A malformed write must never destroy the pet — only an explicit null may.
    expect(rejected?.status).toBe(400);
    expect(await jsonBody(read!)).toMatchObject({
      petState: { name: "Pixel", xp: 10 },
    });
  });

  it("clears stored pet state on an explicit null", async () => {
    await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          petState: {
            version: 1,
            name: "Pixel",
            xp: 10,
            level: 1,
            personality: { snark: 1, wisdom: 1, chaos: 1, zen: 1 },
            createdAt: 1700000000000,
          },
        }),
      }),
    );
    const cleared = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ petState: null }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(cleared?.status).toBe(200);
    expect(await jsonBody(read!)).toMatchObject({ petState: null });
  });

  it("a stale window's write cannot revert a molt or shrink progression", async () => {
    const personality = { snark: 1, wisdom: 1, chaos: 1, zen: 1 };
    // Window A persisted a molt: prestige 1, fresh xp, ember unlocked.
    await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          petState: {
            version: 1,
            name: "Zezo",
            species: "ember",
            xp: 5,
            prestige: 1,
            personality,
            stats: { sessions: 12, longSessions: 0, ships: 3, prs: 1, memories: 0, failures: 2, worstStreak: 2, pets: 20 },
            createdAt: 1700000000000,
          },
        }),
      }),
    );
    // Window B hydrated before the molt and blind-writes its stale copy.
    const staleWrite = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          petState: {
            version: 1,
            name: "Zezo",
            species: "chick",
            xp: 2980,
            prestige: 0,
            personality,
            stats: { sessions: 11, longSessions: 0, ships: 3, prs: 1, memories: 0, failures: 2, worstStreak: 2, pets: 25 },
            createdAt: 1700000000000,
          },
        }),
      }),
    );
    const read = await handleApiRequest(authedRequest("http://localhost/api/settings"));

    expect(staleWrite?.status).toBe(200);
    expect(await jsonBody(read!)).toMatchObject({
      petState: {
        prestige: 1, // the molt survives
        xp: 5,
        species: "chick", // cosmetic choice still follows the latest write
        stats: { sessions: 12, pets: 25 }, // lifetime counters keep their max
      },
    });
  });

  // Regression: GET /api/settings used to anonymously return the API bearer
  // token in the JSON body, collapsing the entire auth tier.
  // See todos/bugs/done/02-api-settings-leaks-bearer-token.md.
  it("never returns the API bearer token over HTTP", async () => {
    const token = getOrCreateApiToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const getResponse = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );
    const getBody = await jsonBody(getResponse!);
    expect(getResponse?.status).toBe(200);
    expect(getBody).not.toHaveProperty("apiToken");
    expect(JSON.stringify(getBody)).not.toContain(token);

    const postResponse = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      }),
    );
    // The schema rejects `regenerate` outright (strict object) so the request
    // never reaches a code path that could rotate or echo the token.
    expect(postResponse?.status).toBe(400);
    const postBody = await jsonBody(postResponse!);
    expect(postBody).not.toHaveProperty("apiToken");
    expect(JSON.stringify(postBody)).not.toContain(token);

    const tokenAfterRegenerateAttempt = getOrCreateApiToken();
    expect(tokenAfterRegenerateAttempt).toBe(token);
  });
});
