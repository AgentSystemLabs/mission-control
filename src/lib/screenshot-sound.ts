export const SCREENSHOT_CAPTURE_SRC = "/audio/screenshot-capture.mp3";
export const SCREENSHOT_DROP_SRC = "/audio/screenshot-drop.mp3";

const SCREENSHOT_CAPTURE_VOLUME = 0.4;
const SCREENSHOT_DROP_VOLUME = 0.5;

const cachedAudio: Record<string, HTMLAudioElement> = {};

function getAudio(src: string): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  cachedAudio[src] ??= Object.assign(new Audio(src), { preload: "auto" as const });
  return cachedAudio[src];
}

function playCue(src: string, volume: number) {
  const audio = getAudio(src);
  if (!audio) return;
  audio.volume = volume;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Browsers may block audio until the first user gesture.
  });
}

/** Play the screenshot capture cue. Safe to call from event handlers. */
export function playScreenshotCapture() {
  playCue(SCREENSHOT_CAPTURE_SRC, SCREENSHOT_CAPTURE_VOLUME);
}

/** Play the cue when a screenshot is dropped onto / attached to a session. */
export function playScreenshotDrop() {
  playCue(SCREENSHOT_DROP_SRC, SCREENSHOT_DROP_VOLUME);
}
