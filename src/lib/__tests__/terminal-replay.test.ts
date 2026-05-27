import { describe, expect, it } from "vitest";
import {
  appendBoundedSequencedData,
  dataAfterReplay,
  replayDataOrFallback,
  sequencedPtyData,
} from "../terminal-replay";

describe("terminal replay helpers", () => {
  it("drops live chunks that are already included in the replay snapshot", () => {
    expect(
      dataAfterReplay(
        [
          { seq: 3, data: "already replayed" },
          { seq: 4, data: "new redraw" },
        ],
        { data: "snapshot", nextSeq: 4 },
      ),
    ).toEqual(["new redraw"]);
  });

  it("falls back to pending data when an exited PTY no longer has replay data", () => {
    expect(
      replayDataOrFallback(
        { data: "", nextSeq: 0 },
        [
          { seq: 1, data: "last " },
          { seq: 2, data: "frame" },
        ],
      ),
    ).toBe("last frame");
  });

  it("bounds queued live chunks during replay", () => {
    const chunks = [
      { seq: 1, data: "abcd" },
      { seq: 2, data: "efgh" },
    ];

    appendBoundedSequencedData(chunks, { seq: 3, data: "ijkl" }, 8);

    expect(chunks).toEqual([
      { seq: 2, data: "efgh" },
      { seq: 3, data: "ijkl" },
    ]);
  });

  it("treats unsequenced legacy live chunks as post-replay data", () => {
    expect(sequencedPtyData(undefined, "legacy")).toEqual({
      seq: Number.MAX_SAFE_INTEGER,
      data: "legacy",
    });
  });
});
