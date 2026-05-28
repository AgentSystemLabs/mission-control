import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("playNotificationDing", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });

  afterEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses the notification ding asset path", async () => {
    const { NOTIFICATION_DING_SRC } = await import("~/lib/notification-sound");
    expect(NOTIFICATION_DING_SRC).toBe("/audio/chime.mp3");
  });

  it("does not play when disabled", async () => {
    const playFn = vi.fn().mockResolvedValue(undefined);
    class MockAudio {
      preload = "";
      volume = 0;
      currentTime = 0;
      play = playFn;
      constructor(_src: string) {}
    }
    vi.stubGlobal("Audio", MockAudio);
    const { playNotificationDing } = await import("~/lib/notification-sound");

    playNotificationDing(false);

    expect(playFn).not.toHaveBeenCalled();
  });

  it("plays the ding when enabled", async () => {
    const playFn = vi.fn().mockResolvedValue(undefined);
    class MockAudio {
      preload = "";
      volume = 0;
      currentTime = 0;
      play = playFn;
      constructor(_src: string) {}
    }
    vi.stubGlobal("Audio", MockAudio);
    const { playNotificationDing } = await import("~/lib/notification-sound");

    playNotificationDing(true);

    expect(playFn).toHaveBeenCalledOnce();
  });
});
