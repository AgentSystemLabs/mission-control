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
export const VOICE_PASTE_TO_FOCUSED_SESSION_EVENT = "mc:voice-paste-to-focused-session";

// Push-to-talk control bus. The header mic button drives the same recording flow
// as the `voice.pushToTalk` keybinding by dispatching these; VoiceController (the
// owner of the begin/finish/abort flow) listens and runs the matching handler.
// start = begin recording, stop = stop + transcribe, cancel = abandon the hold.
export const VOICE_PTT_START_EVENT = "mc:voice-ptt-start";
export const VOICE_PTT_STOP_EVENT = "mc:voice-ptt-stop";
export const VOICE_PTT_CANCEL_EVENT = "mc:voice-ptt-cancel";

export type VoiceNewAgentDetail = {
  /** The task to seed the new agent session with (may be empty). */
  prompt: string;
  /** Which agent CLI to launch; defaults to claude-code when unspecified. */
  agent?: TaskAgent;
};

export type VoiceRunScriptDetail = { scriptId: string };
export type VoicePasteToFocusedSessionDetail = {
  text: string;
  handled: boolean;
};

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

export function dispatchVoicePasteToFocusedSession(text: string): boolean {
  const detail: VoicePasteToFocusedSessionDetail = { text, handled: false };
  window.dispatchEvent(new CustomEvent(VOICE_PASTE_TO_FOCUSED_SESSION_EVENT, { detail }));
  return detail.handled;
}

export function dispatchVoicePttStart(): void {
  window.dispatchEvent(new CustomEvent(VOICE_PTT_START_EVENT));
}

export function dispatchVoicePttStop(): void {
  window.dispatchEvent(new CustomEvent(VOICE_PTT_STOP_EVENT));
}

export function dispatchVoicePttCancel(): void {
  window.dispatchEvent(new CustomEvent(VOICE_PTT_CANCEL_EVENT));
}
