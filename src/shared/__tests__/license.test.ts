import { describe, expect, it } from "vitest";
import { isGraceExpired, isProTier, maskLicenseKey } from "../license";

describe("maskLicenseKey", () => {
  it("masks all but the last 4 characters of a long key", () => {
    expect(maskLicenseKey("mc_live_AAAABBBBCCCCDDDD")).toBe(
      "••••••••••••••••••••DDDD",
    );
  });

  it("masks short keys entirely", () => {
    expect(maskLicenseKey("abcd")).toBe("••••");
    expect(maskLicenseKey("ab")).toBe("••");
  });

  it("returns empty for empty input", () => {
    expect(maskLicenseKey("")).toBe("");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskLicenseKey("  mc_live_XYZW1234  ")).toBe("••••••••••••1234");
  });
});

describe("isGraceExpired", () => {
  const now = new Date("2026-05-04T12:00:00Z");

  it("returns false when no key is stored", () => {
    expect(
      isGraceExpired({ hasKey: false, status: null, graceUntil: null }, now),
    ).toBe(false);
  });

  it("returns false when graceUntil is unset", () => {
    expect(
      isGraceExpired({ hasKey: true, status: "active", graceUntil: null }, now),
    ).toBe(false);
  });

  it("returns false when grace window is in the future", () => {
    expect(
      isGraceExpired(
        { hasKey: true, status: "active", graceUntil: "2026-05-18T12:00:00Z" },
        now,
      ),
    ).toBe(false);
  });

  it("returns true when grace window has passed", () => {
    expect(
      isGraceExpired(
        { hasKey: true, status: "active", graceUntil: "2026-04-01T12:00:00Z" },
        now,
      ),
    ).toBe(true);
  });

  it("does not flag grace expired for revoked or invalid statuses (banner uses status itself)", () => {
    expect(
      isGraceExpired(
        { hasKey: true, status: "revoked", graceUntil: "2026-04-01T12:00:00Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isGraceExpired(
        { hasKey: true, status: "invalid", graceUntil: "2026-04-01T12:00:00Z" },
        now,
      ),
    ).toBe(false);
  });

  it("flags grace expired when status is 'unknown' (network failures don't extend grace)", () => {
    expect(
      isGraceExpired(
        { hasKey: true, status: "unknown", graceUntil: "2026-04-01T12:00:00Z" },
        now,
      ),
    ).toBe(true);
  });
});

describe("isProTier", () => {
  const now = new Date("2026-05-04T12:00:00Z");
  const fresh = "2026-05-18T12:00:00Z";
  const stale = "2026-04-01T12:00:00Z";

  it("requires an active key within the grace window", () => {
    expect(
      isProTier({ hasKey: true, status: "active", graceUntil: fresh }, now),
    ).toBe(true);
  });

  it("returns false when no key is on file", () => {
    expect(
      isProTier({ hasKey: false, status: null, graceUntil: null }, now),
    ).toBe(false);
  });

  it("returns false when status is revoked", () => {
    expect(
      isProTier({ hasKey: true, status: "revoked", graceUntil: fresh }, now),
    ).toBe(false);
  });

  it("returns false when status is invalid", () => {
    expect(
      isProTier({ hasKey: true, status: "invalid", graceUntil: fresh }, now),
    ).toBe(false);
  });

  it("returns false when status is unknown (no successful validation)", () => {
    expect(
      isProTier({ hasKey: true, status: "unknown", graceUntil: fresh }, now),
    ).toBe(false);
  });

  it("returns false when grace has expired even with previously-active key", () => {
    expect(
      isProTier({ hasKey: true, status: "active", graceUntil: stale }, now),
    ).toBe(false);
  });
});
