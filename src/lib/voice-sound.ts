export const VOICE_START_CUE_SRC = "/audio/notification-ding.wav";
export const VOICE_END_CUE_SRC = "/audio/chime.mp3";

const VOICE_CUE_VOLUME = 0.25;

type VoiceCue = "start" | "end";

const cueSources: Record<VoiceCue, string> = {
  start: VOICE_START_CUE_SRC,
  end: VOICE_END_CUE_SRC,
};

const cachedAudio: Partial<Record<VoiceCue, HTMLAudioElement>> = {};

function getVoiceCueAudio(cue: VoiceCue): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  cachedAudio[cue] ??= new Audio(cueSources[cue]);
  cachedAudio[cue].preload = "auto";
  return cachedAudio[cue];
}

/** Play a short cue for push-to-talk recording transitions. */
export function playVoiceCue(cue: VoiceCue) {
  const audio = getVoiceCueAudio(cue);
  if (!audio) return;
  audio.volume = VOICE_CUE_VOLUME;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Browsers may block audio until the first user gesture.
  });
}
