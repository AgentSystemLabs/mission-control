import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("playVoiceCue", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });

  afterEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses distinct start and end cue assets", async () => {
    const { VOICE_START_CUE_SRC, VOICE_END_CUE_SRC } = await import("~/lib/voice-sound");

    expect(VOICE_START_CUE_SRC).toBe("/audio/notification-ding.wav");
    expect(VOICE_END_CUE_SRC).toBe("/audio/chime.mp3");
  });

  it("plays the requested voice cue", async () => {
    const playFn = vi.fn().mockResolvedValue(undefined);
    const audioSources: string[] = [];
    class MockAudio {
      preload = "";
      volume = 0;
      currentTime = 0;
      play = playFn;
      constructor(src: string) {
        audioSources.push(src);
      }
    }
    vi.stubGlobal("Audio", MockAudio);
    const { playVoiceCue } = await import("~/lib/voice-sound");

    playVoiceCue("start");
    playVoiceCue("end");

    expect(audioSources).toEqual(["/audio/notification-ding.wav", "/audio/chime.mp3"]);
    expect(playFn).toHaveBeenCalledTimes(2);
  });
});
