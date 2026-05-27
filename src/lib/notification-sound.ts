export const NOTIFICATION_DING_SRC = "/audio/notification-ding.wav";

const NOTIFICATION_DING_VOLUME = 0.35;

let cachedAudio: HTMLAudioElement | null = null;

function getNotificationAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!cachedAudio) {
    cachedAudio = new Audio(NOTIFICATION_DING_SRC);
    cachedAudio.preload = "auto";
  }
  return cachedAudio;
}

/** Play the notification ding when enabled. Safe to call from event handlers. */
export function playNotificationDing(enabled = true) {
  if (!enabled || typeof window === "undefined") return;
  const audio = getNotificationAudio();
  if (!audio) return;
  audio.volume = NOTIFICATION_DING_VOLUME;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Browsers may block audio until the first user gesture.
  });
}
