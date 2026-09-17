import { describe, expect, it } from "vitest";
import {
  BACKGROUND_IMAGE_MAX_LENGTH,
  isBackgroundImage,
} from "~/shared/background-image";

// A minimal but structurally-valid 1x1 PNG data URL.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

describe("isBackgroundImage", () => {
  it("accepts null (cleared)", () => {
    expect(isBackgroundImage(null)).toBe(true);
  });

  it("accepts png/jpeg/webp/gif image data URLs", () => {
    expect(isBackgroundImage(PNG_DATA_URL)).toBe(true);
    expect(isBackgroundImage("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe(true);
    expect(isBackgroundImage("data:image/webp;base64,UklGRh4AAABXRUJQ")).toBe(true);
    expect(isBackgroundImage("data:image/gif;base64,R0lGODlhAQABAAAAACw=")).toBe(true);
  });

  it("rejects non-string, non-null values", () => {
    expect(isBackgroundImage(undefined)).toBe(false);
    expect(isBackgroundImage(123)).toBe(false);
    expect(isBackgroundImage({})).toBe(false);
  });

  it("rejects non-image and non-data URLs", () => {
    expect(isBackgroundImage("https://example.com/pic.png")).toBe(false);
    expect(isBackgroundImage("data:text/plain;base64,aGk=")).toBe(false);
    expect(isBackgroundImage("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isBackgroundImage("not a url")).toBe(false);
    expect(isBackgroundImage("")).toBe(false);
  });

  it("rejects an image URL that exceeds the size cap", () => {
    const huge =
      "data:image/png;base64," + "A".repeat(BACKGROUND_IMAGE_MAX_LENGTH);
    expect(huge.length).toBeGreaterThan(BACKGROUND_IMAGE_MAX_LENGTH);
    expect(isBackgroundImage(huge)).toBe(false);
  });
});
