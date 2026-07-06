import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../format-relative-time";

const base = new Date("2026-07-06T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("returns just now for timestamps under a minute old", () => {
    expect(formatRelativeTime(base - 30_000, base)).toBe("just now");
  });

  it("returns just now for future timestamps", () => {
    expect(formatRelativeTime(base + 60_000, base)).toBe("just now");
  });

  it("formats minutes ago", () => {
    expect(formatRelativeTime(base - 5 * 60_000, base)).toBe("5 minutes ago");
  });

  it("formats hours ago", () => {
    expect(formatRelativeTime(base - 3 * 3_600_000, base)).toBe("about 3 hours ago");
  });

  it("formats days ago", () => {
    expect(formatRelativeTime(base - 2 * 86_400_000, base)).toBe("2 days ago");
  });

  it("formats weeks and months for older timestamps", () => {
    expect(formatRelativeTime(base - 14 * 86_400_000, base)).toBe("14 days ago");
    expect(formatRelativeTime(base - 60 * 86_400_000, base)).toBe("2 months ago");
  });
});
