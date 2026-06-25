// Renderer command bus for voice. VoiceController (mounted at the app root)
// recognizes a command and dispatches one of these `mc:*` window CustomEvents;
// the active project route listens and performs the project-scoped action.
// This mirrors the existing `mc:*` CustomEvent pattern (see
// session-notification-store) rather than synthesizing keystrokes.

import type { TaskAgent } from "~/shared/domain";

export const VOICE_RUN_PROJECT_EVENT = "mc:voice-run-project";
export const VOICE_OPEN_BROWSER_EVENT = "mc:voice-open-browser";
export const VOICE_OPEN_DIFF_EVENT = "mc:voice-open-diff";
export const VOICE_SHIP_EVENT = "mc:voice-ship";
export const VOICE_RUN_SCRIPT_EVENT = "mc:voice-run-script";
export const VOICE_NEW_AGENT_EVENT = "mc:voice-new-agent";

export type VoiceNewAgentDetail = {
  /** The task to seed the new agent session with (may be empty). */
  prompt: string;
  /** Which agent CLI to launch; defaults to claude-code when unspecified. */
  agent?: TaskAgent;
};

export type VoiceRunScriptDetail = { scriptId: string };

export function dispatchVoiceRunProject(): void {
  window.dispatchEvent(new CustomEvent(VOICE_RUN_PROJECT_EVENT));
}

export function dispatchVoiceOpenBrowser(): void {
  window.dispatchEvent(new CustomEvent(VOICE_OPEN_BROWSER_EVENT));
}

export function dispatchVoiceOpenDiff(): void {
  window.dispatchEvent(new CustomEvent(VOICE_OPEN_DIFF_EVENT));
}

export function dispatchVoiceShip(): void {
  window.dispatchEvent(new CustomEvent(VOICE_SHIP_EVENT));
}

export function dispatchVoiceRunScript(scriptId: string): void {
  window.dispatchEvent(
    new CustomEvent<VoiceRunScriptDetail>(VOICE_RUN_SCRIPT_EVENT, { detail: { scriptId } }),
  );
}

export function dispatchVoiceNewAgent(prompt: string, agent?: TaskAgent): void {
  window.dispatchEvent(
    new CustomEvent<VoiceNewAgentDetail>(VOICE_NEW_AGENT_EVENT, { detail: { prompt, agent } }),
  );
}
