import { describe, expect, it } from "vitest";
import {
  compressProjectImageFile,
  fitImageWithinBounds,
  PROJECT_IMAGE_MAX_SOURCE_BYTES,
} from "../project-image-client";

describe("project image client helpers", () => {
  it("does not upscale images that already fit", () => {
    expect(fitImageWithinBounds({ width: 96, height: 64 })).toEqual({ width: 96, height: 64 });
  });

  it("scales landscape images within the 128px bounds", () => {
    expect(fitImageWithinBounds({ width: 640, height: 320 })).toEqual({ width: 128, height: 64 });
  });

  it("scales portrait images within the 128px bounds", () => {
    expect(fitImageWithinBounds({ width: 300, height: 600 })).toEqual({ width: 64, height: 128 });
  });

  it("keeps very narrow images drawable", () => {
    expect(fitImageWithinBounds({ width: 1, height: 1024 })).toEqual({ width: 1, height: 128 });
  });

  it("rejects invalid dimensions", () => {
    expect(() => fitImageWithinBounds({ width: 0, height: 128 })).toThrow("Image dimensions are invalid");
  });

  it("rejects source files that are too large to optimize safely", async () => {
    const file = new File([new Uint8Array(PROJECT_IMAGE_MAX_SOURCE_BYTES + 1)], "huge.png", {
      type: "image/png",
    });

    await expect(compressProjectImageFile(file)).rejects.toThrow("Choose an image under 10MB");
  });
});
