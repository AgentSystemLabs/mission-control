import { describe, expect, it } from "vitest";
import {
  pickRemotePetMessage,
  REMOTE_PET_MESSAGE_COUNT,
} from "../pet-multiplayer-messages";

describe("pickRemotePetMessage", () => {
  it("always returns a non-empty string", () => {
    for (let i = 0; i < 50; i++) {
      const msg = pickRemotePetMessage(`peer-${i}`, i);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic for the same seed+salt", () => {
    expect(pickRemotePetMessage("peer-abc", 3)).toBe(pickRemotePetMessage("peer-abc", 3));
  });

  it("varies the message when the salt changes", () => {
    const seen = new Set<string>();
    for (let salt = 0; salt < REMOTE_PET_MESSAGE_COUNT * 3; salt++) {
      seen.add(pickRemotePetMessage("peer-x", salt));
    }
    // Should not be stuck on a single line across many salts.
    expect(seen.size).toBeGreaterThan(1);
  });
});
