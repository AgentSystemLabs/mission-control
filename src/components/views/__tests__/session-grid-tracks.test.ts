import { describe, expect, it } from "vitest";
import { frTracks } from "../SessionGrid";

describe("frTracks", () => {
  it("expands a lone sub-1 weight to a full 1fr track", () => {
    // A survivor cell keeps its resized weight after its row-mate is removed.
    // CSS grid floors the flex-factor sum at 1, so a bare `0.909fr` track would
    // only take ~91% of the row and leave a gap — normalizing fixes it.
    expect(frTracks([0.909346])).toBe("minmax(0, 1fr)");
  });

  it("fills the row when the weights sum below 1", () => {
    expect(frTracks([0.4, 0.4])).toBe("minmax(0, 1fr) minmax(0, 1fr)");
  });

  it("preserves relative column sizes when the weights already fill", () => {
    expect(frTracks([0.909, 1.091])).toBe("minmax(0, 0.909fr) minmax(0, 1.091fr)");
  });

  it("keeps equal columns equal", () => {
    expect(frTracks([1, 1, 1])).toBe(
      "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
    );
  });

  it("returns an empty string for no tracks", () => {
    expect(frTracks([])).toBe("");
  });
});
